-- Additive migration: existing orders and their history are preserved.
ALTER TABLE "Store"
  ADD COLUMN "scheduleEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "opensAt" VARCHAR(5) NOT NULL DEFAULT '17:00',
  ADD COLUMN "closesAt" VARCHAR(5) NOT NULL DEFAULT '03:00',
  ADD COLUMN "overrideOpen" BOOLEAN,
  ADD COLUMN "overrideUntil" TIMESTAMP(3);
ALTER TABLE "Store" ADD CONSTRAINT "Store_valid_hours" CHECK (
  "opensAt" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
  "closesAt" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
  "opensAt" <> "closesAt"
);
ALTER TABLE "Order" ADD COLUMN "scheduledFor" TIMESTAMP(3);
CREATE INDEX "Order_storeId_status_scheduledFor_idx"
  ON "Order"("storeId", "status", "scheduledFor");
ALTER TABLE "OrderEvent" ALTER COLUMN "actorId" DROP NOT NULL;

ALTER TABLE "Order" DROP CONSTRAINT "order_delivery_state";
ALTER TABLE "Order" ADD CONSTRAINT "order_delivery_state" CHECK (
  (mode = 'PICKUP' AND "driverId" IS NULL AND "deliveryStatus" IS NULL AND status IN ('SCHEDULED','NEW','CONFIRMED','PREPARING','READY','CANCELLED','DELIVERED')) OR
  (mode = 'DELIVERY' AND (
    ("driverId" IS NULL AND "deliveryStatus" IS NULL AND status IN ('SCHEDULED','NEW','CONFIRMED','PREPARING','READY','CANCELLED')) OR
    ("driverId" IS NOT NULL AND "deliveryStatus" IS NOT NULL AND ((status = 'READY' AND "deliveryStatus" IN ('ASSIGNED','COLLECTED')) OR (status = 'OUT_FOR_DELIVERY' AND "deliveryStatus" = 'ON_ROUTE') OR (status = 'RETURNING' AND "deliveryStatus" = 'RETURNING') OR (status = 'RETURNED' AND "deliveryStatus" = 'RETURNED') OR (status = 'DELIVERED' AND "deliveryStatus" = 'DELIVERED')))
  ))
);
ALTER TABLE "Order" ADD CONSTRAINT "order_scheduled_time" CHECK (
  status <> 'SCHEDULED' OR "scheduledFor" IS NOT NULL
);
