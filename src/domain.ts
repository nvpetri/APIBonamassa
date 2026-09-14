import { z } from "zod";

export class RuleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 422,
  ) {
    super(message);
  }
}
export function ensure(
  value: unknown,
  code: string,
  message: string,
  status = 422,
): asserts value {
  if (!value) throw new RuleError(code, message, status);
}
export const cents = z.number().int().min(0).max(10_000_000);
export const shortText = (max: number) => z.string().trim().min(1).max(max);
export const uuid = z.uuid();
export const productId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,80}$/)
  .refine((v) => v !== "NONE");
export const sizeSchema = z.enum(["SMALL", "MEDIUM", "LARGE"]);
const quantity = z.number().int().min(1).max(20);
const note = z.string().trim().max(240);
const pizza = z.strictObject({
  kind: z.literal("PIZZA"),
  flavorIds: z
    .array(productId)
    .min(1)
    .max(2)
    .refine((v) => new Set(v).size === v.length, "Escolha sabores distintos."),
  size: sizeSchema,
  crust: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  quantity,
  note,
});
const drink = z.strictObject({ kind: z.literal("DRINK"), productId, quantity });
export const basicItem = z.discriminatedUnion("kind", [pizza, drink]);
export const itemSchema = z.discriminatedUnion("kind", [
  pizza,
  drink,
  z.strictObject({ kind: z.literal("COMBO"), productId, quantity, note }),
]);
export type Item = z.infer<typeof itemSchema>;
export const productFields = {
  name: shortText(80),
  description: note,
  category: z.enum(["PIZZA", "CRUST", "DRINK", "COMBO"]),
  pizzaGroup: z.enum(["TRADITIONAL", "SPECIAL"]).optional(),
  enabled: z.boolean(),
  prices: z.strictObject({
    SMALL: cents.positive(),
    MEDIUM: cents.positive(),
    LARGE: cents.positive(),
  }),
  combo: z.array(basicItem).min(2).max(6).optional(),
  imageId: uuid.nullable().default(null),
};
export const productSchema = z
  .strictObject({ id: productId, ...productFields })
  .superRefine((p, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if ((p.category === "COMBO") !== !!p.combo)
      fail(
        "Combos precisam de 2 a 6 componentes; outras categorias não aceitam composição.",
      );
    if ((p.category === "PIZZA") !== !!p.pizzaGroup)
      fail("Defina o grupo somente para pizzas.");
    if (
      p.category !== "PIZZA" &&
      (p.prices.SMALL !== p.prices.MEDIUM || p.prices.LARGE !== p.prices.MEDIUM)
    )
      fail("Bordas, bebidas e combos têm preço único.");
  });
export type Product = z.infer<typeof productSchema>;
export const createProductSchema = z.strictObject({
  id: productId.optional(),
  ...productFields,
});
export const versionSchema = z.number().int().positive();
export const editProductSchema = z.strictObject({
  ...productFields,
  expectedVersion: versionSchema,
});
export const promotionFields = {
  name: shortText(70),
  enabled: z.boolean(),
  kind: z.enum(["PERCENTAGE", "FIXED"]),
  value: cents.positive(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  pizzaLimit: z.number().int().min(1).max(100_000).nullable(),
};
export const promotionSchema = z
  .strictObject(promotionFields)
  .superRefine((p, ctx) => {
    if (
      (p.kind === "PERCENTAGE" && p.value > 100) ||
      (!p.endsAt && !p.pizzaLimit) ||
      (p.endsAt && Date.parse(p.endsAt) <= Date.parse(p.startsAt))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Informe desconto válido e prazo ou cota; o fim deve ser posterior ao início.",
      });
  });
export const editPromotionSchema = z.strictObject({
  ...promotionFields,
  expectedVersion: versionSchema,
});
export type Promotion = z.infer<typeof promotionSchema> & {
  id: string;
  version: number;
  reserved: number;
  sold: number;
};
export const addressSchema = z.strictObject({
  street: shortText(120),
  number: shortText(20),
  neighborhood: shortText(80),
  city: shortText(80),
  state: z.string().regex(/^[A-Z]{2}$/),
  postalCode: z.string().regex(/^\d{8}$/),
  reference: note,
});
export const phoneSchema = z
  .string()
  .regex(
    /^\+?[1-9]\d{9,14}$/,
    "Use DDD e número, somente dígitos, com código do país opcional.",
  );
export const customerSchema = z.strictObject({
  name: shortText(80),
  phone: phoneSchema,
});
export const quoteSchema = z
  .strictObject({
    items: z.array(itemSchema).min(1).max(30),
    mode: z.enum(["DELIVERY", "PICKUP"]),
    address: addressSchema.nullable(),
    note,
    payment: z.enum(["CASH", "CARD"]),
    cashTendered: cents.nullable(),
    promotionId: uuid.nullable(),
    allowScheduling: z.boolean().optional(),
    // Apenas atendimento/gestor; no app os dados vêm da sessão.
    customer: customerSchema.optional(),
    channel: z.enum(["WHATSAPP", "COUNTER"]).optional(),
  })
  .superRefine((d, ctx) => {
    if ((d.mode === "DELIVERY") !== !!d.address)
      ctx.addIssue({
        code: "custom",
        message: "Entrega exige endereço; retirada não aceita endereço.",
      });
    if (d.payment !== "CASH" && d.cashTendered !== null)
      ctx.addIssue({
        code: "custom",
        message: "Troco só se aplica a dinheiro.",
      });
  });
export type Draft = z.infer<typeof quoteSchema>;
export type SnapshotItem = {
  id: string;
  name: string;
  detail: string;
  note: string;
  quantity: number;
  unitPrice: number;
  components?: Omit<SnapshotItem, "id" | "unitPrice" | "components">[];
};
export type Discount = {
  id: string;
  version: number;
  name: string;
  kind: "PERCENTAGE" | "FIXED";
  value: number;
  pizzaQuantity: number;
  amount: number;
  lines: {
    itemId: string;
    quantity: number;
    baseUnitPrice: number;
    discountPerUnit: number;
  }[];
};
export type Priced = {
  items: SnapshotItem[];
  subtotal: number;
  fee: number;
  discount: number;
  total: number;
  promotion: Discount | null;
};
const sizeLabels = {
  SMALL: "Pequena · 4 fatias",
  MEDIUM: "Média · 6 fatias",
  LARGE: "Grande · 8 fatias",
};
function product(
  products: Product[],
  id: string,
  category: Product["category"],
  enabled: boolean,
) {
  const p = products.find((p) => p.id === id && p.category === category);
  ensure(p, "PRODUCT_NOT_FOUND", "Produto ou componente não encontrado.");
  ensure(
    !enabled || p.enabled,
    "PRODUCT_UNAVAILABLE",
    `Produto indisponível: ${p.name}.`,
  );
  return p;
}
function basicPrice(
  products: Product[],
  item: z.infer<typeof basicItem>,
  enabled: boolean,
): SnapshotItem {
  if (item.kind === "DRINK") {
    const p = product(products, item.productId, "DRINK", enabled);
    return {
      id: "",
      name: p.name,
      detail: p.description,
      note: "",
      quantity: item.quantity,
      unitPrice: p.prices.MEDIUM,
    };
  }
  const flavors = item.flavorIds.map((id) =>
    product(products, id, "PIZZA", enabled),
  );
  const crust =
    item.crust === "NONE"
      ? null
      : product(products, item.crust, "CRUST", enabled);
  return {
    id: "",
    name:
      flavors.length === 1
        ? flavors[0].name
        : flavors.map((p) => `½ ${p.name}`).join(" + "),
    detail: `${sizeLabels[item.size]} · ${crust?.name ?? "Sem borda recheada"}`,
    note: item.note,
    quantity: item.quantity,
    unitPrice:
      Math.max(...flavors.map((f) => f.prices[item.size])) +
      (crust?.prices.MEDIUM ?? 0),
  };
}
export function comboComparison(products: Product[], p: Product) {
  ensure(
    p.combo && p.category === "COMBO",
    "INVALID_COMBO",
    "Composição inválida.",
  );
  const individualTotal = p.combo.reduce(
    (sum, i) => sum + basicPrice(products, i, false).unitPrice * i.quantity,
    0,
  );
  const difference = individualTotal - p.prices.MEDIUM;
  return {
    individualTotal,
    difference,
    discountRate: Math.max(0, difference / individualTotal),
  };
}
export function validateRecipe(
  products: Product[],
  p: Product,
  enabled = false,
) {
  if (p.combo) for (const item of p.combo) basicPrice(products, item, enabled);
}
export function price(
  products: Product[],
  draft: Draft,
  fee: number,
  promotion: Promotion | null,
  now = new Date(),
): Priced {
  const items = draft.items.map((item, i): SnapshotItem => {
    if (item.kind !== "COMBO")
      return { ...basicPrice(products, item, true), id: `item-${i}` };
    const p = product(products, item.productId, "COMBO", true);
    ensure(p.combo, "INVALID_COMBO", "Composição inválida.");
    return {
      id: `item-${i}`,
      name: p.name,
      detail: p.description,
      note: item.note,
      quantity: item.quantity,
      unitPrice: p.prices.MEDIUM,
      components: p.combo.map((i) => {
        const { name, detail, note, quantity } = basicPrice(products, i, true);
        return { name, detail, note, quantity };
      }),
    };
  });
  let discount: Discount | null = null;
  if (draft.promotionId) {
    ensure(
      promotion && promotion.id === draft.promotionId,
      "PROMOTION_UNAVAILABLE",
      "Promoção não encontrada.",
    );
    ensure(
      promotion.enabled &&
        Date.parse(promotion.startsAt) <= +now &&
        (!promotion.endsAt || +now < Date.parse(promotion.endsAt)),
      "PROMOTION_UNAVAILABLE",
      "Promoção fora da vigência ou pausada.",
    );
    let remaining =
      promotion.pizzaLimit === null
        ? 600
        : promotion.pizzaLimit - promotion.sold - promotion.reserved;
    const lines: Discount["lines"] = [];
    draft.items.forEach((item, index) => {
      if (item.kind !== "PIZZA" || remaining <= 0) return;
      const baseUnitPrice = Math.max(
        ...item.flavorIds.map(
          (id) => product(products, id, "PIZZA", true).prices[item.size],
        ),
      );
      const discountPerUnit = Math.min(
        baseUnitPrice,
        promotion.kind === "PERCENTAGE"
          ? Math.round((baseUnitPrice * promotion.value) / 100)
          : promotion.value,
      );
      if (discountPerUnit === 0) return;
      const quantity = Math.min(remaining, item.quantity);
      remaining -= quantity;
      lines.push({
        itemId: items[index].id,
        quantity,
        baseUnitPrice,
        discountPerUnit,
      });
    });
    ensure(
      lines.length,
      "PROMOTION_UNAVAILABLE",
      "Sem pizzas elegíveis ou cota promocional disponível.",
    );
    discount = {
      id: promotion.id,
      version: promotion.version,
      name: promotion.name,
      kind: promotion.kind,
      value: promotion.value,
      lines,
      pizzaQuantity: lines.reduce((sum, l) => sum + l.quantity, 0),
      amount: lines.reduce((sum, l) => sum + l.quantity * l.discountPerUnit, 0),
    };
  }
  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const total = subtotal + fee - (discount?.amount ?? 0);
  ensure(
    subtotal <= 10_000_000 && total <= 10_000_000,
    "ORDER_TOO_LARGE",
    "O pedido excede o valor máximo permitido.",
  );
  ensure(
    draft.payment !== "CASH" ||
      draft.cashTendered === null ||
      draft.cashTendered >= total,
    "INVALID_CHANGE",
    "O valor em dinheiro deve cobrir o total.",
  );
  return {
    items,
    subtotal,
    fee,
    discount: discount?.amount ?? 0,
    total,
    promotion: discount,
  };
}

export const actionSchema = z.strictObject({ expectedVersion: versionSchema });
export const reasonSchema = actionSchema.extend({ reason: shortText(240) });
export const assignSchema = actionSchema.extend({ driverId: uuid });
export const completeSchema = actionSchema.extend({
  recipient: shortText(80),
  paymentCollected: z.boolean(),
});
export const paymentSchema = actionSchema.extend({ reference: shortText(240) });
export const createOrderSchema = z.strictObject({ quoteId: uuid });
export const availabilitySchema = actionSchema.extend({
  available: z.boolean(),
});
export const storeSchema = actionSchema.extend({
  name: shortText(100),
  open: z.boolean().optional(),
  scheduleEnabled: z.boolean().optional(),
  opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  confirmEarlyOpen: z.boolean().optional(),
  resumeSchedule: z.boolean().optional(),
  deliveryFee: cents.max(10000),
  driverFee: cents.max(10000),
});
export const emailSchema = z
  .email()
  .max(254)
  .transform((v) => v.trim().toLowerCase());
export const passwordSchema = z.string().min(12).max(128);
export const slugSchema = z.string().regex(/^[a-z0-9-]{1,60}$/);
export const loginSchema = z.strictObject({
  storeSlug: slugSchema,
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export const registerSchema = z.strictObject({
  storeSlug: slugSchema,
  email: emailSchema,
  password: passwordSchema,
  name: shortText(80),
  phone: phoneSchema,
});
export const staffSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  name: shortText(80),
  phone: phoneSchema,
  role: z.enum(["MANAGER", "ATTENDANT", "KITCHEN", "DRIVER"]),
});
export const editUserSchema = actionSchema.extend({ enabled: z.boolean() });
export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export const orderStatuses = [
  "SCHEDULED",
  "NEW",
  "CONFIRMED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "RETURNING",
  "DELIVERED",
  "RETURNED",
  "CANCELLED",
] as const;
export const listSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(500).optional(),
  status: z.enum(orderStatuses).optional(),
});
