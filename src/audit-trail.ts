import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { Actor, AuthService } from "./auth";
import { Db } from "./db";
import { ensure } from "./domain";
export const auditTables = [
  "Store",
  "User",
  "Product",
  "ProductImage",
  "Promotion",
  "Order",
  "OrderEvent",
  "Session",
  "VerificationCode",
  "StaffInvitation",
  "Audit",
] as const;
export const auditId = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
export const auditQuery = z
  .strictObject({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    table: z.enum(auditTables).optional(),
    recordId: z.string().min(1).max(100).optional(),
    actorId: z.uuid().optional(),
    requestId: z.uuid().optional(),
    operation: z.enum(["INSERT", "UPDATE", "DELETE"]).optional(),
    origin: z.enum(["HTTP", "SYSTEM", "SQL"]).optional(),
    cursor: auditId.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine(
    (q) =>
      Date.parse(q.to) > Date.parse(q.from) &&
      Date.parse(q.to) - Date.parse(q.from) <= 93 * 86_400_000,
    "Informe um período de até 93 dias.",
  );
const summary = {
  id: true,
  storeId: true,
  tableName: true,
  recordId: true,
  operation: true,
  actorId: true,
  actorName: true,
  actorRole: true,
  sharedAccount: true,
  origin: true,
  clientSource: true,
  requestId: true,
  action: true,
  changedFields: true,
  createdAt: true,
} satisfies Prisma.AuditTrailSelect;
@Injectable()
export class AuditTrailService {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
  ) {}
  private async authorize(actor: Actor) {
    ensure(
      actor.role === "MANAGER",
      "FORBIDDEN",
      "Auditoria disponível somente ao gerente.",
      403,
    );
    await this.auth.assertActive(actor);
  }
  async list(actor: Actor, query: z.infer<typeof auditQuery>) {
    await this.authorize(actor);
    const rows = await this.db.auditTrail.findMany({
      where: {
        storeId: actor.storeId,
        createdAt: { gte: new Date(query.from), lt: new Date(query.to) },
        tableName: query.table,
        recordId: query.recordId,
        actorId: query.actorId,
        requestId: query.requestId,
        operation: query.operation,
        origin: query.origin,
        ...(query.cursor ? { id: { lt: BigInt(query.cursor) } } : {}),
      },
      select: summary,
      orderBy: { id: "desc" },
      take: query.limit + 1,
    });
    const items = rows
      .slice(0, query.limit)
      .map((row) => ({ ...row, id: String(row.id) }));
    return {
      items,
      nextCursor: rows.length > query.limit ? items.at(-1)!.id : null,
    };
  }
  async detail(actor: Actor, id: string) {
    await this.authorize(actor);
    const row = await this.db.auditTrail.findFirst({
      where: { storeId: actor.storeId, id: BigInt(id) },
    });
    ensure(row, "NOT_FOUND", "Registro de auditoria não encontrado.", 404);
    return { ...row, id: String(row.id) };
  }
}
