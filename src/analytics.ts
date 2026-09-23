import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { Actor, AuthService } from "./auth";
import { Db } from "./db";
import { ensure } from "./domain";
import { STORE_TIME_ZONE } from "./schedule";

export const analyticsQuery = z
  .strictObject({
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine(({ from, to }) => {
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    return days >= 0 && days < 366;
  }, "Selecione um período de até 366 dias, com início anterior ou igual ao fim.");

type Totals = {
  received: number;
  completed: number;
  cancelled: number;
  returned: number;
  pizzas: number;
  incompletePizzaOrders: number;
  subtotal: number;
  discounts: number;
  deliveryFees: number;
  revenue: number;
  driverFees: number;
};
type Group = Totals & {
  group: "summary" | "day" | "channel" | "payment";
  key: string | null;
};
const emptyTotals = (): Totals => ({
  received: 0,
  completed: 0,
  cancelled: 0,
  returned: 0,
  pizzas: 0,
  incompletePizzaOrders: 0,
  subtotal: 0,
  discounts: 0,
  deliveryFees: 0,
  revenue: 0,
  driverFees: 0,
});
const activeStatuses = [
  "SCHEDULED",
  "NEW",
  "CONFIRMED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "RETURNING",
] as const;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
  ) {}

  async dashboard(actor: Actor, period: z.infer<typeof analyticsQuery>) {
    ensure(
      actor.role === "MANAGER",
      "FORBIDDEN",
      "Acesso exclusivo do gerente.",
      403,
    );
    // One read snapshot keeps the totals, series and current driver balances coherent.
    return this.db.$transaction(
      async (tx) => {
        await this.auth.assert(tx, actor);
        const rows = await tx.$queryRaw<Group[]>`
        WITH bounds AS (
          SELECT (${period.from}::date::timestamp AT TIME ZONE ${STORE_TIME_ZONE}) AT TIME ZONE 'UTC' AS start,
                 ((${period.to}::date + 1)::timestamp AT TIME ZONE ${STORE_TIME_ZONE}) AT TIME ZONE 'UTC' AS finish
        ), closed AS (
          SELECT o.*, COALESCE((
            SELECT max(e."createdAt") FROM "OrderEvent" e
            WHERE e."orderId" = o.id AND e.action IN ('complete', 'pickup-complete', 'cancel', 'return')
          ), o."updatedAt") AS "closedAt"
          FROM "Order" o, bounds b
          WHERE o."storeId" = ${actor.storeId}::uuid
            AND o.status IN ('DELIVERED', 'CANCELLED', 'RETURNED')
            AND o."updatedAt" >= b.start
        ), facts AS (
          SELECT o.channel, o.payment,
            ((o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${STORE_TIME_ZONE})::date::text AS day,
            1 AS received, 0 AS completed, 0 AS cancelled, 0 AS returned, 0 AS pizzas,
            0 AS incomplete, 0 AS subtotal, 0 AS discounts, 0 AS fee, 0 AS revenue, 0 AS "driverFee"
          FROM "Order" o, bounds b
          WHERE o."storeId" = ${actor.storeId}::uuid AND o."createdAt" >= b.start AND o."createdAt" < b.finish
          UNION ALL
          SELECT o.channel, o.payment,
            ((o."closedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${STORE_TIME_ZONE})::date::text,
            0, (o.status = 'DELIVERED')::int, (o.status = 'CANCELLED')::int, (o.status = 'RETURNED')::int,
            CASE WHEN o.status = 'DELIVERED' THEN COALESCE((q.priced->>'pizzaQuantity')::int,
              (SELECT COALESCE(sum((i->>'quantity')::int), 0)::int FROM jsonb_array_elements(q.draft->'items') i WHERE i->>'kind' = 'PIZZA')) ELSE 0 END,
            CASE WHEN o.status = 'DELIVERED' AND q.priced->>'pizzaQuantity' IS NULL
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(q.draft->'items') i WHERE i->>'kind' = 'COMBO') THEN 1 ELSE 0 END,
            CASE WHEN o.status = 'DELIVERED' THEN o.subtotal ELSE 0 END,
            CASE WHEN o.status = 'DELIVERED' THEN o.discount ELSE 0 END,
            CASE WHEN o.status = 'DELIVERED' THEN o.fee ELSE 0 END,
            CASE WHEN o.status = 'DELIVERED' THEN o.total ELSE 0 END,
            CASE WHEN o.status = 'DELIVERED' THEN o."driverFee" ELSE 0 END
          FROM closed o JOIN "Quote" q ON q.id = o."quoteId" AND q."storeId" = o."storeId", bounds b
          WHERE o."closedAt" >= b.start AND o."closedAt" < b.finish
        )
        SELECT CASE WHEN GROUPING(day) = 0 THEN 'day' WHEN GROUPING(channel) = 0 THEN 'channel'
                    WHEN GROUPING(payment) = 0 THEN 'payment' ELSE 'summary' END AS "group",
          COALESCE(day, channel, payment) AS key,
          COALESCE(sum(received),0)::int AS received, COALESCE(sum(completed),0)::int AS completed,
          COALESCE(sum(cancelled),0)::int AS cancelled, COALESCE(sum(returned),0)::int AS returned,
          COALESCE(sum(pizzas),0)::int AS pizzas, COALESCE(sum(incomplete),0)::int AS "incompletePizzaOrders",
          COALESCE(sum(subtotal),0)::float8 AS subtotal, COALESCE(sum(discounts),0)::float8 AS discounts,
          COALESCE(sum(fee),0)::float8 AS "deliveryFees", COALESCE(sum(revenue),0)::float8 AS revenue,
          COALESCE(sum("driverFee"),0)::float8 AS "driverFees"
        FROM facts GROUP BY GROUPING SETS ((), (day), (channel), (payment))
      `;
        const live = await tx.order.groupBy({
          by: ["status"],
          where: {
            storeId: actor.storeId,
            status: { in: [...activeStatuses] },
          },
          _count: true,
        });
        const drivers = await tx.$queryRaw<
          {
            id: string;
            name: string;
            enabled: boolean;
            available: boolean;
            activeOrders: number;
            onRouteOrders: number;
            completed: number;
            returned: number;
            earnings: number;
          }[]
        >`
        SELECT u.id, u.name, u.enabled, u.available,
          count(o.id) FILTER (WHERE o.status NOT IN ('DELIVERED','CANCELLED','RETURNED'))::int AS "activeOrders",
          count(o.id) FILTER (WHERE o.status IN ('OUT_FOR_DELIVERY','RETURNING'))::int AS "onRouteOrders",
          count(o.id) FILTER (WHERE o.status = 'DELIVERED' AND c.time >= b.start AND c.time < b.finish)::int AS completed,
          count(o.id) FILTER (WHERE o.status = 'RETURNED' AND c.time >= b.start AND c.time < b.finish)::int AS returned,
          COALESCE(sum(o."driverFee") FILTER (WHERE o.status = 'DELIVERED' AND c.time >= b.start AND c.time < b.finish),0)::float8 AS earnings
        FROM "User" u
        CROSS JOIN (
          SELECT (${period.from}::date::timestamp AT TIME ZONE ${STORE_TIME_ZONE}) AT TIME ZONE 'UTC' AS start,
            ((${period.to}::date + 1)::timestamp AT TIME ZONE ${STORE_TIME_ZONE}) AT TIME ZONE 'UTC' AS finish
        ) b
        LEFT JOIN "Order" o ON o."driverId" = u.id AND o."storeId" = u."storeId"
        LEFT JOIN LATERAL (
          SELECT COALESCE(max(e."createdAt"), o."updatedAt") AS time FROM "OrderEvent" e
          WHERE e."orderId" = o.id AND e.action IN ('complete','return')
        ) c ON true
        WHERE u."storeId" = ${actor.storeId}::uuid AND u.role = 'DRIVER'
        GROUP BY u.id ORDER BY u.enabled DESC, u.name, u.id
      `;
        const totals = rows.find((r) => r.group === "summary") ?? emptyTotals();
        const group = (kind: Group["group"], key: string) =>
          rows.find((r) => r.group === kind && r.key === key) ?? emptyTotals();
        const timeline = [];
        for (
          let date = Date.parse(period.from);
          date <= Date.parse(period.to);
          date += 86_400_000
        ) {
          const day = new Date(date).toISOString().slice(0, 10);
          const row = group("day", day);
          timeline.push({
            date: day,
            received: row.received,
            completed: row.completed,
            revenue: row.revenue,
            pizzas: row.pizzas,
          });
        }
        return {
          period: { ...period, timeZone: STORE_TIME_ZONE },
          generatedAt: new Date().toISOString(),
          receivedOrders: totals.received,
          completedOrders: totals.completed,
          cancelledOrders: totals.cancelled,
          returnedOrders: totals.returned,
          pizzasSold: totals.pizzas,
          incompletePizzaOrders: totals.incompletePizzaOrders,
          sales: {
            subtotal: totals.subtotal,
            discounts: totals.discounts,
            deliveryFees: totals.deliveryFees,
            revenue: totals.revenue,
            driverFees: totals.driverFees,
            afterDriverFees: totals.revenue - totals.driverFees,
            averageTicket: totals.completed
              ? Math.round(totals.revenue / totals.completed)
              : 0,
          },
          channels: ["APP", "WHATSAPP", "COUNTER"].map((channel) => {
            const row = group("channel", channel);
            return {
              channel,
              received: row.received,
              completed: row.completed,
              revenue: row.revenue,
            };
          }),
          payments: ["CASH", "CARD", "PREPAID"].map((method) => {
            const row = group("payment", method);
            return { method, orders: row.completed, revenue: row.revenue };
          }),
          timeline,
          operation: activeStatuses.map((status) => ({
            status,
            count: live.find((r) => r.status === status)?._count ?? 0,
          })),
          drivers: {
            total: drivers.length,
            enabled: drivers.filter((d) => d.enabled).length,
            available: drivers.filter((d) => d.enabled && d.available).length,
            paused: drivers.filter((d) => d.enabled && !d.available).length,
            onRoute: drivers.filter((d) => d.onRouteOrders > 0).length,
            free: drivers.filter(
              (d) => d.enabled && d.available && d.activeOrders === 0,
            ).length,
            items: drivers,
          },
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15000,
      },
    );
  }
}
