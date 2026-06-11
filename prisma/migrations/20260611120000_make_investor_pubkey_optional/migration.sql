ALTER TABLE "investor_payouts"
DROP CONSTRAINT IF EXISTS "investor_payouts_investorPubkey_fkey";

ALTER TABLE "investor_payouts"
ADD COLUMN "investorId" TEXT;

UPDATE "investor_payouts" payout
SET "investorId" = investor."id"
FROM "investors" investor
WHERE payout."investorPubkey" = investor."pubkey";

ALTER TABLE "investor_payouts"
ALTER COLUMN "investorId" SET NOT NULL;

DROP INDEX IF EXISTS "investor_payouts_investorPubkey_periodId_key";

ALTER TABLE "investors"
ALTER COLUMN "pubkey" DROP NOT NULL;

ALTER TABLE "investor_payouts"
ALTER COLUMN "investorPubkey" DROP NOT NULL;

CREATE UNIQUE INDEX "investor_payouts_investorId_periodId_key"
ON "investor_payouts"("investorId", "periodId");

CREATE INDEX "investor_payouts_investorId_idx"
ON "investor_payouts"("investorId");

ALTER TABLE "investor_payouts"
ADD CONSTRAINT "investor_payouts_investorId_fkey"
FOREIGN KEY ("investorId") REFERENCES "investors"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
