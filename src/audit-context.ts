import { AsyncLocalStorage } from "node:async_hooks";
import type { Tx } from "./db";

type Identity = {
  id: string;
  storeId: string;
  name: string;
  role: string;
  sessionId?: string;
};
export type AuditContext = {
  origin: "HTTP" | "SYSTEM";
  requestId?: string;
  method?: string;
  path?: string;
  ip?: string;
  userAgent?: string;
  clientSource?: string;
  action?: string;
  keyHash?: string;
  actor?: Identity;
};
export const auditContext = new AsyncLocalStorage<AuditContext>();
export function auditIdentity(actor: Identity) {
  const context = auditContext.getStore();
  if (context)
    context.actor = {
      id: actor.id,
      storeId: actor.storeId,
      name: actor.name,
      role: actor.role,
      sessionId: actor.sessionId,
    };
}
export async function applyAuditContext(
  tx: Tx,
  storeId: string,
  actor?: Identity,
) {
  if (actor) auditIdentity(actor);
  const context = {
    ...(auditContext.getStore() ?? {
      origin: "SYSTEM",
      action: "system.transaction",
    }),
    storeId,
    ...(actor
      ? {
          actor: {
            id: actor.id,
            storeId: actor.storeId,
            name: actor.name,
            role: actor.role,
            sessionId: actor.sessionId,
          },
        }
      : {}),
  };
  await tx.$queryRaw`SELECT set_config('bonamassa.audit', ${JSON.stringify(context)}, true)`;
}
