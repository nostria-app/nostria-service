/*
  Warnings:

  - Added the required column `status` to the `processed_zap_events` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."processed_zap_events" ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "status" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "processed_zap_events_status_idx" ON "public"."processed_zap_events"("status");
