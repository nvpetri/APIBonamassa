import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role, User, VerificationPurpose } from "@prisma/client";
import { randomBytes, randomInt } from "node:crypto";
import { Request, Response } from "express";
import { z } from "zod";
import { Db, Tx, json, tokenHash } from "./db";
import { config } from "./config";
import { ensure, loginSchema, registerSchema, RuleError } from "./domain";
import { ChangeBus } from "./realtime";
import { RateLimitError, retryAfterSeconds } from "./rate-limit";
import { Mailer } from "./mailer";

import {
  dummyPasswordHash,
  hashPassword,
  needsPasswordUpgrade,
  verifyPassword,
} from "./password";
export { hashPassword } from "./password";

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
  emailVerified: !!u.emailVerifiedAt,
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
    private readonly mailer: Mailer,
  ) {}
  async rate(key: string, limit: number, seconds: number) {
    const rows = await this.db.$queryRaw<{ count: number; resetsAt: Date }[]>`
      INSERT INTO "RateBucket" ("key", "count", "resetsAt") VALUES (${tokenHash(key)}, 1, now() + make_interval(secs => ${seconds}))
      ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateBucket"."resetsAt" <= now() THEN 1 ELSE "RateBucket"."count" + 1 END,
      "resetsAt" = CASE WHEN "RateBucket"."resetsAt" <= now() THEN now() + make_interval(secs => ${seconds}) ELSE "RateBucket"."resetsAt" END
      RETURNING "count", "resetsAt"`;
    if (rows[0].count > limit)
      throw new RateLimitError(retryAfterSeconds(rows[0].resetsAt));
  }
  async issue(user: User, tx: Tx = this.db) {
    ensure(
      user.emailVerifiedAt,
      "EMAIL_NOT_VERIFIED",
      "Confirme seu e-mail para continuar.",
      403,
    );
    const accessToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.now() + config().SESSION_IDLE_DAYS * 86_400_000,
    );
    await tx.session.create({
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
    const valid = await verifyPassword(
      input.password,
      user?.passwordHash ?? dummyPasswordHash,
    );
    ensure(
      user?.enabled && valid,
      "INVALID_CREDENTIALS",
      "E-mail ou senha inválidos.",
      401,
    );
    ensure(
      user.emailVerifiedAt,
      "EMAIL_NOT_VERIFIED",
      "Confirme seu e-mail para entrar.",
      403,
    );
    const upgradedHash = needsPasswordUpgrade(user.passwordHash)
      ? await hashPassword(input.password)
      : null;
    return this.db.write(user.storeId, async (tx) => {
      const current = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      ensure(
        current.enabled && current.passwordHash === user.passwordHash,
        "INVALID_CREDENTIALS",
        "E-mail ou senha inválidos.",
        401,
      );
      if (upgradedHash) {
        await tx.user.update({
          where: { id: current.id },
          data: { passwordHash: upgradedHash },
        });
        await tx.audit.create({
          data: {
            storeId: current.storeId,
            actorId: current.id,
            action: "user.password.rehashed",
            data: json({ userId: current.id }),
          },
        });
      }
      return this.issue(current, tx);
    });
  }
  async register(input: z.infer<typeof registerSchema>) {
    ensure(
      config().CUSTOMER_REGISTRATION_ENABLED === "true",
      "REGISTRATION_DISABLED",
      "Novos cadastros estão temporariamente indisponíveis. Entre com sua conta ou fale com a pizzaria.",
      503,
    );
    const store = await this.db.store.findUnique({
      where: { slug: input.storeSlug },
    });
    ensure(store, "STORE_NOT_FOUND", "Loja não encontrada.", 404);
    await this.rate(`register:store:${store.id}`, 30, 3600);
    await this.rate(`register:email:${store.id}:${input.email}`, 3, 3600);
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
    await this.sendCode(user, "EMAIL_VERIFY");
    return { verificationRequired: true, email: user.email };
  }
  private async sendCode(user: User, purpose: VerificationPurpose) {
    const code =
      config().NODE_ENV === "test"
        ? "123456"
        : String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(
      Date.now() + config().VERIFICATION_CODE_MINUTES * 60_000,
    );
    await this.db.write(user.storeId, async (tx) => {
      await tx.verificationCode.updateMany({
        where: { userId: user.id, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.verificationCode.create({
        data: {
          userId: user.id,
          purpose,
          codeHash: tokenHash(`${purpose}:${user.id}:${code}`),
          expiresAt,
        },
      });
    });
    await this.mailer.code(
      user.email,
      code,
      purpose === "EMAIL_VERIFY" ? "verify" : "reset",
    );
  }
  private async userByEmail(storeSlug: string, email: string) {
    const store = await this.db.store.findUnique({
      where: { slug: storeSlug },
    });
    if (!store) return null;
    return this.db.user.findUnique({
      where: { storeId_email: { storeId: store.id, email } },
    });
  }
  async requestEmailVerification(storeSlug: string, email: string) {
    await this.rate(`verify-request:${storeSlug}:${email}`, 3, 3600);
    const user = await this.userByEmail(storeSlug, email);
    if (user?.enabled && !user.emailVerifiedAt)
      await this.sendCode(user, "EMAIL_VERIFY");
    return { accepted: true };
  }
  async confirmEmail(storeSlug: string, email: string, code: string) {
    await this.rate(`verify-confirm:${storeSlug}:${email}`, 10, 900);
    const user = await this.userByEmail(storeSlug, email);
    ensure(user?.enabled, "INVALID_CODE", "Código inválido ou expirado.", 400);
    const session = await this.db.write(user.storeId, async (tx) => {
      const current = await tx.user.findUnique({ where: { id: user.id } });
      if (!current?.enabled || current.emailVerifiedAt) return null;
      if (!(await this.consumeCode(tx, current, "EMAIL_VERIFY", code)))
        return null;
      const verified = await tx.user.update({
        where: { id: current.id },
        data: { emailVerifiedAt: new Date(), version: { increment: 1 } },
      });
      return this.issue(verified, tx);
    });
    ensure(
      session,
      "INVALID_CODE",
      "Código inválido ou expirado. Se já confirmou seu e-mail, entre com sua senha.",
      400,
    );
    return session;
  }
  // Called under the store lock. Invalid attempts are committed before the caller rejects.
  private async consumeCode(
    tx: Tx,
    user: User,
    purpose: VerificationPurpose,
    code: string,
  ) {
    const record = await tx.verificationCode.findFirst({
      where: {
        userId: user.id,
        purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    const valid =
      record &&
      record.attempts < 5 &&
      record.codeHash === tokenHash(`${purpose}:${user.id}:${code}`);
    if (!valid) {
      if (record)
        await tx.verificationCode.update({
          where: { id: record.id },
          data: { attempts: { increment: 1 } },
        });
      return false;
    }
    await tx.verificationCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    return true;
  }
  async requestPasswordReset(storeSlug: string, email: string) {
    await this.rate(`reset-request:${storeSlug}:${email}`, 3, 3600);
    const user = await this.userByEmail(storeSlug, email);
    if (user?.enabled) await this.sendCode(user, "PASSWORD_RESET");
    return { accepted: true };
  }
  async resetPassword(
    storeSlug: string,
    email: string,
    code: string,
    next: string,
  ) {
    await this.rate(`reset-confirm:${storeSlug}:${email}`, 10, 900);
    const user = await this.userByEmail(storeSlug, email);
    ensure(user?.enabled, "INVALID_CODE", "Código inválido ou expirado.", 400);
    const passwordHash = await hashPassword(next);
    const sessions = await this.db.write(user.storeId, async (tx) => {
      const current = await tx.user.findUnique({ where: { id: user.id } });
      if (!current?.enabled) return null;
      if (!(await this.consumeCode(tx, current, "PASSWORD_RESET", code)))
        return null;
      const sessions = await tx.session.findMany({
        where: { userId: user.id },
        select: { id: true },
      });
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          emailVerifiedAt: current.emailVerifiedAt ?? new Date(),
          version: { increment: 1 },
        },
      });
      await tx.verificationCode.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.audit.create({
        data: {
          storeId: user.storeId,
          actorId: user.id,
          action: "user.password.reset",
          data: json({ userId: user.id }),
        },
      });
      return sessions;
    });
    ensure(sessions, "INVALID_CODE", "Código inválido ou expirado.", 400);
    sessions.forEach((s) => this.bus.revoke(s.id));
    return { reset: true };
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
    const now = new Date();
    const idleCutoff = new Date(
      now.getTime() - config().SESSION_IDLE_DAYS * 86_400_000,
    );
    ensure(
      session &&
        session.expiresAt > now &&
        session.lastActivityAt > idleCutoff &&
        session.user.enabled,
      "SESSION_EXPIRED",
      "Sessão expirada ou revogada.",
      401,
    );
    const refreshedExpiry = new Date(
      now.getTime() + config().SESSION_IDLE_DAYS * 86_400_000,
    );
    await tx.session.update({
      where: { id: session.id },
      data: { lastActivityAt: now, expiresAt: refreshedExpiry },
    });
    const { id, storeId, role, name, phone, email } = session.user;
    return {
      id,
      storeId,
      role,
      name,
      phone,
      email,
      sessionId: session.id,
      expiresAt: refreshedExpiry,
    };
  }
  async assertActive(actor: Actor) {
    return this.assert(this.db, actor);
  }
  async assert(tx: Tx, actor: Actor) {
    const s = await tx.session.findUnique({
      where: { id: actor.sessionId },
      include: { user: true },
    });
    ensure(
      s &&
        s.expiresAt > new Date() &&
        s.lastActivityAt >
          new Date(Date.now() - config().SESSION_IDLE_DAYS * 86_400_000) &&
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
      await verifyPassword(current, user.passwordHash),
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
    // Only explicitly trusted proxies affect req.ip. Never read XFF directly.
    // A coarse edge ceiling still bounds authentication/DB work.
    await this.auth.rate(`http:edge:${req.ip}`, 6000, 60);
    if (isPublic) {
      const sensitive = /^\/v1\/(sessions|customers|auth(?:\/|$))/.test(
        req.path,
      );
      await this.auth.rate(
        `http:${sensitive ? "auth" : "anonymous"}:${req.ip}`,
        sensitive ? 60 : 600,
        60,
      );
      return true;
    }
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer "))
      throw new RuleError(
        "UNAUTHENTICATED",
        "Informe Authorization: Bearer <token>.",
        401,
      );
    req.actor = await this.auth.authenticate(header.slice(7));
    // Separate authenticated staff/customers even behind the same BFF/NAT.
    // Using user identity instead of token prevents bypass by creating sessions.
    await this.auth.rate(
      `http:user:${req.actor.storeId}:${req.actor.id}`,
      600,
      60,
    );
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
    ctx
      .switchToHttp()
      .getResponse<Response>()
      .setHeader("X-Session-Expires-At", req.actor.expiresAt.toISOString());
    return true;
  }
}
