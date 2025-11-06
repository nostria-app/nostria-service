-- CreateTable
CREATE TABLE "public"."processed_zap_events" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "recipientPubkey" TEXT NOT NULL,
    "giftedBy" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "amountSats" INTEGER NOT NULL,
    "processed" BIGINT NOT NULL,
    "created" BIGINT NOT NULL,

    CONSTRAINT "processed_zap_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "processed_zap_events_eventId_key" ON "public"."processed_zap_events"("eventId");

-- CreateIndex
CREATE INDEX "processed_zap_events_eventId_idx" ON "public"."processed_zap_events"("eventId");

-- CreateIndex
CREATE INDEX "processed_zap_events_recipientPubkey_idx" ON "public"."processed_zap_events"("recipientPubkey");
