-- AlterTable
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "storeTransactionId" TEXT;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "storeOriginalTransactionId" TEXT;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "storeProductId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "payments_storeTransactionId_key" ON "payments"("storeTransactionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payments_storeOriginalTransactionId_idx" ON "payments"("storeOriginalTransactionId");
