import { Injectable } from "@nestjs/common";
import { Order, OrderEvent, Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { Actor } from "./auth";
import { decodeProduct, decodePromotion } from "./catalog";
import { Db, Tx, digest, json } from "./db";
import {
  Draft,
  Priced,
  RuleError,
  SnapshotItem,
  ensure,
  listSchema,
  price,
} from "./domain";
import { Change } from "./realtime";
import { Writes, checkVersion } from "./writes";
import { operation, STORE_TIME_ZONE } from "./schedule";
import { SchedulingService } from "./scheduling";

type Loaded = Order & { events: OrderEvent[] };
type ScheduledPrice = Priced & { scheduledFor: string | null; timeZone: string };
export type Action =
  | "accept"
  | "prepare"
  | "ready"
  | "cancel"
  | "assign"
  | "pickup-complete"
  | "collect"
  | "start"
  | "complete"
  | "issue"
  | "return"
  | "record-payment";
export type Command = {
  expectedVersion: number;
  reason?: string;
  driverId?: string;
  recipient?: string;
  paymentCollected?: boolean;
  reference?: string;
};
const permissions: Record<Action, Role[]> = {
  accept: ["MANAGER", "ATTENDANT"],
  prepare: ["MANAGER", "KITCHEN"],
  ready: ["MANAGER", "KITCHEN"],
  cancel: ["MANAGER", "CUSTOMER"],
  assign: ["MANAGER", "ATTENDANT"],
  "pickup-complete": ["MANAGER", "ATTENDANT"],
  collect: ["DRIVER"],
  start: ["DRIVER"],
  complete: ["DRIVER"],
  issue: ["DRIVER"],
  return: ["DRIVER", "MANAGER", "ATTENDANT"],
  "record-payment": ["MANAGER"],
};
function scoped(actor: Actor): Prisma.OrderWhereInput {
  return {
    storeId: actor.storeId,
    ...(actor.role === "KITCHEN" ? { AND: [{ status: { not: "SCHEDULED" as const } }] } : {}),
    ...(actor.role === "CUSTOMER"
      ? { customerId: actor.id }
      : actor.role === "DRIVER"
        ? { driverId: actor.id }
        : {}),
  };
}
function orderDto(order: Loaded, actor: Actor) {
  const events = order.events.map((e) => ({
    action: e.action,
    version: e.version,
    createdAt: e.createdAt,
  }));
  const base = {
    id: order.id,
    number: order.number,
    version: order.version,
    status: order.status,
    scheduledFor: order.scheduledFor,
    timeZone: STORE_TIME_ZONE,
    deliveryStatus: order.deliveryStatus,
    mode: order.mode,
    note: order.note,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    events,
  };
  const items = order.items as unknown as SnapshotItem[];
  if (actor.role === "KITCHEN")
    return { ...base, items: items.map(({ unitPrice: _price, ...i }) => i) };
  const detail = {
    ...base,
    items,
    customer: order.customer,
    address: order.address,
    payment: order.payment,
    paymentRecorded: order.paymentRecorded,
    cashTendered: order.cashTendered,
    subtotal: order.subtotal,
    fee: order.fee,
    discount: order.discount,
    total: order.total,
    promotion: order.promotionSnapshot,
    recipient: order.recipient,
    change:
      order.payment === "CASH" && order.cashTendered !== null
        ? Math.max(0, order.cashTendered - order.total)
        : 0,
  };
  if (actor.role === "CUSTOMER") return detail;
  if (actor.role === "DRIVER")
    return {
      ...detail,
      driverFee: order.driverFee,
      driverEarnings: order.status === "DELIVERED" ? order.driverFee : 0,
    };
  return {
    ...detail,
    channel: order.channel,
    customerId: order.customerId,
    driverId: order.driverId,
    driverFee: order.driverFee,
    events: order.events.map((e) => ({
      ...events.find((v) => v.version === e.version),
      actorId: e.actorId,
      data: e.data,
    })),
  };
}
const include = { events: { orderBy: { version: "asc" as const } } };
@Injectable()
export class OrdersService {
  constructor(
    private readonly db: Db,
    private readonly writes: Writes,
    private readonly scheduling: SchedulingService,
  ) {}
  async list(actor: Actor, query: z.infer<typeof listSchema>) {
    await this.scheduling.reconcile(actor.storeId);
    let number: number | undefined;
    if (query.cursor) {
      try {
        number = z
          .strictObject({ number: z.number().int().positive() })
          .parse(
            JSON.parse(Buffer.from(query.cursor, "base64url").toString()),
          ).number;
      } catch {
        ensure(false, "INVALID_CURSOR", "Cursor inválido.", 400);
      }
    }
    const orders = await this.db.order.findMany({
      where: {
        ...scoped(actor),
        ...(query.status ? { status: query.status } : {}),
        ...(number ? { number: { lt: number } } : {}),
      },
      include,
      orderBy: { number: "desc" },
      take: query.limit + 1,
    });
    const hasNext = orders.length > query.limit;
    const page = orders.slice(0, query.limit);
    return {
      items: page.map((o) => orderDto(o, actor)),
      nextCursor: hasNext
        ? Buffer.from(JSON.stringify({ number: page.at(-1)!.number })).toString(
            "base64url",
          )
        : null,
    };
  }
  async get(actor: Actor, id: string, tx: Tx = this.db) {
    if (tx === this.db) await this.scheduling.reconcile(actor.storeId);
    const order = await tx.order.findFirst({
      where: { ...scoped(actor), id },
      include,
    });
    ensure(order, "NOT_FOUND", "Pedido não encontrado.", 404);
    return orderDto(order, actor);
  }
  private async calculate(tx: Tx, storeId: string, draft: Draft) {
    const store = await tx.store.findUniqueOrThrow({ where: { id: storeId } });
    const state = operation(store);
    ensure(state.open || (state.reservationsAvailable && draft.allowScheduling),
      "STORE_CLOSED",
      state.reservationsAvailable
        ? "A loja está fechada. Atualize a cotação para reservar para a próxima abertura."
        : "A loja está fechada para novos pedidos.", 409);
    const products = (await tx.product.findMany({ where: { storeId } })).map(
      decodeProduct,
    );
    const promo = draft.promotionId
      ? await tx.promotion.findUnique({
          where: { storeId_id: { storeId, id: draft.promotionId } },
        })
      : null;
    return {
      ...price(
        products, draft, draft.mode === "DELIVERY" ? store.deliveryFee : 0,
        promo ? decodePromotion(promo) : null,
      ),
      scheduledFor: state.open ? null : state.nextOpening,
      timeZone: STORE_TIME_ZONE,
    };
  }
  quote(actor: Actor, key: string, input: Draft) {
    return this.writes.run(actor, key, "quote:new", input, async (tx) => {
      if (actor.role === "CUSTOMER")
        ensure(
          input.customer === undefined && input.channel === undefined,
          "FORBIDDEN",
          "Dados do cliente e canal são definidos pela sessão.",
          403,
        );
      else
        ensure(
          input.customer && input.channel,
          "MISSING_CUSTOMER",
          "Informe o cliente e o canal do pedido manual.",
        );
      const draft = {
        ...input,
        customer:
          actor.role === "CUSTOMER"
            ? { name: actor.name, phone: actor.phone }
            : input.customer,
      };
      const priced = await this.calculate(tx, actor.storeId, draft);
      const quote = await tx.quote.create({
        data: {
          storeId: actor.storeId,
          userId: actor.id,
          draft: json(draft),
          priced: json(priced),
          fingerprint: digest(priced),
          expiresAt: new Date(Date.now() + 5 * 60_000),
        },
      });
      return {
        data: { quoteId: quote.id, expiresAt: quote.expiresAt, ...priced },
      };
    });
  }
  create(actor: Actor, key: string, quoteId: string) {
    return this.writes.run(actor, key, "order:new", { quoteId }, async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id: quoteId, storeId: actor.storeId, userId: actor.id },
      });
      ensure(quote, "NOT_FOUND", "Cotação não encontrada.", 404);
      const existing = await tx.order.findUnique({
        where: { quoteId },
        include,
      });
      if (existing) return { data: orderDto(existing, actor) };
      ensure(
        quote.expiresAt > new Date(),
        "QUOTE_EXPIRED",
        "A cotação expirou. Faça uma nova cotação e revise o valor.",
        409,
      );
      const draft = quote.draft as unknown as Draft;
      let priced: ScheduledPrice;
      try {
        priced = await this.calculate(tx, actor.storeId, draft);
      } catch (error) {
        if (!(error instanceof RuleError)) throw error;
        ensure(
          false,
          "QUOTE_CHANGED",
          "Preços, horário ou disponibilidade mudaram. Revise uma nova cotação.",
          409,
        );
      }
      ensure(
        digest(priced) === quote.fingerprint,
        "QUOTE_CHANGED",
        "O valor, horário ou promoção mudou. Revise uma nova cotação.",
        409,
      );
      if (priced.scheduledFor) {
        const reserved = await tx.order.count({
          where: { storeId: actor.storeId, status: "SCHEDULED" },
        });
        ensure(reserved < 500, "RESERVATION_LIMIT",
          "A loja atingiu o limite de reservas. Entre em contato com a pizzaria.", 409);
        if (actor.role === "CUSTOMER") ensure(
          (await tx.order.count({
            where: { storeId: actor.storeId, customerId: actor.id, status: "SCHEDULED" },
          })) < 3, "CUSTOMER_RESERVATION_LIMIT",
          "Você já tem 3 reservas ativas. Acompanhe ou cancele uma delas antes de reservar novamente.", 409);
      }
      const store = await tx.store.update({
        where: { id: actor.storeId },
        data: { nextNumber: { increment: 1 } },
      });
      if (priced.promotion)
        await tx.promotion.update({
          where: {
            storeId_id: { storeId: actor.storeId, id: priced.promotion.id },
          },
          data: { reserved: { increment: priced.promotion.pizzaQuantity } },
        });
      const order = await tx.order.create({
        data: {
          storeId: actor.storeId,
          number: store.nextNumber,
          quoteId,
          status: priced.scheduledFor ? "SCHEDULED" : "NEW",
          scheduledFor: priced.scheduledFor ? new Date(priced.scheduledFor) : null,
          customerId: actor.role === "CUSTOMER" ? actor.id : null,
          customer: json(draft.customer),
          address: draft.address ? json(draft.address) : Prisma.DbNull,
          channel: actor.role === "CUSTOMER" ? "APP" : draft.channel!,
          mode: draft.mode,
          note: draft.note,
          items: json(priced.items),
          subtotal: priced.subtotal,
          fee: priced.fee,
          discount: priced.discount,
          total: priced.total,
          payment: draft.payment,
          cashTendered: draft.cashTendered,
          promotionId: priced.promotion?.id,
          promotionQuantity: priced.promotion?.pizzaQuantity ?? 0,
          promotionSnapshot: priced.promotion
            ? json({ ...priced.promotion, appliedAt: new Date().toISOString() })
            : Prisma.DbNull,
          events: {
            create: {
              version: 1,
              action: priced.scheduledFor ? "scheduled" : "created",
              actorId: actor.id,
              data: {},
            },
          },
        },
        include,
      });
      return {
        data: orderDto(order, actor),
        events: this.changes(order, "order.created"),
      };
    });
  }
  private changes(
    order: Order,
    type: string,
    previousDriverId?: string | null,
  ): Change[] {
    const events: Change[] = [
      {
        type,
        storeId: order.storeId,
        orderId: order.id,
        version: order.version,
        customerId: order.customerId,
        driverId: order.driverId,
        previousDriverId,
      },
    ];
    if (order.promotionId)
      events.push({ type: "promotion.usage.changed", storeId: order.storeId });
    return events;
  }
  async command(
    actor: Actor,
    key: string,
    id: string,
    action: Action,
    command: Command,
  ) {
    ensure(
      permissions[action].includes(actor.role),
      "FORBIDDEN",
      "Este perfil não pode executar este comando.",
      403,
    );
    await this.scheduling.reconcile(actor.storeId);
    return this.writes.run(
      actor,
      key,
      `order:${id}:${action}`,
      command,
      async (tx) => {
        const order = await tx.order.findFirst({
          where: { ...scoped(actor), id },
        });
        ensure(order, "NOT_FOUND", "Pedido não encontrado.", 404);
        checkVersion(order.version, command.expectedVersion);
        const must = (valid: unknown) =>
          ensure(
            valid,
            "INVALID_TRANSITION",
            "O pedido não permite esta ação na etapa atual.",
            409,
          );
        const data: Prisma.OrderUncheckedUpdateInput = {
          version: { increment: 1 },
        };
        if (action === "accept") {
          must(order.status === "NEW");
          data.status = "CONFIRMED";
        }
        if (action === "prepare") {
          must(order.status === "CONFIRMED");
          data.status = "PREPARING";
        }
        if (action === "ready") {
          must(order.status === "PREPARING");
          data.status = "READY";
        }
        if (action === "cancel") {
          must(
            ["SCHEDULED", "NEW", "CONFIRMED", "PREPARING", "READY"].includes(order.status) &&
              order.deliveryStatus !== "COLLECTED",
          );
          if (actor.role === "CUSTOMER") must(["SCHEDULED", "NEW"].includes(order.status));
          data.status = "CANCELLED";
          data.deliveryStatus = null;
          data.driverId = null;
        }
        if (action === "assign") {
          must(
            order.mode === "DELIVERY" &&
              order.status === "READY" &&
              (!order.deliveryStatus || order.deliveryStatus === "ASSIGNED"),
          );
          const driver = await tx.user.findFirst({
            where: {
              id: command.driverId,
              storeId: actor.storeId,
              role: "DRIVER",
              enabled: true,
              available: true,
            },
          });
          ensure(
            driver,
            "DRIVER_UNAVAILABLE",
            "Entregador não encontrado ou indisponível.",
            409,
          );
          const store = await tx.store.findUniqueOrThrow({
            where: { id: actor.storeId },
          });
          data.driverId = driver.id;
          data.deliveryStatus = "ASSIGNED";
          data.driverFee = store.driverFee;
        }
        if (action === "collect") {
          must(order.status === "READY" && order.deliveryStatus === "ASSIGNED");
          const driver = await tx.user.findUniqueOrThrow({
            where: { id: actor.id },
          });
          ensure(
            driver.available,
            "DRIVER_UNAVAILABLE",
            "Ative sua disponibilidade antes de retirar novos pedidos.",
            409,
          );
          data.deliveryStatus = "COLLECTED";
        }
        if (action === "start") {
          must(
            order.status === "READY" && order.deliveryStatus === "COLLECTED",
          );
          data.status = "OUT_FOR_DELIVERY";
          data.deliveryStatus = "ON_ROUTE";
        }
        if (action === "complete" || action === "pickup-complete") {
          must(
            action === "complete"
              ? order.status === "OUT_FOR_DELIVERY" &&
                  order.deliveryStatus === "ON_ROUTE"
              : order.status === "READY" && order.mode === "PICKUP",
          );
          ensure(
            order.paymentRecorded ||
              order.total === 0 ||
              command.paymentCollected === true,
            "PAYMENT_REQUIRED",
            "Confirme o recebimento do dinheiro ou cartão antes de concluir.",
          );
          data.status = "DELIVERED";
          data.recipient = command.recipient;
          data.paymentRecorded = true;
          if (action === "complete") data.deliveryStatus = "DELIVERED";
        }
        if (action === "issue") {
          must(
            order.status === "OUT_FOR_DELIVERY" &&
              order.deliveryStatus === "ON_ROUTE",
          );
          data.status = "RETURNING";
          data.deliveryStatus = "RETURNING";
        }
        if (action === "return") {
          must(
            order.status === "RETURNING" &&
              order.deliveryStatus === "RETURNING",
          );
          data.status = "RETURNED";
          data.deliveryStatus = "RETURNED";
        }
        if (action === "record-payment") {
          must(
            !["CANCELLED", "RETURNED", "DELIVERED"].includes(order.status) &&
              !order.paymentRecorded,
          );
          data.paymentRecorded = true;
          data.payment = "PREPAID";
          data.cashTendered = null;
        }
        if (
          order.promotionId &&
          ["DELIVERED", "CANCELLED", "RETURNED"].includes(data.status as string)
        ) {
          await tx.promotion.update({
            where: {
              storeId_id: { storeId: actor.storeId, id: order.promotionId },
            },
            data: {
              reserved: { decrement: order.promotionQuantity },
              ...(data.status === "DELIVERED"
                ? { sold: { increment: order.promotionQuantity } }
                : {}),
            },
          });
        }
        const updated = await tx.order.update({
          where: { id },
          data: {
            ...data,
            events: {
              create: {
                version: order.version + 1,
                action,
                actorId: actor.id,
                data: json(command),
              },
            },
          },
          include,
        });
        return {
          data: orderDto(updated, actor),
          events: this.changes(updated, "order.updated", order.driverId),
        };
      },
    );
  }
}
