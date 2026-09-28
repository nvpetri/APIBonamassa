import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { Actor, AuthService, userDto } from "./auth";
import { InvitationsService, InvitationDelivery } from "./invitations";
import { Db } from "./db";
import {
  availabilitySchema,
  editUserSchema,
  ensure,
  staffSchema,
} from "./domain";
import { ChangeBus } from "./realtime";
import { Writes, audit, checkVersion } from "./writes";

@Injectable()
export class StaffService {
  constructor(
    private readonly db: Db,
    private readonly writes: Writes,
    private readonly bus: ChangeBus,
    private readonly auth: AuthService,
    private readonly invitations: InvitationsService,
  ) {}
  async me(actor: Actor) {
    return userDto(
      await this.db.user.findUniqueOrThrow({ where: { id: actor.id } }),
    );
  }
  async users(actor: Actor) {
    return (
      await this.db.user.findMany({
        where: { storeId: actor.storeId, role: { not: "CUSTOMER" } },
        orderBy: { name: "asc" },
        include: { invitations: { orderBy: { createdAt: "desc" }, take: 1 } },
        take: 100,
      })
    ).map((user) => this.invitations.dto(user));
  }
  async create(actor: Actor, key: string, input: z.infer<typeof staffSchema>) {
    await this.auth.rate(`staff-create:${actor.id}`, 10, 60);
    this.invitations.configured();
    let delivery: InvitationDelivery | undefined;
    const result = await this.writes.run(
      actor,
      key,
      "staff:new",
      input,
      async (tx) => {
        ensure(
          (await tx.user.count({
            where: { storeId: actor.storeId, role: { not: "CUSTOMER" } },
          })) < 100,
          "STAFF_LIMIT",
          "Limite de 100 funcionários atingido.",
        );
        const user = await tx.user.create({
          data: {
            ...input,
            storeId: actor.storeId,
            passwordHash: "!INVITED",
            phone: "",
            onboardingPending: true,
            available: false,
          },
        });
        delivery = await this.invitations.prepare(tx, user);
        await audit(tx, actor, "staff.created", {
          userId: user.id,
          role: user.role,
        });
        return { data: userDto(user) };
      },
    );
    if (delivery) await this.invitations.deliver(delivery);
    return this.invitationUser(actor, result.id);
  }
  private async invitationUser(actor: Actor, id: string) {
    const user = await this.db.user.findFirstOrThrow({
      where: { id, storeId: actor.storeId },
      include: { invitations: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    return this.invitations.dto(user);
  }
  async resendInvitation(actor: Actor, key: string, id: string) {
    this.invitations.configured();
    await this.auth.rate(`invite-resend:${actor.storeId}:${id}`, 3, 3600);
    let delivery: InvitationDelivery | undefined;
    await this.writes.run(actor, key, `staff:${id}:invite`, {}, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id, storeId: actor.storeId, role: { not: "CUSTOMER" } },
      });
      ensure(user, "NOT_FOUND", "Funcionário não encontrado.", 404);
      ensure(
        user.enabled && user.onboardingPending,
        "INVITATION_UNAVAILABLE",
        "O acesso está desativado ou já foi concluído.",
        409,
      );
      delivery = await this.invitations.prepare(tx, user);
      await audit(tx, actor, "staff.invitation.resent", { userId: id });
      return { data: { id } };
    });
    if (delivery) await this.invitations.deliver(delivery);
    return this.invitationUser(actor, id);
  }
  async edit(
    actor: Actor,
    key: string,
    id: string,
    input: z.infer<typeof editUserSchema>,
  ) {
    const result = await this.writes.run(
      actor,
      key,
      `staff:${id}`,
      input,
      async (tx) => {
        const user = await tx.user.findFirst({
          where: { id, storeId: actor.storeId, role: { not: "CUSTOMER" } },
        });
        ensure(user, "NOT_FOUND", "Funcionário não encontrado.", 404);
        checkVersion(user.version, input.expectedVersion);
        ensure(
          id !== actor.id || input.enabled,
          "SELF_DISABLE",
          "Não é possível desativar a própria conta.",
        );
        if (!input.enabled && user.role === "DRIVER")
          ensure(
            (await tx.order.count({
              where: {
                driverId: id,
                storeId: actor.storeId,
                status: { notIn: ["CANCELLED", "DELIVERED", "RETURNED"] },
              },
            })) === 0,
            "DRIVER_BUSY",
            "Reatribua ou conclua os pedidos do entregador antes de desativá-lo.",
            409,
          );
        const sessions = !input.enabled
          ? await tx.session.findMany({
              where: { userId: id },
              select: { id: true },
            })
          : [];
        if (!input.enabled) {
          await tx.session.deleteMany({ where: { userId: id } });
          await tx.staffInvitation.updateMany({
            where: { userId: id, consumedAt: null },
            data: { consumedAt: new Date() },
          });
        }
        const updated = await tx.user.update({
          where: { id },
          data: { enabled: input.enabled, version: { increment: 1 } },
        });
        await audit(tx, actor, "staff.updated", {
          userId: id,
          enabled: input.enabled,
        });
        return {
          data: {
            user: userDto(updated),
            revokedSessions: sessions.map((s) => s.id),
          },
          events: [
            { storeId: actor.storeId, type: "driver.availability.changed" },
          ],
        };
      },
    );
    result.revokedSessions.forEach((id) => this.bus.revoke(id));
    return result.user;
  }
  async drivers(actor: Actor) {
    const users = await this.db.user.findMany({
      where: {
        storeId: actor.storeId,
        role: "DRIVER",
        onboardingPending: false,
      },
      orderBy: { name: "asc" },
      include: {
        driverOrders: {
          where: { status: { notIn: ["DELIVERED", "RETURNED", "CANCELLED"] } },
          select: {
            id: true,
            number: true,
            status: true,
            deliveryStatus: true,
          },
        },
      },
    });
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      enabled: u.enabled,
      available: u.available,
      version: u.version,
      orders: u.driverOrders,
    }));
  }
  availability(
    actor: Actor,
    key: string,
    id: string,
    input: z.infer<typeof availabilitySchema>,
  ) {
    ensure(
      actor.role === "MANAGER" || actor.id === id,
      "FORBIDDEN",
      "Só é possível alterar a própria disponibilidade.",
      403,
    );
    return this.writes.run(
      actor,
      key,
      `driver:${id}:availability`,
      input,
      async (tx) => {
        const user = await tx.user.findFirst({
          where: {
            id,
            storeId: actor.storeId,
            role: "DRIVER",
            enabled: true,
            onboardingPending: false,
          },
        });
        ensure(user, "NOT_FOUND", "Entregador não encontrado.", 404);
        checkVersion(user.version, input.expectedVersion);
        const updated = await tx.user.update({
          where: { id },
          data: { available: input.available, version: { increment: 1 } },
        });
        await audit(tx, actor, "driver.availability.changed", {
          driverId: id,
          available: input.available,
        });
        return {
          data: { id, available: updated.available, version: updated.version },
          events: [
            { type: "driver.availability.changed", storeId: actor.storeId },
          ],
        };
      },
    );
  }
}
