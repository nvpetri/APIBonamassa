import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role, User } from "@prisma/client";
import {
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import { Request } from "express";
import { z } from "zod";
import { Db, Tx, json, tokenHash } from "./db";
import { config } from "./config";
import { ensure, loginSchema, registerSchema, RuleError } from "./domain";
import { ChangeBus } from "./realtime";

const derive = (password: string, salt: string): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    nodeScrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
async function verify(password: string, hash: string) {
  const [algorithm, salt, expected] = hash.split("$");
  if (algorithm !== "scrypt" || !salt || !/^[0-9a-f]{128}$/.test(expected))
    return false;
  return timingSafeEqual(
    await derive(password, salt),
    Buffer.from(expected, "hex"),
  );
}
// Fixed dummy hash gives missing accounts the same expensive password check.
const dummyHash = `scrypt$00000000000000000000000000000000$${"0".repeat(128)}`;
export type Actor = Pick<
  User,
  "id" | "storeId" | "role" | "name" | "phone" | "email"
> & { sessionId: string; expiresAt: Date };
export const userDto = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: u.role,
  enabled: u.enabled,
  available: u.available,
  version: u.version,
  storeId: u.storeId,
});
export const Public = () => SetMetadata("public", true);
export const Roles = (...roles: Role[]) => SetMetadata("roles", roles);
export const Current = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Actor =>
    ctx.switchToHttp().getRequest<Request & { actor: Actor }>().actor,
);

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly bus: ChangeBus,
  ) {}
  async rate(key: string, limit: number, seconds: number) {
    const rows = await this.db.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateBucket" ("key", "count", "resetsAt") VALUES (${tokenHash(key)}, 1, now() + make_interval(secs => ${seconds}))
      ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateBucket"."resetsAt" <= now() THEN 1 ELSE "RateBucket"."count" + 1 END,
      "resetsAt" = CASE WHEN "RateBucket"."resetsAt" <= now() THEN now() + make_interval(secs => ${seconds}) ELSE "RateBucket"."resetsAt" END
      RETURNING "count"`;
    ensure(
      rows[0].count <= limit,
      "RATE_LIMITED",
      "Muitas tentativas. Aguarde antes de tentar novamente.",
      429,
    );
  }
  async issue(user: User) {
    const accessToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + config().SESSION_HOURS * 3600_000);
    await this.db.session.create({
      data: { userId: user.id, tokenHash: tokenHash(accessToken), expiresAt },
    });
    return { accessToken, tokenType: "Bearer", expiresAt, user: userDto(user) };
  }
  async login(input: z.infer<typeof loginSchema>) {
    await this.rate(`login:${input.storeSlug}:${input.email}`, 10, 900);
    const store = await this.db.store.findUnique({
      where: { slug: input.storeSlug },
    });
    const user =
      store &&
      (await this.db.user.findUnique({
        where: { storeId_email: { storeId: store.id, email: input.email } },
      }));
    const valid = await verify(input.password, user?.passwordHash ?? dummyHash);
    ensure(
      user?.enabled && valid,
      "INVALID_CREDENTIALS",
      "E-mail ou senha inválidos.",
      401,
    );
    return this.issue(user);
  }
  async register(input: z.infer<typeof registerSchema>) {
    const store = await this.db.store.findUnique({
      where: { slug: input.storeSlug },
    });
    ensure(store, "STORE_NOT_FOUND", "Loja não encontrada.", 404);
    const passwordHash = await hashPassword(input.password);
    const user = await this.db.write(store.id, (tx) =>
      tx.user.create({
        data: {
          storeId: store.id,
          email: input.email,
          name: input.name,
          phone: input.phone,
          passwordHash,
          role: "CUSTOMER",
        },
      }),
    );
    return this.issue(user);
  }
  async authenticate(token: unknown, tx: Tx = this.db): Promise<Actor> {
    ensure(
      typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token),
      "UNAUTHENTICATED",
      "Autentique-se para continuar.",
      401,
    );
    const session = await tx.session.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { user: true },
    });
    ensure(
      session && session.expiresAt > new Date() && session.user.enabled,
      "SESSION_EXPIRED",
      "Sessão expirada ou revogada.",
      401,
    );
    const { id, storeId, role, name, phone, email } = session.user;
    return {
      id,
      storeId,
      role,
      name,
      phone,
      email,
      sessionId: session.id,
      expiresAt: session.expiresAt,
    };
  }
  async assert(tx: Tx, actor: Actor) {
    const s = await tx.session.findUnique({
      where: { id: actor.sessionId },
      include: { user: true },
    });
    ensure(
      s &&
        s.expiresAt > new Date() &&
        s.user.enabled &&
        s.user.role === actor.role &&
        s.userId === actor.id &&
        s.user.storeId === actor.storeId,
      "SESSION_EXPIRED",
      "Sessão expirada ou revogada.",
      401,
    );
  }
  async logout(actor: Actor) {
    await this.db.write(actor.storeId, async (tx) => {
      await this.assert(tx, actor);
      await tx.session.deleteMany({ where: { id: actor.sessionId } });
    });
    this.bus.revoke(actor.sessionId);
    return { revoked: true };
  }
  async changePassword(actor: Actor, current: string, next: string) {
    await this.rate(`password:${actor.id}`, 10, 900);
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    ensure(
      await verify(current, user.passwordHash),
      "INVALID_CREDENTIALS",
      "Senha atual incorreta.",
      401,
    );
    const passwordHash = await hashPassword(next);
    const sessions = await this.db.write(actor.storeId, async (tx) => {
      await this.assert(tx, actor);
      const latest = await tx.user.findUniqueOrThrow({
        where: { id: actor.id },
      });
      ensure(
        latest.passwordHash === user.passwordHash,
        "VERSION_CONFLICT",
        "A senha foi alterada em outra sessão.",
        409,
      );
      await tx.user.update({
        where: { id: actor.id },
        data: { passwordHash, version: { increment: 1 } },
      });
      const sessions = await tx.session.findMany({
        where: { userId: actor.id },
        select: { id: true },
      });
      await tx.session.deleteMany({ where: { userId: actor.id } });
      await tx.audit.create({
        data: {
          storeId: actor.storeId,
          actorId: actor.id,
          action: "user.password.changed",
          data: json({ userId: actor.id }),
        },
      });
      return sessions;
    });
    sessions.forEach((s) => this.bus.revoke(s.id));
    return { revoked: true };
  }
}

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request & { actor: Actor }>();
    const isPublic = this.reflector.getAllAndOverride<boolean>("public", [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    // Express does not trust X-Forwarded-For by default. Never accept client-supplied IPs.
    const sensitive = /^\/v1\/(sessions|customers)$/.test(req.path);
    await this.auth.rate(
      `http:${sensitive ? "auth" : "general"}:${req.ip}`,
      sensitive ? 60 : 600,
      60,
    );
    if (isPublic) return true;
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer "))
      throw new RuleError(
        "UNAUTHENTICATED",
        "Informe Authorization: Bearer <token>.",
        401,
      );
    req.actor = await this.auth.authenticate(header.slice(7));
    const roles = this.reflector.getAllAndOverride<Role[]>("roles", [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    ensure(
      roles?.includes(req.actor.role),
      "FORBIDDEN",
      "Este perfil não pode executar esta operação.",
      403,
    );
    return true;
  }
}
