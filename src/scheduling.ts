import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Store } from "@prisma/client";
import { Db, Tx } from "./db";
import { Change, ChangeBus } from "./realtime";
import { operation } from "./schedule";

@Injectable()
export class SchedulingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Scheduling");
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly db: Db, private readonly bus: ChangeBus) {}
  onModuleInit() {
    // Requests also reconcile, so a sleeping/restarted service cannot miss a shift.
    this.timer = setInterval(() => void this.tick(), 15_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const stores = await this.db.store.findMany({
        where: { scheduleEnabled: true }, select: { id: true },
      });
      for (const store of stores) await this.reconcile(store.id);
    } catch (error) {
      this.logger.error({
        message: "Falha ao reconciliar horário; haverá nova tentativa.",
        errorType: error instanceof Error ? error.name : "Unknown",
      });
    } finally {
      this.running = false;
    }
  }
  async reconcile(storeId: string) {
    const result = await this.db.write(storeId, async (tx) => {
      const store = await tx.store.findUniqueOrThrow({ where: { id: storeId } });
      return this.sync(tx, store);
    });
    for (const event of result.events) this.bus.publish(event);
    return result.store;
  }
  async sync(tx: Tx, store: Store, now = new Date()) {
    const state = operation(store, now);
    const events: Change[] = [];
    let saved = store;
    if (store.open !== state.open ||
        (store.overrideUntil !== null && +store.overrideUntil <= +now)) {
      saved = await tx.store.update({
        where: { id: store.id },
        data: {
          open: state.open,
          ...(!state.overrideUntil ? { overrideOpen: null, overrideUntil: null } : {}),
          version: { increment: 1 },
        },
      });
      events.push({ storeId: store.id, type: "store.updated" });
    }
    if (state.open) {
      // Explicit early opening releases today's next-opening reservations too.
      const due = state.overrideOpen === true && !state.scheduledOpen && state.nextOpening
        ? new Date(state.nextOpening) : now;
      const orders = await tx.order.findMany({
        where: { storeId: store.id, status: "SCHEDULED", scheduledFor: { lte: due } },
        select: { id: true, version: true, customerId: true, scheduledFor: true },
      });
      if (orders.length) {
        await tx.order.updateMany({
          where: { storeId: store.id, id: { in: orders.map((o) => o.id) }, status: "SCHEDULED" },
          data: { status: "NEW", version: { increment: 1 }, updatedAt: now },
        });
        await tx.orderEvent.createMany({
          data: orders.map((o) => ({
            orderId: o.id, version: o.version + 1, action: "schedule-released",
            actorId: null, data: { scheduledFor: o.scheduledFor!.toISOString() },
            createdAt: now,
          })),
        });
        events.push(...orders.map((o) => ({
          storeId: store.id, type: "order.schedule-released", orderId: o.id,
          version: o.version + 1, customerId: o.customerId,
        })));
      }
    }
    return { store: saved, events };
  }
}
