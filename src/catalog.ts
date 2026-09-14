import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { Actor } from "./auth";
import { Db, json, tokenHash } from "./db";
import {
  Product,
  Promotion,
  comboComparison,
  createProductSchema,
  editProductSchema,
  editPromotionSchema,
  ensure,
  productSchema,
  promotionSchema,
  storeSchema,
  validateRecipe,
} from "./domain";
import { Writes, audit, checkVersion } from "./writes";
import { operation, operationDto } from "./schedule";
import { SchedulingService } from "./scheduling";

export const decodeProduct = (row: {
  id: string;
  data: Prisma.JsonValue;
  imageId: string | null;
}): Product =>
  productSchema.parse({
    ...(row.data as object),
    id: row.id,
    imageId: row.imageId,
  });
export const decodePromotion = (row: {
  id: string;
  version: number;
  data: Prisma.JsonValue;
  reserved: number;
  sold: number;
}): Promotion => ({
  ...promotionSchema.parse(row.data),
  id: row.id,
  version: row.version,
  reserved: row.reserved,
  sold: row.sold,
});
export function promotionDto(
  row: Parameters<typeof decodePromotion>[0],
  now = new Date(),
) {
  const p = decodePromotion(row);
  const remaining =
    p.pizzaLimit === null ? null : p.pizzaLimit - p.sold - p.reserved;
  const status = !p.enabled
    ? "PAUSED"
    : Date.parse(p.startsAt) > +now
      ? "SCHEDULED"
      : p.endsAt && Date.parse(p.endsAt) <= +now
        ? "ENDED"
        : remaining === 0
          ? "EXHAUSTED"
          : "ACTIVE";
  return { ...p, remaining, status };
}
@Injectable()
export class CatalogService {
  constructor(
    private readonly db: Db,
    private readonly writes: Writes,
    private readonly scheduling: SchedulingService,
  ) {}
  async catalog(slug: string, staff = false) {
    const target = await this.db.store.findUnique({ where: { slug } });
    ensure(target, "STORE_NOT_FOUND", "Loja não encontrada.", 404);
    await this.scheduling.reconcile(target.id);
    return this.db.$transaction(
      async (tx) => {
        const store = await tx.store.findUnique({ where: { slug } });
        ensure(store, "STORE_NOT_FOUND", "Loja não encontrada.", 404);
        const rows = await tx.product.findMany({
          where: { storeId: store.id },
          orderBy: { id: "asc" },
        });
        const products = rows.map(decodeProduct);
        const result = products.map((p, i) => {
          let unavailableReason = p.enabled ? null : "Produto pausado";
          if (!unavailableReason)
            try {
              validateRecipe(products, p, true);
            } catch {
              unavailableReason = "Um componente do combo está indisponível";
            }
          return {
            ...p,
            version: rows[i].version,
            photo: p.imageId ? `/v1/stores/${slug}/images/${p.imageId}` : null,
            available: !unavailableReason,
            unavailableReason,
            ...(p.category === "COMBO"
              ? { comparison: comboComparison(products, p) }
              : {}),
          };
        });
        const promotions = (
          await tx.promotion.findMany({
            where: { storeId: store.id },
            orderBy: { id: "asc" },
          })
        ).map((p) => promotionDto(p));
        return {
          store: {
            id: store.id,
            slug,
            name: store.name,
            ...operationDto(store),
            deliveryFee: store.deliveryFee,
            ...(staff ? { driverFee: store.driverFee } : {}),
            version: store.version,
          },
          sizes: ["SMALL", "MEDIUM", "LARGE"],
          paymentMethods: ["CASH", "CARD"],
          rules: {
            pizzaPrice: "HIGHEST_FLAVOR",
            maxFlavors: 2,
            promotionExcludes: ["CRUST", "DRINK", "COMBO", "DELIVERY_FEE"],
            comboComposition: "FIXED",
          },
          products: staff ? result : result.filter((p) => p.available),
          promotions: staff
            ? promotions
            : promotions
                .filter((p) => p.status === "ACTIVE")
                .map(({ reserved: _reserved, sold: _sold, ...p }) => p),
          serverTime: new Date(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async staffCatalog(actor: Actor) {
    const store = await this.db.store.findUniqueOrThrow({
      where: { id: actor.storeId },
    });
    return this.catalog(store.slug, true);
  }
  saveProduct(
    actor: Actor,
    key: string,
    input:
      z.infer<typeof createProductSchema> | z.infer<typeof editProductSchema>,
    id?: string,
  ) {
    return this.writes.run(
      actor,
      key,
      `product:${id ?? "new"}`,
      input,
      async (tx) => {
        const records = await tx.product.findMany({
          where: { storeId: actor.storeId },
        });
        const previous = id ? records.find((p) => p.id === id) : null;
        if (id) {
          ensure(previous, "NOT_FOUND", "Produto não encontrado.", 404);
          checkVersion(
            previous.version,
            (input as z.infer<typeof editProductSchema>).expectedVersion,
          );
        } else
          ensure(
            records.length < 200,
            "CATALOG_LIMIT",
            "Limite de 200 produtos atingido.",
          );
        const { expectedVersion: _version, ...fields } = input as z.infer<
          typeof editProductSchema
        >;
        const p = productSchema.parse({
          ...fields,
          id:
            id ??
            (input as z.infer<typeof createProductSchema>).id ??
            randomUUID(),
        });
        ensure(
          !previous || previous.category === p.category,
          "CATEGORY_IMMUTABLE",
          "A categoria de um produto existente não pode ser alterada; pause-o e cadastre outro.",
        );
        if (p.imageId)
          ensure(
            await tx.productImage.findUnique({
              where: { storeId_id: { storeId: actor.storeId, id: p.imageId } },
              select: { id: true },
            }),
            "INVALID_IMAGE",
            "Foto não encontrada nesta loja.",
          );
        const products = records
          .filter((r) => r.id !== p.id)
          .map(decodeProduct)
          .concat(p);
        validateRecipe(products, p);
        const data = {
          category: p.category,
          nameKey: p.name
            .normalize("NFKD")
            .replace(/\p{M}/gu, "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase(),
          data: json(p),
          imageId: p.imageId,
        };
        const saved = previous
          ? await tx.product.update({
              where: { storeId_id: { storeId: actor.storeId, id: p.id } },
              data: { ...data, version: { increment: 1 } },
            })
          : await tx.product.create({
              data: { ...data, storeId: actor.storeId, id: p.id },
            });
        await tx.store.update({
          where: { id: actor.storeId },
          data: { version: { increment: 1 } },
        });
        await audit(
          tx,
          actor,
          previous ? "product.updated" : "product.created",
          { product: p, version: saved.version },
        );
        return {
          data: { ...p, version: saved.version },
          events: [{ type: "catalog.updated", storeId: actor.storeId }],
        };
      },
    );
  }
  async promotions(actor: Actor) {
    return (
      await this.db.promotion.findMany({
        where: { storeId: actor.storeId },
        orderBy: { id: "asc" },
      })
    ).map((p) => promotionDto(p));
  }
  savePromotion(
    actor: Actor,
    key: string,
    input:
      z.infer<typeof promotionSchema> | z.infer<typeof editPromotionSchema>,
    id?: string,
  ) {
    return this.writes.run(
      actor,
      key,
      `promotion:${id ?? "new"}`,
      input,
      async (tx) => {
        const { expectedVersion: _version, ...fields } = input as z.infer<
          typeof editPromotionSchema
        >;
        const p = promotionSchema.parse(fields);
        const previous = id
          ? await tx.promotion.findUnique({
              where: { storeId_id: { storeId: actor.storeId, id } },
            })
          : null;
        if (id) {
          ensure(previous, "NOT_FOUND", "Promoção não encontrada.", 404);
          checkVersion(
            previous.version,
            (input as z.infer<typeof editPromotionSchema>).expectedVersion,
          );
        } else
          ensure(
            (await tx.promotion.count({ where: { storeId: actor.storeId } })) <
              500,
            "PROMOTION_LIMIT",
            "Limite de 500 campanhas atingido.",
          );
        ensure(
          p.pizzaLimit === null ||
            p.pizzaLimit >= (previous?.sold ?? 0) + (previous?.reserved ?? 0),
          "INVALID_QUOTA",
          "A cota não pode ser menor que as pizzas já vendidas ou reservadas.",
        );
        const data = { data: json(p), pizzaLimit: p.pizzaLimit };
        const saved = previous
          ? await tx.promotion.update({
              where: {
                storeId_id: { storeId: actor.storeId, id: previous.id },
              },
              data: { ...data, version: { increment: 1 } },
            })
          : await tx.promotion.create({
              data: { ...data, id: randomUUID(), storeId: actor.storeId },
            });
        await audit(
          tx,
          actor,
          previous ? "promotion.updated" : "promotion.created",
          { promotion: p, id: saved.id, version: saved.version },
        );
        return {
          data: promotionDto(saved),
          events: [{ type: "promotion.updated", storeId: actor.storeId }],
        };
      },
    );
  }
  saveStore(actor: Actor, key: string, input: z.infer<typeof storeSchema>) {
    return this.writes.run(actor, key, "store:update", input, async (tx) => {
      ensure(
        actor.role === "MANAGER",
        "FORBIDDEN",
        "Somente o gerente pode alterar a operação.",
        403,
      );
      const previous = await tx.store.findUniqueOrThrow({
        where: { id: actor.storeId },
      });
      checkVersion(previous.version, input.expectedVersion);
      const {
        expectedVersion: _version,
        open,
        confirmEarlyOpen,
        resumeSchedule,
        ...data
      } = input;
      const candidate = { ...previous, ...data };
      ensure(
        candidate.opensAt !== candidate.closesAt,
        "INVALID_HOURS",
        "A abertura e o fechamento devem ter horários diferentes.",
        400,
      );
      const changedHours =
        candidate.opensAt !== previous.opensAt ||
        candidate.closesAt !== previous.closesAt ||
        candidate.scheduleEnabled !== previous.scheduleEnabled;
      // Do not silently rewrite a time already promised to a customer.
      if (changedHours) {
        ensure(
          !(await tx.order.count({
            where: { storeId: actor.storeId, status: "SCHEDULED" },
          })),
          "SCHEDULE_HAS_RESERVATIONS",
          "Há pedidos agendados. Atenda ou cancele essas reservas antes de mudar o horário.",
          409,
        );
      }
      if (changedHours || resumeSchedule) {
        candidate.overrideOpen = null;
        candidate.overrideUntil = null;
      }
      const now = new Date();
      const state = operation(candidate, now);
      if (open !== undefined && open !== state.open) {
        ensure(
          !open ||
            !candidate.scheduleEnabled ||
            state.scheduledOpen ||
            confirmEarlyOpen,
          "EARLY_OPEN_CONFIRMATION_REQUIRED",
          "Confirme a abertura fora do horário. As reservas da próxima abertura serão liberadas.",
          409,
        );
        if (candidate.scheduleEnabled) {
          candidate.overrideOpen = open;
          candidate.overrideUntil = state.nextBoundary;
        } else {
          candidate.open = open;
        }
      }
      const saved = await tx.store.update({
        where: { id: actor.storeId },
        data: {
          ...data,
          open: operation(candidate, now).open,
          overrideOpen: candidate.overrideOpen,
          overrideUntil: candidate.overrideUntil,
          version: { increment: 1 },
        },
      });
      const result = await this.scheduling.sync(tx, saved, now);
      await audit(tx, actor, "store.updated", {
        ...data,
        open,
        confirmEarlyOpen,
        resumeSchedule,
        overrideUntil: result.store.overrideUntil,
      });
      return {
        data: {
          id: result.store.id,
          slug: result.store.slug,
          name: result.store.name,
          ...operationDto(result.store, now),
          deliveryFee: result.store.deliveryFee,
          driverFee: result.store.driverFee,
          version: result.store.version,
        },
        events: [
          { type: "store.updated", storeId: actor.storeId },
          ...result.events,
        ],
      };
    });
  }
  async uploadImage(actor: Actor, key: string, buffer: Buffer) {
    let bytes: Buffer;
    try {
      const image = sharp(buffer, {
        limitInputPixels: 16_000_000,
        animated: false,
        failOn: "warning",
      });
      const meta = await image.metadata();
      ensure(
        ["jpeg", "png", "webp"].includes(meta.format ?? "") &&
          (meta.pages ?? 1) === 1,
        "INVALID_IMAGE",
        "Envie JPEG, PNG ou WebP estático.",
      );
      bytes = await image
        .rotate()
        .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
    } catch {
      ensure(
        false,
        "INVALID_IMAGE",
        "Imagem inválida ou acima de 16 megapixels.",
      );
    }
    ensure(
      bytes.length <= 1_048_576,
      "IMAGE_TOO_LARGE",
      "A foto otimizada deve ter no máximo 1 MB.",
    );
    const digest = tokenHash(bytes.toString("base64"));
    return this.writes.run(
      actor,
      key,
      "image:upload",
      { digest },
      async (tx) => {
        const usage = await tx.$queryRaw<
          { bytes: number }[]
        >`SELECT COALESCE(SUM(octet_length("bytes")), 0)::int AS bytes FROM "ProductImage" WHERE "storeId" = ${actor.storeId}::uuid`;
        ensure(
          usage[0].bytes + bytes.length <= 100 * 1024 * 1024,
          "STORAGE_LIMIT",
          "Limite de 100 MB de imagens da loja atingido.",
        );
        const saved = await tx.productImage.create({
          data: {
            storeId: actor.storeId,
            bytes: new Uint8Array(bytes),
            digest,
          },
          select: { id: true },
        });
        return {
          data: {
            imageId: saved.id,
            contentType: "image/webp",
            size: bytes.length,
          },
        };
      },
    );
  }
  async image(slug: string, id: string) {
    const image = await this.db.productImage.findFirst({
      where: { id, store: { slug }, products: { some: {} } },
    });
    ensure(image, "NOT_FOUND", "Foto não encontrada.", 404);
    return image;
  }
}
