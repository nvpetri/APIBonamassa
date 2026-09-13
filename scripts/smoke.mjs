import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const base = process.env.API_URL ?? "http://localhost:3001";
const storeSlug = process.env.SEED_STORE_SLUG ?? "bonamassa";
let token;
async function request(path, method = "GET", body, key = randomUUID()) {
  const response = await fetch(`${base}/v1/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(`${response.status} ${result.code}: ${result.message}`);
  return result;
}
try {
  if (!process.env.SEED_MANAGER_EMAIL || !process.env.SEED_MANAGER_PASSWORD)
    throw new Error(
      "Defina SEED_MANAGER_EMAIL e SEED_MANAGER_PASSWORD no .env.",
    );
  const session = await request("sessions", "POST", {
    storeSlug,
    email: process.env.SEED_MANAGER_EMAIL,
    password: process.env.SEED_MANAGER_PASSWORD,
  });
  token = session.accessToken;
  const catalog = await request(`stores/${storeSlug}/catalog`);
  const flavor = catalog.products.find((p) => p.category === "PIZZA");
  if (!catalog.store.open || !flavor)
    throw new Error(
      "Use uma loja de desenvolvimento aberta, com ao menos um sabor cadastrado.",
    );
  const quote = await request("orders/quote", "POST", {
    items: [
      {
        kind: "PIZZA",
        flavorIds: [flavor.id],
        size: "LARGE",
        crust: "NONE",
        quantity: 1,
        note: "Pedido de teste da API",
      },
    ],
    mode: "PICKUP",
    address: null,
    note: "Teste automatizado em ambiente de desenvolvimento",
    payment: "CASH",
    cashTendered: null,
    promotionId: null,
    customer: { name: "Cliente de teste", phone: "5500000000000" },
    channel: "COUNTER",
  });
  const key = randomUUID();
  let order = await request(
    "staff/orders",
    "POST",
    { quoteId: quote.quoteId },
    key,
  );
  assert.deepEqual(
    await request("staff/orders", "POST", { quoteId: quote.quoteId }, key),
    order,
  );
  for (const action of ["accept", "prepare", "ready"])
    order = await request(`staff/orders/${order.id}/${action}`, "POST", {
      expectedVersion: order.version,
    });
  order = await request(`staff/orders/${order.id}/pickup-complete`, "POST", {
    expectedVersion: order.version,
    recipient: "Cliente de teste",
    paymentCollected: true,
  });
  assert.equal(order.status, "DELIVERED");
  console.log(
    `Pedido de teste #${order.number}: ${order.status}. Cotação, idempotência, cozinha e retirada verificados.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (token) await request("sessions/current", "DELETE").catch(() => {});
}
