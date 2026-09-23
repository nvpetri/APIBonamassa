import { test } from "node:test";
import assert from "node:assert/strict";
import { demoProducts } from "../prisma/seed";
import {
  Draft,
  Promotion,
  comboComparison,
  price,
  productSchema,
  promotionSchema,
  quoteSchema,
} from "../src/domain";

const pizza: Draft["items"][number] = {
  kind: "PIZZA",
  flavorIds: ["calabresa", "frango"],
  size: "LARGE",
  crust: "CREAM",
  quantity: 1,
  note: "Sem cebola",
};
const draft: Draft = {
  items: [pizza],
  mode: "PICKUP",
  address: null,
  note: "",
  payment: "CASH",
  cashTendered: null,
  promotionId: null,
};
const promo: Promotion = {
  id: "c00e965f-276b-423d-8cdb-8ed3e8b52e22",
  version: 1,
  name: "Promoção",
  kind: "PERCENTAGE",
  value: 10,
  enabled: true,
  startsAt: "2026-01-01T00:00:00Z",
  endsAt: null,
  pizzaLimit: 5,
  reserved: 0,
  sold: 0,
};
const now = new Date("2026-06-01T00:00:00Z");
test("meio a meio cobra maior sabor e uma borda por pizza", () => {
  const result = price(
    demoProducts,
    { ...draft, items: [{ ...pizza, quantity: 2 }] },
    700,
    null,
  );
  assert.equal(result.items[0].unitPrice, 7000);
  assert.equal(result.total, 14700);
  assert.equal(result.pizzaQuantity, 2);
});
test("combo usa preço fechado, receita por unidade e referência avulsa independente", () => {
  const result = price(
    demoProducts,
    {
      ...draft,
      items: [
        { kind: "COMBO", productId: "combo-dupla", quantity: 2, note: "" },
      ],
    },
    0,
    null,
  );
  assert.equal(result.total, 13000);
  assert.equal(result.pizzaQuantity, 2);
  assert.equal(result.items[0].components?.[0].quantity, 1);
  const comparison = comboComparison(demoProducts, demoProducts.at(-1)!);
  assert.equal(comparison.individualTotal, 7400);
  assert.equal(comparison.difference, 900);
});
test("reajuste de ingrediente não altera preço fechado do combo", () => {
  const changed = demoProducts.map((p) =>
    p.id === "frango"
      ? { ...p, prices: { SMALL: 7000, MEDIUM: 8000, LARGE: 9000 } }
      : p,
  );
  assert.equal(
    price(
      changed,
      {
        ...draft,
        items: [
          { kind: "COMBO", productId: "combo-dupla", quantity: 1, note: "" },
        ],
      },
      0,
      null,
    ).total,
    6500,
  );
  assert.equal(
    comboComparison(changed, changed.at(-1)!).individualTotal,
    10400,
  );
});
test("ingrediente pausado bloqueia novas vendas do combo", () => {
  const changed = demoProducts.map((p) =>
    p.id === "frango" ? { ...p, enabled: false } : p,
  );
  assert.throws(
    () =>
      price(
        changed,
        {
          ...draft,
          items: [
            { kind: "COMBO", productId: "combo-dupla", quantity: 1, note: "" },
          ],
        },
        0,
        null,
      ),
    /indisponível/,
  );
});
test("promoção aplica cota parcial e exclui borda, bebida, combo e entrega", () => {
  const result = price(
    demoProducts,
    {
      ...draft,
      promotionId: promo.id,
      items: [
        { ...pizza, quantity: 3 },
        { kind: "DRINK", productId: "refrigerante-2l", quantity: 1 },
        { kind: "COMBO", productId: "combo-dupla", quantity: 1, note: "" },
      ],
    },
    700,
    { ...promo, reserved: 2, sold: 1 },
    now,
  );
  assert.equal(result.discount, 1200);
  assert.equal(result.promotion?.pizzaQuantity, 2);
  assert.equal(result.promotion?.lines.length, 1);
  assert.equal(result.total, 28400);
});
test("desconto fixo limita-se ao preço do sabor, preservando borda", () => {
  const result = price(
    demoProducts,
    { ...draft, promotionId: promo.id },
    0,
    { ...promo, kind: "FIXED", value: 99999 },
    now,
  );
  assert.equal(result.discount, 6000);
  assert.equal(result.total, 1000);
});
test("desconto percentual arredonda por unidade em centavos", () => {
  const products = demoProducts.map((p) =>
    p.id === "frango"
      ? { ...p, prices: { SMALL: 5555, MEDIUM: 5555, LARGE: 5555 } }
      : p,
  );
  assert.equal(
    price(products, { ...draft, promotionId: promo.id }, 0, promo, now)
      .discount,
    556,
  );
});
test("fim da vigência é exclusivo e cota esgotada não é silenciosamente ignorada", () => {
  assert.throws(
    () =>
      price(
        demoProducts,
        { ...draft, promotionId: promo.id },
        0,
        { ...promo, endsAt: now.toISOString() },
        now,
      ),
    /vigência/,
  );
  assert.throws(
    () =>
      price(
        demoProducts,
        { ...draft, promotionId: promo.id },
        0,
        { ...promo, sold: 5 },
        now,
      ),
    /cota/,
  );
});
test("promoção exige vigência ou cota e valida percentual", () => {
  const {
    id: _id,
    version: _version,
    reserved: _reserved,
    sold: _sold,
    ...input
  } = promo;
  assert.equal(
    promotionSchema.safeParse({ ...input, value: 101 }).success,
    false,
  );
  assert.equal(
    promotionSchema.safeParse({ ...input, pizzaLimit: null }).success,
    false,
  );
});
test("schemas rejeitam total do cliente, sabores duplicados, combo recursivo e campos estranhos", () => {
  assert.equal(quoteSchema.safeParse({ ...draft, total: 1 }).success, false);
  assert.equal(
    quoteSchema.safeParse({
      ...draft,
      items: [{ ...pizza, flavorIds: ["frango", "frango"] }],
    }).success,
    false,
  );
  assert.equal(
    productSchema.safeParse({
      ...demoProducts.at(-1),
      combo: [
        { kind: "COMBO", productId: "combo-dupla", quantity: 2, note: "" },
      ],
    }).success,
    false,
  );
});
test("retirada recusa endereço, cartão recusa troco e dinheiro precisa cobrir total", () => {
  assert.equal(quoteSchema.safeParse({ ...draft, address: {} }).success, false);
  assert.equal(
    quoteSchema.safeParse({ ...draft, payment: "CARD", cashTendered: 10000 })
      .success,
    false,
  );
  assert.throws(
    () => price(demoProducts, { ...draft, cashTendered: 100 }, 0, null),
    /cobrir/,
  );
});
test("preço único e grupo de pizza são validados por categoria", () => {
  assert.equal(
    productSchema.safeParse({
      ...demoProducts.at(-1),
      prices: { SMALL: 1, MEDIUM: 2, LARGE: 3 },
    }).success,
    false,
  );
  assert.equal(
    productSchema.safeParse({ ...demoProducts[0], pizzaGroup: undefined })
      .success,
    false,
  );
});

test("desconto não permite subtotal acima do limite nem overflow no banco", () => {
  const products = demoProducts.map((p) =>
    p.category === "PIZZA"
      ? {
          ...p,
          prices: { SMALL: 10_000_000, MEDIUM: 10_000_000, LARGE: 10_000_000 },
        }
      : p,
  );
  assert.throws(
    () =>
      price(
        products,
        {
          ...draft,
          promotionId: promo.id,
          items: [{ ...pizza, crust: "NONE", quantity: 20 }],
        },
        0,
        { ...promo, value: 100, pizzaLimit: null },
        now,
      ),
    /valor máximo/,
  );
});

test("métrica de pizzas inclui quantidades da receita e exclui bebidas", () => {
  const products = structuredClone(demoProducts);
  const combo = products.find((p) => p.id === "combo-dupla")!;
  const ingredient = combo.combo!.find((i) => i.kind === "PIZZA")!;
  ingredient.quantity = 2;
  const result = price(
    products,
    {
      ...draft,
      items: [
        { ...pizza, quantity: 3 },
        { kind: "COMBO", productId: combo.id, quantity: 4, note: "" },
        { kind: "DRINK", productId: "refrigerante-2l", quantity: 5 },
      ],
    },
    0,
    null,
  );
  assert.equal(result.pizzaQuantity, 11);
  ingredient.quantity = 5;
  assert.equal(result.pizzaQuantity, 11);
});
