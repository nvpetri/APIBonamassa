import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { io, Socket } from "socket.io-client";
import sharp from "sharp";
import { createApp } from "../src/app";
import { hashPassword } from "../src/auth";
import { seedStore } from "../prisma/seed";

function socketEvent(socket: Socket, event: string) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Socket não emitiu ${event}`)),
      5000,
    );
    socket.once(event, () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

// Deliberately exercises HTTP + PostgreSQL. No repository, transaction or auth mocks.
test(
  "API com PostgreSQL: contratos, autorização e concorrência",
  { timeout: 120000 },
  async (t) => {
    assert.ok(
      process.env.TEST_DATABASE_URL,
      "Defina TEST_DATABASE_URL apontando para um banco separado com migrations aplicadas.",
    );
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(
      url.pathname.includes("test"),
      'O nome do banco de integração deve conter "test".',
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.NODE_ENV = "test";
    process.env.DOCS_ENABLED = "true";
    process.env.CORS_ORIGINS = "http://localhost:3000";
    const db = new PrismaClient();
    const slug = `test-${randomUUID().slice(0, 8)}`;
    const password = `Test-${randomUUID()}`;
    const main = await seedStore(db, {
      slug,
      email: "manager@example.com",
      password,
      demo: true,
    });
    const other = await seedStore(db, {
      slug: `${slug}-other`,
      email: "manager@example.com",
      password,
      demo: true,
    });
    const storeIds = [main.store.id, other.store.id];
    const passwordHash = await hashPassword(password);
    const tokens: Record<string, string> = {};
    const ids: Record<string, string> = {};
    let app = await createApp(true);
    await app.listen(0, "127.0.0.1");
    let base = await app.getUrl();
    const sockets: Socket[] = [];
    // Dynamic JSON bodies are confined to this HTTP assertion helper.
    async function api(
      path: string,
      who?: string,
      method = "GET",
      body?: unknown,
      key: string = randomUUID(),
    ): Promise<{ status: number; data: any; headers: Headers }> {
      const response = await fetch(`${base}/v1/${path}`, {
        method,
        headers: {
          ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          "Idempotency-Key": key,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      return { status: response.status, data, headers: response.headers };
    }
    async function ok(
      path: string,
      who?: string,
      method = "GET",
      body?: unknown,
      key?: string,
    ) {
      const r = await api(path, who, method, body, key);
      assert.ok(
        r.status < 300,
        `${method} ${path}: ${r.status} ${JSON.stringify(r.data)}`,
      );
      return r.data;
    }
    async function login(
      who: string,
      storeSlug = slug,
      email = `${who}@example.com`,
    ) {
      const r = await ok("sessions", undefined, "POST", {
        storeSlug,
        email,
        password,
      });
      tokens[who] = r.accessToken;
      ids[who] = r.user.id;
    }
    const draft = {
      items: [
        {
          kind: "PIZZA",
          flavorIds: ["calabresa", "frango"],
          size: "LARGE",
          crust: "CREAM",
          quantity: 1,
          note: "Sem cebola",
        },
      ],
      mode: "DELIVERY",
      address: {
        street: "Rua de Teste",
        number: "10",
        neighborhood: "Centro",
        city: "Cidade Exemplo",
        state: "SP",
        postalCode: "01001000",
        reference: "Portão de teste",
      },
      note: "",
      payment: "CASH",
      cashTendered: 10000,
      promotionId: null,
    };
    async function order(
      who = "customer",
      extra: Record<string, unknown> = {},
    ) {
      const quote = await ok("orders/quote", who, "POST", {
        ...draft,
        ...extra,
      });
      return ok(who === "manager" ? "staff/orders" : "orders", who, "POST", {
        quoteId: quote.quoteId,
      });
    }
    async function cmd(
      order: any,
      action: string,
      who = "manager",
      extra: Record<string, unknown> = {},
      key?: string,
    ) {
      const prefix = who.startsWith("driver")
        ? "driver/deliveries"
        : who === "customer"
          ? "orders"
          : "staff/orders";
      return ok(
        `${prefix}/${order.id}/${action}`,
        who,
        "POST",
        { expectedVersion: order.version, ...extra },
        key,
      );
    }
    async function ready(o: any) {
      return cmd(
        await cmd(await cmd(o, "accept"), "prepare", "kitchen"),
        "ready",
        "kitchen",
      );
    }
    async function assigned(o: any) {
      return cmd(await ready(o), "assign", "manager", { driverId: ids.driver });
    }
    async function route(o: any) {
      return cmd(
        await cmd(await assigned(o), "collect", "driver"),
        "start",
        "driver",
      );
    }
    const campaign = {
      name: "Última pizza",
      kind: "PERCENTAGE",
      value: 10,
      enabled: true,
      startsAt: new Date(Date.now() - 10000).toISOString(),
      endsAt: null,
      pizzaLimit: 1,
    };
    try {
      for (const [name, role] of Object.entries({
        customer: "CUSTOMER",
        customer2: "CUSTOMER",
        kitchen: "KITCHEN",
        driver: "DRIVER",
        driver2: "DRIVER",
        attendant: "ATTENDANT",
      })) {
        await db.user.create({
          data: {
            storeId: main.store.id,
            email: `${name}@example.com`,
            name,
            phone: "5500000000000",
            passwordHash,
            role: role as Role,
          },
        });
        await login(name);
      }
      await login("manager", slug, "manager@example.com");
      await login("other", other.store.slug, "manager@example.com");

      await t.test(
        "horários, reservas, confirmação antecipada e liberação idempotente",
        async () => {
          const initial = (await ok("staff/catalog", "manager")).store;
          const clock = (offset: number) =>
            new Intl.DateTimeFormat("en-GB", {
              timeZone: "America/Sao_Paulo",
              hour: "2-digit",
              minute: "2-digit",
              hourCycle: "h23",
            }).format(new Date(Date.now() + offset * 60_000));
          async function settings(
            patch: Record<string, unknown>,
            who = "manager",
          ) {
            const current = (await ok("staff/catalog", "manager")).store;
            return api("staff/store", who, "PATCH", {
              expectedVersion: current.version,
              name: current.name,
              deliveryFee: current.deliveryFee,
              driverFee: current.driverFee,
              ...patch,
            });
          }
          const configured = await settings({
            scheduleEnabled: true,
            opensAt: clock(60),
            closesAt: clock(180),
          });
          assert.equal(configured.status, 200);
          assert.equal(configured.data.open, false);
          assert.equal(configured.data.timeZone, "America/Sao_Paulo");
          assert.equal(
            (await settings({ open: true }, "attendant")).status,
            403,
          );
          assert.equal(
            (await settings({ opensAt: "17:00", closesAt: "17:00" })).status,
            400,
          );
          assert.equal((await settings({ opensAt: "25:00" })).status, 400);
          assert.equal(
            (await api("orders/quote", "customer", "POST", draft)).data.code,
            "STORE_CLOSED",
          );
          const quoted = await ok("orders/quote", "customer", "POST", {
            ...draft,
            allowScheduling: true,
          });
          assert.equal(quoted.scheduledFor, configured.data.nextOpening);
          const key = randomUUID();
          const reserved = await ok(
            "orders",
            "customer",
            "POST",
            { quoteId: quoted.quoteId },
            key,
          );
          assert.equal(reserved.status, "SCHEDULED");
          assert.equal(reserved.scheduledFor, quoted.scheduledFor);
          assert.equal(
            (
              await ok(
                "orders",
                "customer",
                "POST",
                { quoteId: quoted.quoteId },
                key,
              )
            ).id,
            reserved.id,
          );
          assert.ok(
            (await ok("staff/orders", "manager")).items.some(
              (o: any) => o.id === reserved.id,
            ),
          );
          assert.ok(
            !(await ok("staff/orders", "kitchen")).items.some(
              (o: any) => o.id === reserved.id,
            ),
          );
          assert.equal(
            (await api(`staff/orders/${reserved.id}`, "kitchen")).status,
            404,
          );
          assert.equal(
            (
              await api(
                `staff/orders/${reserved.id}/accept`,
                "manager",
                "POST",
                { expectedVersion: reserved.version },
              )
            ).status,
            409,
          );
          assert.equal(
            (await settings({ opensAt: clock(90) })).data.code,
            "SCHEDULE_HAS_RESERVATIONS",
          );
          assert.equal(
            (await settings({ open: true })).data.code,
            "EARLY_OPEN_CONFIRMATION_REQUIRED",
          );
          assert.equal(
            (await ok(`orders/${reserved.id}`, "customer")).status,
            "SCHEDULED",
          );
          const toCancel = await order("customer", { allowScheduling: true });
          assert.equal(
            (
              await cmd(toCancel, "cancel", "customer", {
                reason: "Cancelamento da reserva de teste",
              })
            ).status,
            "CANCELLED",
          );
          const pendingQuote = await ok("orders/quote", "customer", "POST", {
            ...draft,
            allowScheduling: true,
          });
          const opened = await settings({ open: true, confirmEarlyOpen: true });
          assert.equal(opened.status, 200);
          assert.equal(opened.data.open, true);
          assert.ok(opened.data.overrideUntil);
          const released = await ok(`orders/${reserved.id}`, "customer");
          assert.equal(released.status, "NEW");
          assert.equal(released.scheduledFor, reserved.scheduledFor);
          assert.equal(released.version, reserved.version + 1);
          await ok("staff/catalog", "manager");
          const repeated = await ok(`orders/${reserved.id}`, "customer");
          assert.equal(
            repeated.events.filter((e: any) => e.action === "schedule-released")
              .length,
            1,
          );
          assert.equal(
            (
              await api("orders", "customer", "POST", {
                quoteId: pendingQuote.quoteId,
              })
            ).data.code,
            "QUOTE_CHANGED",
          );
          await cmd(released, "cancel", "customer", {
            reason: "Fim do cenário de reserva",
          });
          assert.equal(
            (
              await settings({
                scheduleEnabled: false,
                open: initial.open,
                opensAt: initial.opensAt,
                closesAt: initial.closesAt,
              })
            ).status,
            200,
          );
        },
      );

      await t.test(
        "health e OpenAPI; autenticação obrigatória e campos privados ausentes",
        async () => {
          assert.equal((await ok("health")).status, "ok");
          const doc = await ok("openapi.json");
          assert.ok(doc.paths["/v1/orders/quote"]);
          assert.ok(doc.paths["/v1/driver/deliveries/{id}/complete"]);
          assert.equal((await api("staff/orders")).status, 401);
          assert.equal((await api("staff/users", "customer")).status, 403);
          assert.equal(
            (await api("staff/orders/not-uuid", "manager")).status,
            400,
          );
          const me = await ok("me", "manager");
          assert.equal(me.passwordHash, undefined);
          const catalog = await ok(`stores/${slug}/catalog`);
          assert.equal(catalog.products.length, 7);
          assert.equal(catalog.store.driverFee, undefined);
        },
      );
      await t.test(
        "cadastro não permite escolher perfil; preços e cliente não vêm do app",
        async () => {
          assert.equal(
            (
              await api("customers", undefined, "POST", {
                storeSlug: slug,
                email: "new@example.com",
                password,
                name: "Teste",
                phone: "5500000000000",
                role: "MANAGER",
              })
            ).status,
            400,
          );
          const account = await ok("customers", undefined, "POST", {
            storeSlug: slug,
            email: "new@example.com",
            password,
            name: "Teste",
            phone: "5500000000000",
          });
          assert.equal(account.user.role, "CUSTOMER");
          assert.equal(
            (
              await api("orders/quote", "customer", "POST", {
                ...draft,
                total: 1,
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await api("orders/quote", "customer", "POST", {
                ...draft,
                customer: { name: "Outro", phone: "5500000000000" },
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await api("orders/quote", "customer", "POST", {
                ...draft,
                payment: "PREPAID",
              })
            ).status,
            400,
          );
          const r = await api(
            "orders/quote",
            "customer",
            "POST",
            draft,
            "short",
          );
          assert.equal(r.status, 400);
        },
      );
      let durable: any;
      await t.test(
        "retries simultâneos criam somente uma cotação e um pedido",
        async () => {
          const key = randomUUID();
          const qs = await Promise.all(
            Array.from({ length: 6 }, () =>
              ok("orders/quote", "customer", "POST", draft, key),
            ),
          );
          assert.equal(new Set(qs.map((q) => q.quoteId)).size, 1);
          const orderKey = randomUUID();
          const results = await Promise.all(
            Array.from({ length: 6 }, () =>
              ok(
                "orders",
                "customer",
                "POST",
                { quoteId: qs[0].quoteId },
                orderKey,
              ),
            ),
          );
          results.forEach((r) => assert.deepEqual(r, results[0]));
          durable = results[0];
          assert.equal(durable.total, 7700);
          assert.equal(durable.change, 2300);
          assert.equal(
            (await ok("orders", "customer", "POST", { quoteId: qs[0].quoteId }))
              .id,
            durable.id,
          );
          assert.equal(
            await db.order.count({ where: { quoteId: qs[0].quoteId } }),
            1,
          );
          const secondQuote = await ok(
            "orders/quote",
            "customer",
            "POST",
            draft,
          );
          const conflict = await api(
            "orders",
            "customer",
            "POST",
            { quoteId: secondQuote.quoteId },
            orderKey,
          );
          assert.equal(conflict.data.code, "IDEMPOTENCY_CONFLICT");
        },
      );
      await t.test(
        "isolamento de cliente/loja/entregador e projeção da cozinha",
        async () => {
          for (const [path, who] of [
            [`orders/${durable.id}`, "customer2"],
            [`staff/orders/${durable.id}`, "other"],
            [`driver/deliveries/${durable.id}`, "driver"],
          ])
            assert.equal((await api(path, who)).status, 404);
          assert.equal((await ok("me/orders", "customer2")).items.length, 0);
          const kitchen = await ok(`staff/orders/${durable.id}`, "kitchen");
          for (const key of [
            "customer",
            "address",
            "payment",
            "total",
            "driverFee",
            "driverId",
          ])
            assert.equal(kitchen[key], undefined);
          assert.equal(kitchen.items[0].unitPrice, undefined);
          assert.equal(kitchen.events[0].actorId, undefined);
          assert.equal(
            (
              await api(
                `staff/orders/${durable.id}/accept`,
                "kitchen",
                "POST",
                { expectedVersion: durable.version },
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await api(`orders/${durable.id}/cancel`, "customer2", "POST", {
                expectedVersion: durable.version,
                reason: "Teste",
              })
            ).status,
            404,
          );
        },
      );
      let discounted: any;
      let promo: any;
      await t.test(
        "duas compras disputam a última cota; cancelamento libera exatamente uma vez",
        async () => {
          promo = await ok("staff/promotions", "manager", "POST", campaign);
          const q1 = await ok("orders/quote", "customer", "POST", {
            ...draft,
            promotionId: promo.id,
          });
          const q2 = await ok("orders/quote", "customer2", "POST", {
            ...draft,
            promotionId: promo.id,
          });
          const result = await Promise.all([
            api("orders", "customer", "POST", { quoteId: q1.quoteId }),
            api("orders", "customer2", "POST", { quoteId: q2.quoteId }),
          ]);
          assert.deepEqual(result.map((r) => r.status).sort(), [201, 409]);
          const winner = result[0].status === 201 ? "customer" : "customer2";
          const first = result.find((r) => r.status === 201)!.data;
          assert.equal(first.discount, 600);
          assert.equal(
            (
              await db.promotion.findUniqueOrThrow({
                where: { storeId_id: { storeId: main.store.id, id: promo.id } },
              })
            ).reserved,
            1,
          );
          const cancelKey = randomUUID();
          const body = {
            expectedVersion: first.version,
            reason: "Cliente desistiu",
          };
          const responses = await Promise.all([
            ok(`orders/${first.id}/cancel`, winner, "POST", body, cancelKey),
            ok(`orders/${first.id}/cancel`, winner, "POST", body, cancelKey),
          ]);
          assert.deepEqual(responses[0], responses[1]);
          assert.equal(
            (
              await db.promotion.findUniqueOrThrow({
                where: { storeId_id: { storeId: main.store.id, id: promo.id } },
              })
            ).reserved,
            0,
          );
          discounted = await order("customer", { promotionId: promo.id });
        },
      );
      await t.test(
        "transições, versão, disponibilidade e pagamento até a entrega",
        async () => {
          discounted = await cmd(discounted, "accept");
          assert.equal(
            (
              await api(`orders/${discounted.id}/cancel`, "customer", "POST", {
                expectedVersion: discounted.version,
                reason: "Desisti",
              })
            ).status,
            409,
          );
          assert.equal(
            (
              await api(
                `staff/orders/${discounted.id}/prepare`,
                "kitchen",
                "POST",
                { expectedVersion: 1 },
              )
            ).data.code,
            "VERSION_CONFLICT",
          );
          discounted = await cmd(
            await cmd(discounted, "prepare", "kitchen"),
            "ready",
            "kitchen",
          );
          discounted = await cmd(discounted, "assign", "manager", {
            driverId: ids.driver,
          });
          assert.equal(
            (await api(`driver/deliveries/${discounted.id}`, "driver2")).status,
            404,
          );
          assert.equal(
            (
              await api(
                `driver/deliveries/${discounted.id}/start`,
                "driver",
                "POST",
                { expectedVersion: discounted.version },
              )
            ).data.code,
            "INVALID_TRANSITION",
          );
          let me = await ok("me", "driver");
          await ok("driver/availability", "driver", "PATCH", {
            expectedVersion: me.version,
            available: false,
          });
          assert.equal(
            (
              await api(
                `driver/deliveries/${discounted.id}/collect`,
                "driver",
                "POST",
                { expectedVersion: discounted.version },
              )
            ).data.code,
            "DRIVER_UNAVAILABLE",
          );
          me = await ok("me", "driver");
          await ok("driver/availability", "driver", "PATCH", {
            expectedVersion: me.version,
            available: true,
          });
          discounted = await cmd(discounted, "collect", "driver");
          assert.equal(
            (
              await api(
                `staff/orders/${discounted.id}/cancel`,
                "manager",
                "POST",
                {
                  expectedVersion: discounted.version,
                  reason: "Não pode cancelar carga",
                },
              )
            ).status,
            409,
          );
          me = await ok("me", "driver");
          await ok("driver/availability", "driver", "PATCH", {
            expectedVersion: me.version,
            available: false,
          });
          discounted = await cmd(discounted, "start", "driver");
          assert.equal(
            (
              await api(
                `driver/deliveries/${discounted.id}/complete`,
                "driver",
                "POST",
                {
                  expectedVersion: discounted.version,
                  recipient: "Cliente",
                  paymentCollected: false,
                },
              )
            ).data.code,
            "PAYMENT_REQUIRED",
          );
          const key = randomUUID();
          const before = discounted;
          discounted = await cmd(
            before,
            "complete",
            "driver",
            { recipient: "Cliente", paymentCollected: true },
            key,
          );
          assert.deepEqual(
            await cmd(
              before,
              "complete",
              "driver",
              { recipient: "Cliente", paymentCollected: true },
              key,
            ),
            discounted,
          );
          assert.equal(discounted.status, "DELIVERED");
          assert.equal(discounted.driverEarnings, 800);
          assert.equal(discounted.events.length, 8);
          const usage = await db.promotion.findUniqueOrThrow({
            where: { storeId_id: { storeId: main.store.id, id: promo.id } },
          });
          assert.equal(usage.sold, 1);
          assert.equal(usage.reserved, 0);
          const paused = await ok("me", "driver");
          await ok("driver/availability", "driver", "PATCH", {
            expectedVersion: paused.version,
            available: true,
          });
          assert.equal(
            (
              await api("orders/quote", "customer", "POST", {
                ...draft,
                promotionId: promo.id,
              })
            ).status,
            422,
          );
        },
      );
      await t.test(
        "tentativa em retorno mantém cota; devolução libera sem contabilizar venda",
        async () => {
          const p = await ok("staff/promotions", "manager", "POST", {
            ...campaign,
            name: "Retorno",
          });
          let o = await route(await order("customer", { promotionId: p.id }));
          o = await cmd(o, "issue", "driver", { reason: "Cliente ausente" });
          let usage = await db.promotion.findUniqueOrThrow({
            where: { storeId_id: { storeId: main.store.id, id: p.id } },
          });
          assert.equal(usage.reserved, 1);
          o = await cmd(o, "return", "driver");
          assert.equal(o.status, "RETURNED");
          assert.equal(o.driverEarnings, 0);
          usage = await db.promotion.findUniqueOrThrow({
            where: { storeId_id: { storeId: main.store.id, id: p.id } },
          });
          assert.equal(usage.reserved, 0);
          assert.equal(usage.sold, 0);
          assert.equal(
            (
              await api(
                `driver/deliveries/${o.id}/complete`,
                "driver",
                "POST",
                {
                  expectedVersion: o.version,
                  recipient: "Teste",
                  paymentCollected: true,
                },
              )
            ).status,
            409,
          );
        },
      );
      await t.test(
        "cadastro concorrente protege nome normalizado e edição preserva snapshots",
        async () => {
          const body = {
            name: "Pizza Á Moda",
            description: "Teste",
            category: "PIZZA",
            pizzaGroup: "SPECIAL",
            enabled: true,
            prices: { SMALL: 4000, MEDIUM: 5000, LARGE: 6000 },
            imageId: null,
          };
          const rs = await Promise.all([
            api("staff/products", "manager", "POST", { ...body, id: "a-moda" }),
            api("staff/products", "manager", "POST", {
              ...body,
              id: "a-moda-2",
              name: "  Pizza a   Moda  ",
            }),
          ]);
          assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
          const before = await ok(`orders/${durable.id}`, "customer");
          const q = await ok("orders/quote", "customer", "POST", draft);
          const catalog = await ok("staff/catalog", "manager");
          const p = catalog.products.find((p: any) => p.id === "frango");
          const updated = await ok(
            `staff/products/${p.id}`,
            "manager",
            "PATCH",
            {
              name: "Frango revisado",
              description: p.description,
              category: p.category,
              pizzaGroup: p.pizzaGroup,
              enabled: true,
              prices: { SMALL: 4500, MEDIUM: 5500, LARGE: 7000 },
              imageId: null,
              expectedVersion: p.version,
            },
          );
          assert.equal(updated.version, p.version + 1);
          assert.equal(
            (await api("orders", "customer", "POST", { quoteId: q.quoteId }))
              .data.code,
            "QUOTE_CHANGED",
          );
          assert.deepEqual(
            (await ok(`orders/${durable.id}`, "customer")).items,
            before.items,
          );
          const combo = await order("customer", {
            cashTendered: null,
            items: [
              {
                kind: "COMBO",
                productId: "combo-dupla",
                quantity: 2,
                note: "",
              },
            ],
          });
          assert.equal(combo.total, 13700);
          assert.equal(combo.items[0].components[0].quantity, 1);
        },
      );
      await t.test(
        "foto validada pelo conteúdo, associada à loja e servida como WebP",
        async () => {
          const upload = async (buffer: Uint8Array, filename: string) => {
            const form = new FormData();
            form.set("file", new Blob([buffer as BlobPart]), filename);
            return fetch(`${base}/v1/staff/product-images`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${tokens.manager}`,
                "Idempotency-Key": randomUUID(),
              },
              body: form,
            });
          };
          const bad = await upload(
            Buffer.from("<svg><script>alert(1)</script></svg>"),
            "photo.jpg",
          );
          assert.equal(bad.status, 422);
          const buffer = await sharp({
            create: {
              width: 32,
              height: 32,
              channels: 3,
              background: "#a62027",
            },
          })
            .png()
            .toBuffer();
          const response = await upload(buffer, "photo.png");
          assert.equal(response.status, 201);
          const image: any = await response.json();
          const catalog = await ok("staff/catalog", "manager");
          const p = catalog.products.find((p: any) => p.id === "calabresa");
          const body = {
            name: p.name,
            description: p.description,
            category: p.category,
            pizzaGroup: p.pizzaGroup,
            enabled: p.enabled,
            prices: p.prices,
            imageId: image.imageId,
            expectedVersion: p.version,
          };
          await ok(`staff/products/${p.id}`, "manager", "PATCH", body);
          const photo = await fetch(
            `${base}/v1/stores/${slug}/images/${image.imageId}`,
          );
          assert.equal(photo.status, 200);
          assert.match(photo.headers.get("content-type")!, /image\/webp/);
          assert.equal(
            (
              await fetch(
                `${base}/v1/stores/${other.store.slug}/images/${image.imageId}`,
              )
            ).status,
            404,
          );
          const otherCatalog = await ok("staff/catalog", "other");
          const otherProduct = otherCatalog.products.find(
            (p: any) => p.id === "calabresa",
          );
          assert.equal(
            (
              await api("staff/products/calabresa", "other", "PATCH", {
                ...body,
                expectedVersion: otherProduct.version,
              })
            ).status,
            422,
          );
        },
      );
      await t.test(
        "pedido manual, registro de pagamento externo e retirada no balcão",
        async () => {
          let o = await order("manager", {
            mode: "PICKUP",
            address: null,
            cashTendered: null,
            customer: { name: "Cliente do balcão", phone: "5500000000000" },
            channel: "COUNTER",
          });
          assert.equal(o.fee, 0);
          assert.equal(o.customerId, null);
          assert.equal(
            (
              await api(
                `staff/orders/${o.id}/record-payment`,
                "attendant",
                "POST",
                {
                  expectedVersion: o.version,
                  reference: "Recibo externo de teste",
                },
              )
            ).status,
            403,
          );
          o = await cmd(o, "record-payment", "manager", {
            reference: "Recibo externo de teste",
          });
          assert.equal(o.payment, "PREPAID");
          o = await ready(o);
          o = await cmd(o, "pickup-complete", "attendant", {
            recipient: "Cliente do balcão",
            paymentCollected: false,
          });
          assert.equal(o.status, "DELIVERED");
          assert.equal(o.deliveryStatus, null);
        },
      );
      await t.test(
        "cota não pode ser reduzida abaixo do reservado e cotação expira",
        async () => {
          const p = await ok("staff/promotions", "manager", "POST", {
            ...campaign,
            pizzaLimit: 3,
            name: "Duas pizzas",
          });
          await order("customer", {
            promotionId: p.id,
            cashTendered: null,
            items: [{ ...draft.items[0], quantity: 2 }],
          });
          const result = await api(
            `staff/promotions/${p.id}`,
            "manager",
            "PATCH",
            {
              ...campaign,
              pizzaLimit: 1,
              name: p.name,
              expectedVersion: p.version,
            },
          );
          assert.equal(result.data.code, "INVALID_QUOTA");
          const q = await ok("orders/quote", "customer", "POST", draft);
          await db.quote.update({
            where: { id: q.quoteId },
            data: { expiresAt: new Date(Date.now() - 1000) },
          });
          assert.equal(
            (await api("orders", "customer", "POST", { quoteId: q.quoteId }))
              .data.code,
            "QUOTE_EXPIRED",
          );
          await assert.rejects(
            db.promotion.update({
              where: { storeId_id: { storeId: main.store.id, id: p.id } },
              data: { reserved: 100 },
            }),
          );
        },
      );
      await t.test(
        "paginação não repete pedidos e filtros não ampliam o acesso",
        async () => {
          const page = await ok("staff/orders?limit=2", "manager");
          assert.equal(page.items.length, 2);
          assert.ok(page.nextCursor);
          const next = await ok(
            `staff/orders?limit=2&cursor=${page.nextCursor}`,
            "manager",
          );
          assert.ok(
            !next.items.some((o: any) =>
              page.items.some((p: any) => p.id === o.id),
            ),
          );
          assert.equal(
            (await api("staff/orders?limit=1000", "manager")).status,
            400,
          );
          assert.equal(
            (await api("staff/orders?storeId=another", "manager")).status,
            400,
          );
          const completed = await ok(
            "driver/deliveries?status=DELIVERED",
            "driver",
          );
          assert.ok(
            completed.items.every((o: any) => o.status === "DELIVERED"),
          );
        },
      );
      await t.test(
        "WebSocket avisa somente perfis autorizados; revogar sessão desconecta",
        async () => {
          const events: Record<string, any[]> = {};
          for (const who of [
            "customer",
            "customer2",
            "manager",
            "kitchen",
            "other",
          ]) {
            const socket = io(base, {
              transports: ["websocket"],
              auth: { token: tokens[who] },
              reconnection: false,
            });
            sockets.push(socket);
            events[who] = [];
            socket.on("invalidate", (e) => events[who].push(e));
            await socketEvent(socket, "ready");
          }
          const o = await order();
          await new Promise((resolve) => setTimeout(resolve, 100));
          for (const who of ["customer", "manager", "kitchen"])
            assert.ok(events[who].some((e) => e.orderId === o.id));
          for (const who of ["customer2", "other"])
            assert.equal(events[who].filter((e) => e.orderId).length, 0);
          for (const e of events.kitchen)
            for (const k of ["customer", "address", "total", "actorId"])
              assert.equal(e[k], undefined);
          const disconnected = socketEvent(sockets[1], "disconnect");
          await ok("sessions/current", "customer2", "DELETE");
          await disconnected;
          assert.equal((await api("me", "customer2")).status, 401);
          sockets.forEach((s) => s.disconnect());
          await login("customer2");
        },
      );
      await t.test(
        "gestor cadastra e revoga equipe; senha não aparece na resposta",
        async () => {
          const created = await ok("staff/users", "manager", "POST", {
            email: "new-kitchen@example.com",
            password,
            name: "Nova cozinha",
            phone: "5500000000000",
            role: "KITCHEN",
          });
          assert.equal(created.passwordHash, undefined);
          const session = await ok("sessions", undefined, "POST", {
            storeSlug: slug,
            email: created.email,
            password,
          });
          tokens.newKitchen = session.accessToken;
          await ok(`staff/users/${created.id}`, "manager", "PATCH", {
            enabled: false,
            expectedVersion: created.version,
          });
          assert.equal((await api("me", "newKitchen")).status, 401);
          assert.equal(
            (
              await api(`staff/users/${ids.manager}`, "manager", "PATCH", {
                enabled: false,
                expectedVersion: 1,
              })
            ).status,
            422,
          );
          const result = await ok("me/password", "customer2", "POST", {
            currentPassword: password,
            newPassword: `${password}-new`,
          });
          assert.equal(result.revoked, true);
          assert.equal((await api("me", "customer2")).status, 401);
        },
      );
      await t.test(
        "limitação de login é persistida e erro não revela existência da conta",
        async () => {
          for (let i = 0; i < 10; i++)
            assert.equal(
              (
                await api("sessions", undefined, "POST", {
                  storeSlug: slug,
                  email: "missing@example.com",
                  password: "invalid",
                })
              ).status,
              401,
            );
          const r = await api("sessions", undefined, "POST", {
            storeSlug: slug,
            email: "missing@example.com",
            password: "invalid",
          });
          assert.equal(r.status, 429);
          assert.ok(r.headers.get("retry-after"));
        },
      );
      await t.test(
        "loja fechada bloqueia novas cotações e sessões/dados sobrevivem ao reinício",
        async () => {
          const catalog = await ok("staff/catalog", "manager");
          await ok("staff/store", "manager", "PATCH", {
            name: catalog.store.name,
            open: false,
            deliveryFee: catalog.store.deliveryFee,
            driverFee: catalog.store.driverFee,
            expectedVersion: catalog.store.version,
          });
          assert.equal(
            (await api("orders/quote", "customer", "POST", draft)).data.code,
            "STORE_CLOSED",
          );
          await app.close();
          app = await createApp(true);
          await app.listen(0, "127.0.0.1");
          base = await app.getUrl();
          assert.equal(
            (await ok(`orders/${durable.id}`, "customer")).total,
            durable.total,
          );
          assert.equal((await ok("me", "manager")).id, ids.manager);
        },
      );
    } finally {
      sockets.forEach((s) => s.disconnect());
      await app.close();
      for (const storeId of storeIds)
        await db.$transaction(async (tx) => {
          await tx.orderEvent.deleteMany({ where: { order: { storeId } } });
          await tx.idempotency.deleteMany({ where: { storeId } });
          await tx.order.deleteMany({ where: { storeId } });
          await tx.quote.deleteMany({ where: { storeId } });
          await tx.session.deleteMany({ where: { user: { storeId } } });
          await tx.product.deleteMany({ where: { storeId } });
          await tx.productImage.deleteMany({ where: { storeId } });
          await tx.promotion.deleteMany({ where: { storeId } });
          await tx.audit.deleteMany({ where: { storeId } });
          await tx.user.deleteMany({ where: { storeId } });
          await tx.store.delete({ where: { id: storeId } });
        });
      await db.$disconnect();
    }
  },
);
