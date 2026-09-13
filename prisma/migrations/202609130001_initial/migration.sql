-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MANAGER', 'ATTENDANT', 'KITCHEN', 'DRIVER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'RETURNING', 'DELIVERED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('ASSIGNED', 'COLLECTED', 'ON_ROUTE', 'RETURNING', 'DELIVERED', 'RETURNED');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('PIZZA', 'CRUST', 'DRINK', 'COMBO');

-- CreateTable
CREATE TABLE "Store" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "open" BOOLEAN NOT NULL DEFAULT false,
    "deliveryFee" INTEGER NOT NULL DEFAULT 700,
    "driverFee" INTEGER NOT NULL DEFAULT 800,
    "version" INTEGER NOT NULL DEFAULT 1,
    "nextNumber" INTEGER NOT NULL DEFAULT 1000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "storeId" UUID NOT NULL,
    "id" VARCHAR(80) NOT NULL,
    "category" "Category" NOT NULL,
    "nameKey" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,
    "imageId" UUID,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("storeId","id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "bytes" BYTEA NOT NULL,
    "digest" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "storeId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,
    "pizzaLimit" INTEGER,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "sold" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("storeId","id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "draft" JSONB NOT NULL,
    "priced" JSONB NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "quoteId" UUID NOT NULL,
    "customerId" UUID,
    "driverId" UUID,
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "deliveryStatus" "DeliveryStatus",
    "version" INTEGER NOT NULL DEFAULT 1,
    "mode" VARCHAR(20) NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "customer" JSONB NOT NULL,
    "address" JSONB,
    "note" VARCHAR(240) NOT NULL,
    "items" JSONB NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "payment" VARCHAR(20) NOT NULL,
    "paymentRecorded" BOOLEAN NOT NULL DEFAULT false,
    "cashTendered" INTEGER,
    "recipient" VARCHAR(80),
    "driverFee" INTEGER NOT NULL DEFAULT 0,
    "promotionId" UUID,
    "promotionSnapshot" JSONB,
    "promotionQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "actorId" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Idempotency" (
    "storeId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Idempotency_pkey" PRIMARY KEY ("storeId","userId","key")
);

-- CreateTable
CREATE TABLE "RateBucket" (
    "key" CHAR(64) NOT NULL,
    "count" INTEGER NOT NULL,
    "resetsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Store_slug_key" ON "Store"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_storeId_email_key" ON "User"("storeId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "User_storeId_id_key" ON "User"("storeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_storeId_category_nameKey_key" ON "Product"("storeId", "category", "nameKey");

-- CreateIndex
CREATE INDEX "ProductImage_createdAt_idx" ON "ProductImage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImage_storeId_id_key" ON "ProductImage"("storeId", "id");

-- CreateIndex
CREATE INDEX "Quote_expiresAt_idx" ON "Quote"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_storeId_id_key" ON "Quote"("storeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Order_quoteId_key" ON "Order"("quoteId");

-- CreateIndex
CREATE INDEX "Order_storeId_createdAt_id_idx" ON "Order"("storeId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Order_storeId_status_createdAt_id_idx" ON "Order"("storeId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Order_storeId_driverId_createdAt_id_idx" ON "Order"("storeId", "driverId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Order_storeId_customerId_createdAt_id_idx" ON "Order"("storeId", "customerId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_number_key" ON "Order"("storeId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_quoteId_key" ON "Order"("storeId", "quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderEvent_orderId_version_key" ON "OrderEvent"("orderId", "version");

-- CreateIndex
CREATE INDEX "RateBucket_resetsAt_idx" ON "RateBucket"("resetsAt");

-- CreateIndex
CREATE INDEX "Audit_storeId_createdAt_idx" ON "Audit"("storeId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_storeId_imageId_fkey" FOREIGN KEY ("storeId", "imageId") REFERENCES "ProductImage"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_storeId_userId_fkey" FOREIGN KEY ("storeId", "userId") REFERENCES "User"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_quoteId_fkey" FOREIGN KEY ("storeId", "quoteId") REFERENCES "Quote"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_customerId_fkey" FOREIGN KEY ("storeId", "customerId") REFERENCES "User"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_driverId_fkey" FOREIGN KEY ("storeId", "driverId") REFERENCES "User"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_promotionId_fkey" FOREIGN KEY ("storeId", "promotionId") REFERENCES "Promotion"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idempotency" ADD CONSTRAINT "Idempotency_storeId_userId_fkey" FOREIGN KEY ("storeId", "userId") REFERENCES "User"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Invariants shared by every writer, including future integrations.
ALTER TABLE "Store" ADD CONSTRAINT "store_limits" CHECK ("deliveryFee" BETWEEN 0 AND 10000 AND "driverFee" BETWEEN 0 AND 10000 AND version > 0 AND "nextNumber" > 0);
ALTER TABLE "Product" ADD CONSTRAINT "product_version_id" CHECK (version > 0 AND id <> 'NONE');
ALTER TABLE "Promotion" ADD CONSTRAINT "promotion_quota" CHECK (reserved >= 0 AND sold >= 0 AND version > 0 AND ("pizzaLimit" IS NULL OR ("pizzaLimit" > 0 AND reserved + sold <= "pizzaLimit")));
ALTER TABLE "Order" ADD CONSTRAINT "order_money" CHECK (subtotal > 0 AND fee >= 0 AND discount >= 0 AND discount <= subtotal AND total = subtotal + fee - discount AND total BETWEEN 0 AND 10000000 AND "driverFee" >= 0 AND version > 0);
ALTER TABLE "Order" ADD CONSTRAINT "order_payment" CHECK (payment IN ('CASH', 'CARD', 'PREPAID') AND (payment <> 'PREPAID' OR "paymentRecorded") AND ("cashTendered" IS NULL OR (payment = 'CASH' AND "cashTendered" >= total)));
ALTER TABLE "Order" ADD CONSTRAINT "order_promotion" CHECK (("promotionId" IS NULL AND "promotionQuantity" = 0 AND "promotionSnapshot" IS NULL AND discount = 0) OR ("promotionId" IS NOT NULL AND "promotionQuantity" > 0 AND "promotionSnapshot" IS NOT NULL AND discount > 0));
ALTER TABLE "Order" ADD CONSTRAINT "order_delivery_state" CHECK (
  (mode = 'PICKUP' AND "driverId" IS NULL AND "deliveryStatus" IS NULL AND status IN ('NEW','CONFIRMED','PREPARING','READY','CANCELLED','DELIVERED')) OR
  (mode = 'DELIVERY' AND (
    ("driverId" IS NULL AND "deliveryStatus" IS NULL AND status IN ('NEW','CONFIRMED','PREPARING','READY','CANCELLED')) OR
    ("driverId" IS NOT NULL AND "deliveryStatus" IS NOT NULL AND ((status = 'READY' AND "deliveryStatus" IN ('ASSIGNED','COLLECTED')) OR (status = 'OUT_FOR_DELIVERY' AND "deliveryStatus" = 'ON_ROUTE') OR (status = 'RETURNING' AND "deliveryStatus" = 'RETURNING') OR (status = 'RETURNED' AND "deliveryStatus" = 'RETURNED') OR (status = 'DELIVERED' AND "deliveryStatus" = 'DELIVERED')))
  ))
);
