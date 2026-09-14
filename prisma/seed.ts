import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { hashPassword } from "../src/auth";
import { json, lockStore } from "../src/db";
import {
  Product,
  emailSchema,
  passwordSchema,
  productSchema,
  slugSchema,
} from "../src/domain";

export const demoProducts: Product[] = [
  {
    id: "calabresa",
    name: "Calabresa",
    description: "Muçarela, calabresa e cebola.",
    category: "PIZZA",
    pizzaGroup: "TRADITIONAL",
    enabled: true,
    prices: { SMALL: 3500, MEDIUM: 4500, LARGE: 5500 },
    imageId: null,
  },
  {
    id: "frango",
    name: "Frango com requeijão",
    description: "Frango desfiado e requeijão cremoso.",
    category: "PIZZA",
    pizzaGroup: "TRADITIONAL",
    enabled: true,
    prices: { SMALL: 4000, MEDIUM: 5000, LARGE: 6000 },
    imageId: null,
  },
  {
    id: "quatro-queijos",
    name: "Quatro queijos",
    description: "Muçarela, parmesão, provolone e requeijão.",
    category: "PIZZA",
    pizzaGroup: "SPECIAL",
    enabled: true,
    prices: { SMALL: 4500, MEDIUM: 5500, LARGE: 6500 },
    imageId: null,
  },
  {
    id: "CREAM",
    name: "Borda de requeijão",
    description: "Requeijão cremoso.",
    category: "CRUST",
    enabled: true,
    prices: { SMALL: 1000, MEDIUM: 1000, LARGE: 1000 },
    imageId: null,
  },
  {
    id: "CHEDDAR",
    name: "Borda de cheddar",
    description: "Cheddar cremoso.",
    category: "CRUST",
    enabled: true,
    prices: { SMALL: 1000, MEDIUM: 1000, LARGE: 1000 },
    imageId: null,
  },
  {
    id: "refrigerante-2l",
    name: "Refrigerante 2 L",
    description: "Refrigerante de cola, garrafa de 2 litros.",
    category: "DRINK",
    enabled: true,
    prices: { SMALL: 1400, MEDIUM: 1400, LARGE: 1400 },
    imageId: null,
  },
  {
    id: "combo-dupla",
    name: "Combo da casa",
    description: "Grande meio a meio e refrigerante de 2 L.",
    category: "COMBO",
    enabled: true,
    prices: { SMALL: 6500, MEDIUM: 6500, LARGE: 6500 },
    combo: [
      {
        kind: "PIZZA",
        flavorIds: ["calabresa", "frango"],
        size: "LARGE",
        crust: "NONE",
        quantity: 1,
        note: "",
      },
      { kind: "DRINK", productId: "refrigerante-2l", quantity: 1 },
    ],
    imageId: null,
  },
];

export async function seedStore(
  db: PrismaClient,
  input: { slug: string; email: string; password: string; demo: boolean },
) {
  const passwordHash = await hashPassword(passwordSchema.parse(input.password));
  const slug = slugSchema.parse(input.slug);
  const email = emailSchema.parse(input.email);
  const store = await db.store.upsert({
    where: { slug },
    update: {},
    create: { slug, name: "Bonamassa Pizzaria", open: input.demo, scheduleEnabled: !input.demo },
  });
  return db.$transaction(
    async (tx) => {
      await lockStore(tx, store.id);
      const manager = await tx.user.upsert({
        where: { storeId_email: { storeId: store.id, email } },
        update: {},
        create: {
          storeId: store.id,
          email,
          name: "Gestor Bonamassa",
          phone: "5500000000000",
          role: "MANAGER",
          passwordHash,
        },
      });
      if (input.demo)
        for (const raw of demoProducts) {
          const p = productSchema.parse(raw);
          await tx.product.upsert({
            where: { storeId_id: { storeId: store.id, id: p.id } },
            update: {},
            create: {
              storeId: store.id,
              id: p.id,
              category: p.category,
              nameKey: p.name
                .normalize("NFKD")
                .replace(/\p{M}/gu, "")
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase(),
              data: json(p),
            },
          });
        }
      return { store, manager };
    },
    { timeout: 15000 },
  );
}
async function main() {
  const e = z
    .object({
      SEED_STORE_SLUG: slugSchema.default("bonamassa"),
      SEED_MANAGER_EMAIL: emailSchema,
      SEED_MANAGER_PASSWORD: passwordSchema,
      SEED_DEMO: z.enum(["true", "false"]).default("false"),
    })
    .parse(process.env);
  if (process.env.NODE_ENV === "production" && e.SEED_DEMO === "true")
    throw new Error("SEED_DEMO não é permitido em produção.");
  const db = new PrismaClient();
  try {
    const result = await seedStore(db, {
      slug: e.SEED_STORE_SLUG,
      email: e.SEED_MANAGER_EMAIL,
      password: e.SEED_MANAGER_PASSWORD,
      demo: e.SEED_DEMO === "true",
    });
    console.log(
      `Loja ${result.store.slug} inicializada. Dados existentes e senhas foram preservados.`,
    );
  } finally {
    await db.$disconnect();
  }
}
if (require.main === module)
  main().catch((e: unknown) => {
    console.error(
      e instanceof z.ZodError
        ? "Configure SEED_MANAGER_EMAIL e SEED_MANAGER_PASSWORD (12 a 128 caracteres)."
        : e instanceof Error
          ? e.message
          : "Falha no seed.",
    );
    process.exitCode = 1;
  });
