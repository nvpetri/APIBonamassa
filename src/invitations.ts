import { Injectable } from "@nestjs/common";
import { User } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Db, Tx, tokenHash, json } from "./db";
import { config } from "./config";
import { AuthService, userDto, hashPassword } from "./auth";
import { acceptInviteSchema, ensure, phoneSchema } from "./domain";
import { Mailer } from "./mailer";

export type InvitationDelivery = {
  id: string;
  token: string;
  user: User;
  storeName: string;
};
type InviteState = {
  expiresAt: Date;
  consumedAt: Date | null;
  sentAt: Date | null;
};
@Injectable()
export class InvitationsService {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
    private readonly mailer: Mailer,
  ) {}
  configured() {
    const url = config().STAFF_INVITE_URL;
    ensure(
      url,
      "INVITATION_NOT_CONFIGURED",
      "Configure STAFF_INVITE_URL na API com o endereço público da página de convite.",
      503,
    );
    return url;
  }
  dto(user: User & { invitations?: InviteState[] }) {
    const invite = user.invitations?.[0];
    return {
      ...userDto(user),
      invitationStatus: !user.onboardingPending
        ? null
        : !invite
          ? "PENDING"
          : invite.consumedAt
            ? "REVOKED"
            : invite.expiresAt <= new Date()
              ? "EXPIRED"
              : invite.sentAt
                ? "SENT"
                : "PENDING",
      invitationExpiresAt: user.onboardingPending
        ? (invite?.expiresAt ?? null)
        : null,
    };
  }
  async prepare(tx: Tx, user: User): Promise<InvitationDelivery> {
    const token = randomBytes(32).toString("base64url");
    await tx.staffInvitation.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    const invite = await tx.staffInvitation.create({
      data: {
        userId: user.id,
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + 24 * 3600_000),
      },
    });
    const store = await tx.store.findUniqueOrThrow({
      where: { id: user.storeId },
    });
    return { id: invite.id, token, user, storeName: store.name };
  }
  async deliver(delivery: InvitationDelivery) {
    const url = new URL(this.configured());
    url.hash = new URLSearchParams({ token: delivery.token }).toString();
    try {
      await this.mailer.invitation(
        delivery.user.email,
        delivery.user.name,
        delivery.storeName,
        delivery.user.role,
        url.toString(),
        delivery.id,
      );
      await this.db.staffInvitation.updateMany({
        where: { id: delivery.id, consumedAt: null },
        data: { sentAt: new Date() },
      });
    } catch {
      // The account is persisted. A manager can retry with a new invitation; never claim delivery on a timeout.
      console.warn(
        "Envio do convite não confirmado. Reenvie pela lista da equipe.",
      );
    }
  }
  async inspect(token: string) {
    await this.auth.rate(`invite-inspect:${tokenHash(token)}`, 30, 60);
    const invite = await this.db.staffInvitation.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { user: { include: { store: true } } },
    });
    ensure(
      invite &&
        !invite.consumedAt &&
        invite.expiresAt > new Date() &&
        invite.user.enabled &&
        invite.user.onboardingPending,
      "INVALID_INVITATION",
      "Convite inválido, expirado ou já utilizado. Peça ao gerente um novo convite.",
      410,
    );
    return {
      name: invite.user.name,
      email: invite.user.email,
      role: invite.user.role,
      storeName: invite.user.store.name,
      expiresAt: invite.expiresAt,
    };
  }
  async accept(input: z.infer<typeof acceptInviteSchema>) {
    await this.auth.rate(`invite-accept:${tokenHash(input.token)}`, 10, 900);
    const initial = await this.db.staffInvitation.findUnique({
      where: { tokenHash: tokenHash(input.token) },
      include: { user: true },
    });
    ensure(
      initial &&
        !initial.consumedAt &&
        initial.expiresAt > new Date() &&
        initial.user.enabled &&
        initial.user.onboardingPending,
      "INVALID_INVITATION",
      "Convite inválido, expirado ou já utilizado. Peça ao gerente um novo convite.",
      410,
    );
    if (initial.user.role === "DRIVER") phoneSchema.parse(input.phone);
    const passwordHash = await hashPassword(input.password);
    return this.db.write(initial.user.storeId, async (tx) => {
      const invite = await tx.staffInvitation.findUnique({
        where: { id: initial.id },
        include: { user: true },
      });
      ensure(
        invite &&
          !invite.consumedAt &&
          invite.expiresAt > new Date() &&
          invite.user.enabled &&
          invite.user.onboardingPending,
        "INVALID_INVITATION",
        "Convite inválido, expirado ou já utilizado. Peça ao gerente um novo convite.",
        410,
      );
      await tx.staffInvitation.updateMany({
        where: { userId: invite.userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.verificationCode.updateMany({
        where: { userId: invite.userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.session.deleteMany({ where: { userId: invite.userId } });
      await tx.user.update({
        where: { id: invite.userId },
        data: {
          passwordHash,
          phone: input.phone,
          emailVerifiedAt: new Date(),
          onboardingPending: false,
          available: true,
          version: { increment: 1 },
        },
      });
      await tx.audit.create({
        data: {
          storeId: invite.user.storeId,
          actorId: invite.userId,
          action: "staff.invitation.accepted",
          data: json({ userId: invite.userId }),
        },
      });
      return { activated: true, role: invite.user.role };
    });
  }
}
