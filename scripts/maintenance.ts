import { PrismaClient } from "@prisma/client";
import { lockStore } from "../src/db";

async function main() {
  const db = new PrismaClient();
  try {
    const now = new Date();
    const sessions = await db.session.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    const buckets = await db.rateBucket.deleteMany({
      where: { resetsAt: { lt: now } },
    });
    let quotes = 0;
    let images = 0;
    const cutoff = new Date(Date.now() - 24 * 3600_000);
    for (const store of await db.store.findMany({ select: { id: true } })) {
      await db.$transaction(async (tx) => {
        await lockStore(tx, store.id);
        quotes += (
          await tx.quote.deleteMany({
            where: {
              storeId: store.id,
              expiresAt: { lt: cutoff },
              order: null,
            },
          })
        ).count;
        images += (
          await tx.productImage.deleteMany({
            where: {
              storeId: store.id,
              createdAt: { lt: cutoff },
              products: { none: {} },
            },
          })
        ).count;
      });
    }
    console.log({
      expiredSessions: sessions.count,
      expiredRateBuckets: buckets.count,
      abandonedQuotes: quotes,
      orphanedImages: images,
    });
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error("Falha na manutenção. Confira a conexão com o banco.");
  process.exitCode = 1;
});
