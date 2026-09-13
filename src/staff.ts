import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { Actor, AuthService, hashPassword, userDto } from "./auth";
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
        take: 100,
      })
    ).map(userDto);
  }
  async create(actor: Actor, key: string, input: z.infer<typeof staffSchema>) {
    await this.auth.rate(`staff-create:${actor.id}`, 10, 60);
    const passwordHash = await hashPassword(input.password);
    // Hash (not plaintext) contributes to request fingerprint; salt is excluded to keep retries stable.
    const { password: _password, ...publicData } = input;
    const { tokenHash } = await import("./db");
    return this.writes.run(
      actor,
      key,
      "staff:new",
      { ...publicData, passwordDigest: tokenHash(input.password) },
      async (tx) => {
        ensure(
          (await tx.user.count({
            where: { storeId: actor.storeId, role: { not: "CUSTOMER" } },
          })) < 100,
          "STAFF_LIMIT",
          "Limite de 100 funcionários atingido.",
        );
        const user = await tx.user.create({
          data: { ...publicData, storeId: actor.storeId, passwordHash },
        });
        await audit(tx, actor, "staff.created", {
          userId: user.id,
          role: user.role,
        });
        return { data: userDto(user) };
      },
    );
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
        if (!input.enabled)
          await tx.session.deleteMany({ where: { userId: id } });
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
      where: { storeId: actor.storeId, role: "DRIVER" },
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
          where: { id, storeId: actor.storeId, role: "DRIVER", enabled: true },
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
