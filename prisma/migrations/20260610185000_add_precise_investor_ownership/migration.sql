ALTER TABLE "investors"
ADD COLUMN "sharePartsPerMillion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "investor_payouts"
ADD COLUMN "sharePartsPerMillion" INTEGER NOT NULL DEFAULT 0;

UPDATE "investors"
SET "sharePartsPerMillion" = "shareBasisPoints" * 100;

UPDATE "investor_payouts"
SET "sharePartsPerMillion" = "shareBasisPoints" * 100;
