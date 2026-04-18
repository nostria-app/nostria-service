ALTER TABLE "payments"
  ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'subscription',
  ADD COLUMN "creditNanosUsd" BIGINT,
  ADD COLUMN "applied" BIGINT;

CREATE INDEX "payments_purpose_idx" ON "payments"("purpose");

CREATE TABLE "grok_balances" (
  "pubkey" TEXT NOT NULL,
  "balanceNanosUsd" BIGINT NOT NULL,
  "totalSpentNanosUsd" BIGINT NOT NULL,
  "totalToppedUpNanosUsd" BIGINT NOT NULL,
  "created" BIGINT NOT NULL,
  "modified" BIGINT NOT NULL,
  CONSTRAINT "grok_balances_pkey" PRIMARY KEY ("pubkey")
);

CREATE TABLE "grok_transactions" (
  "id" TEXT NOT NULL,
  "pubkey" TEXT NOT NULL,
  "transactionType" TEXT NOT NULL,
  "amountNanosUsd" BIGINT NOT NULL,
  "balanceAfterNanosUsd" BIGINT NOT NULL,
  "paymentId" TEXT,
  "requestId" TEXT,
  "description" TEXT,
  "created" BIGINT NOT NULL,
  "modified" BIGINT NOT NULL,
  CONSTRAINT "grok_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "grok_transactions_pubkey_idx" ON "grok_transactions"("pubkey");
CREATE INDEX "grok_transactions_paymentId_idx" ON "grok_transactions"("paymentId");
CREATE INDEX "grok_transactions_requestId_idx" ON "grok_transactions"("requestId");
CREATE INDEX "grok_transactions_created_idx" ON "grok_transactions"("created");

CREATE TABLE "grok_usages" (
  "id" TEXT NOT NULL,
  "pubkey" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "providerRequestId" TEXT,
  "operationType" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL,
  "outputTokens" INTEGER NOT NULL,
  "reasoningTokens" INTEGER NOT NULL,
  "imageCount" INTEGER NOT NULL,
  "costNanosUsd" BIGINT NOT NULL,
  "created" BIGINT NOT NULL,
  "modified" BIGINT NOT NULL,
  CONSTRAINT "grok_usages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "grok_usages_requestId_key" ON "grok_usages"("requestId");
CREATE INDEX "grok_usages_pubkey_idx" ON "grok_usages"("pubkey");
CREATE INDEX "grok_usages_operationType_idx" ON "grok_usages"("operationType");
CREATE INDEX "grok_usages_created_idx" ON "grok_usages"("created");
CREATE INDEX "grok_usages_pubkey_operationType_created_idx" ON "grok_usages"("pubkey", "operationType", "created");

CREATE TABLE "grok_config" (
  "id" TEXT NOT NULL,
  "settings" JSONB NOT NULL,
  "created" BIGINT NOT NULL,
  "modified" BIGINT NOT NULL,
  CONSTRAINT "grok_config_pkey" PRIMARY KEY ("id")
);