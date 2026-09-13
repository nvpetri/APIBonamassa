import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { AuthService, Actor } from "./auth";
import { Db, Tx, digest, json } from "./db";
import { Change, ChangeBus } from "./realtime";
import { ensure } from "./domain";

export const keySchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_-]{16,100}$/,
    "Envie uma Idempotency-Key de 16 a 100 caracteres.",
  );
@Injectable()
export class Writes {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
    private readonly bus: ChangeBus,
  ) {}
  async run<T>(
    actor: Actor,
    key: string,
    scope: string,
    body: unknown,
    execute: (tx: Tx) => Promise<{ data: T; events?: Change[] }>,
  ): Promise<T> {
    keySchema.parse(key);
    const fingerprint = digest({ scope, body });
    const result = await this.db.write(actor.storeId, async (tx) => {
      await this.auth.assert(tx, actor);
      const where = {
        storeId_userId_key: { storeId: actor.storeId, userId: actor.id, key },
      };
      const prior = await tx.idempotency.findUnique({ where });
      if (prior) {
        ensure(
          prior.fingerprint === fingerprint,
          "IDEMPOTENCY_CONFLICT",
          "Esta chave já foi usada com outro comando. Reenvie o comando original ou gere uma nova chave.",
          409,
        );
        return { data: prior.response as T, events: [] };
      }
      const result = await execute(tx);
      const response = json(result.data);
      await tx.idempotency.create({
        data: {
          storeId: actor.storeId,
          userId: actor.id,
          key,
          fingerprint,
          response,
        },
      });
      return { data: response as T, events: result.events ?? [] };
    });
    result.events.forEach((event) => this.bus.publish(event));
    return result.data;
  }
}
export function checkVersion(current: number, expected: number) {
  ensure(
    current === expected,
    "VERSION_CONFLICT",
    `Versão desatualizada. Consulte o recurso novamente; versão atual: ${current}.`,
    409,
  );
}
export const audit = (tx: Tx, actor: Actor, action: string, data: unknown) =>
  tx.audit.create({
    data: {
      storeId: actor.storeId,
      actorId: actor.id,
      action,
      data: json(data),
    },
  });
