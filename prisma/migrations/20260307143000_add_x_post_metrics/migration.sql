CREATE TABLE "x_post_metrics" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "xPostId" TEXT NOT NULL,
    "hasMedia" BOOLEAN NOT NULL,
    "created" BIGINT NOT NULL,
    "modified" BIGINT NOT NULL,

    CONSTRAINT "x_post_metrics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "x_post_metrics_xPostId_key" ON "x_post_metrics"("xPostId");
CREATE INDEX "x_post_metrics_pubkey_idx" ON "x_post_metrics"("pubkey");
CREATE INDEX "x_post_metrics_created_idx" ON "x_post_metrics"("created");
CREATE INDEX "x_post_metrics_pubkey_created_idx" ON "x_post_metrics"("pubkey", "created");

ALTER TABLE "x_post_metrics"
ADD CONSTRAINT "x_post_metrics_pubkey_fkey"
FOREIGN KEY ("pubkey") REFERENCES "accounts"("pubkey") ON DELETE CASCADE ON UPDATE CASCADE;