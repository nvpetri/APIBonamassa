import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";
import { Server as HttpServer } from "node:http";
import { Server, Socket } from "socket.io";
import type { Actor, AuthService } from "./auth";

export type Change = {
  storeId: string;
  type: string;
  orderId?: string;
  version?: number;
  customerId?: string | null;
  driverId?: string | null;
  previousDriverId?: string | null;
};
@Injectable()
export class ChangeBus {
  readonly events = new EventEmitter();
  publish(event: Change) {
    this.events.emit("change", event);
  }
  revoke(sessionId: string) {
    this.events.emit("revoke", sessionId);
  }
}
export function attachRealtime(
  server: HttpServer,
  auth: AuthService,
  bus: ChangeBus,
  origins: string[],
) {
  const io = new Server(server, {
    path: "/socket.io",
    maxHttpBufferSize: 16_384,
    cors: { origin: origins, credentials: false },
    allowRequest: (req, done) =>
      done(null, !req.headers.origin || origins.includes(req.headers.origin)),
  });
  io.use(async (socket, next) => {
    try {
      await auth.rate(`socket:${socket.handshake.address}`, 30, 60);
      socket.data.actor = await auth.authenticate(socket.handshake.auth.token);
      next();
    } catch {
      next(new Error("UNAUTHENTICATED"));
    }
  });
  const active = async (socket: Socket) => {
    try {
      // Notifications do not count as user activity; only authenticate() renews a session.
      await auth.assertActive(socket.data.actor);
      return socket.connected;
    } catch {
      socket.disconnect(true);
      return false;
    }
  };
  io.on("connection", (socket) => {
    socket.emit("ready", { reconcile: true });
    const timer = setInterval(() => void active(socket), 60_000);
    timer.unref();
    socket.on("disconnect", () => clearInterval(timer));
  });
  const changed = async (e: Change) => {
    for (const socket of io.sockets.sockets.values()) {
      const actor: Actor = socket.data.actor;
      if (actor.storeId !== e.storeId) continue;
      const staff = ["MANAGER", "ATTENDANT", "KITCHEN"].includes(actor.role);
      if (
        e.orderId &&
        !staff &&
        actor.id !== e.customerId &&
        actor.id !== e.driverId &&
        actor.id !== e.previousDriverId
      )
        continue;
      if (!(await active(socket))) continue;
      socket.emit("invalidate", {
        type: e.type,
        ...(e.orderId ? { orderId: e.orderId, version: e.version } : {}),
      });
    }
  };
  const revoke = (sessionId: string) => {
    for (const s of io.sockets.sockets.values())
      if (s.data.actor.sessionId === sessionId) s.disconnect(true);
  };
  bus.events.on("change", changed);
  bus.events.on("revoke", revoke);
  return async () => {
    bus.events.off("change", changed);
    bus.events.off("revoke", revoke);
    await new Promise<void>((resolve) => io.close(() => resolve()));
  };
}
