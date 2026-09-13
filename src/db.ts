import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

export type Tx = Prisma.TransactionClient;
export const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value));
export function digest(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function lockStore(tx: Tx, storeId: string) {
  // All mutations for one store acquire this lock BEFORE reading state. READ COMMITTED
  // then sees the previous writer's commit. Other stores remain independent.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${storeId}, 0))::text`;
}
@Injectable()
export class Db extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
  write<T>(storeId: string, run: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await lockStore(tx, storeId);
        return run(tx);
      },
      {
        maxWait: 5000,
        timeout: 15000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }
}
