ALTER TABLE "x_post_metrics"
ADD COLUMN "nostrEventId" TEXT;

CREATE INDEX "x_post_metrics_pubkey_nostrEventId_idx"
ON "x_post_metrics"("pubkey", "nostrEventId");