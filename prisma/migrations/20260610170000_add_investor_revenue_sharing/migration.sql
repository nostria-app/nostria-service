CREATE TABLE "investors" (
  "id" TEXT NOT NULL,
  "pubkey" TEXT NOT NULL,
  "npub" TEXT,
  "displayName" TEXT,
  "investmentCents" INTEGER NOT NULL DEFAULT 0,
  "shareBasisPoints" INTEGER NOT NULL DEFAULT 0,
  "lightningAddress" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created" BIGINT NOT NULL,
  "modified" BIGINT NOT NULL,

  CONSTRAINT "investors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "revenue_share_periods" (
  "id" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "grossRevenueCents" INTEGER NOT NULL,
  "investorPoolCents" INTEGER NOT NULL,
  "revenueShareBasisPoints" INTEGER NOT NULL DEFAULT 5000,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "notes" TEXT,
  "created" BIGINT NOT NULL,
  "modified" BIGINT NOT NULL,

  CONSTRAINT "revenue_share_periods_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "investor_payouts" (
  "id" TEXT NOT NULL,
  "investorPubkey" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "shareBasisPoints" INTEGER NOT NULL,
  "revenueCents" INTEGER NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "amountSat" INTEGER,
  "lnInvoice" TEXT,
  "lnPaymentHash" TEXT,
  "nwcPreimage" TEXT,
  "nwcResponse" JSONB,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "errorMessage" TEXT,
  "paid" BIGINT,
  "created" BIGINT NOT NULL,
  "modified" BIGINT NOT NULL,

  CONSTRAINT "investor_payouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "investors_pubkey_key" ON "investors"("pubkey");
CREATE INDEX "investors_status_idx" ON "investors"("status");

CREATE UNIQUE INDEX "revenue_share_periods_period_key" ON "revenue_share_periods"("period");
CREATE INDEX "revenue_share_periods_period_idx" ON "revenue_share_periods"("period");
CREATE INDEX "revenue_share_periods_status_idx" ON "revenue_share_periods"("status");

CREATE UNIQUE INDEX "investor_payouts_investorPubkey_periodId_key" ON "investor_payouts"("investorPubkey", "periodId");
CREATE INDEX "investor_payouts_investorPubkey_idx" ON "investor_payouts"("investorPubkey");
CREATE INDEX "investor_payouts_periodId_idx" ON "investor_payouts"("periodId");
CREATE INDEX "investor_payouts_status_idx" ON "investor_payouts"("status");

ALTER TABLE "investor_payouts"
ADD CONSTRAINT "investor_payouts_investorPubkey_fkey"
FOREIGN KEY ("investorPubkey") REFERENCES "investors"("pubkey")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "investor_payouts"
ADD CONSTRAINT "investor_payouts_periodId_fkey"
FOREIGN KEY ("periodId") REFERENCES "revenue_share_periods"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "investors" (
  "id",
  "pubkey",
  "npub",
  "displayName",
  "investmentCents",
  "shareBasisPoints",
  "status",
  "created",
  "modified"
) VALUES
(
  'investor-fb61b93d864e4f0eba766bb8556f2dc0262e8e985012e29ba28508dd52067d98',
  'fb61b93d864e4f0eba766bb8556f2dc0262e8e985012e29ba28508dd52067d98',
  'npub1ldsmj0vxfe8sawnkdwu92medcqnzar5c2qfw9xazs5yd65sx0kvqghzsk3',
  'Investor 1',
  0,
  3334,
  'active',
  EXTRACT(EPOCH FROM NOW())::bigint * 1000,
  EXTRACT(EPOCH FROM NOW())::bigint * 1000
),
(
  'investor-94aa634abe914925dee36aaceb7cd467cb2ad07c65fef4ada9eed3e66a66f14b',
  '94aa634abe914925dee36aaceb7cd467cb2ad07c65fef4ada9eed3e66a66f14b',
  'npub1jj4xxj47j9yjthhrd2kwklx5vl9j45ruvhl0ftdfamf7v6nx799ssf45q3',
  'Investor 2',
  0,
  3333,
  'active',
  EXTRACT(EPOCH FROM NOW())::bigint * 1000,
  EXTRACT(EPOCH FROM NOW())::bigint * 1000
),
(
  'investor-d1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b',
  'd1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b',
  'npub16x7nxvehx0wvgy0sa6ynkw9c2ghuph3z0ll5t8veq3xwm8n9tqds6ka44x',
  'Investor 3',
  0,
  3333,
  'active',
  EXTRACT(EPOCH FROM NOW())::bigint * 1000,
  EXTRACT(EPOCH FROM NOW())::bigint * 1000
);
