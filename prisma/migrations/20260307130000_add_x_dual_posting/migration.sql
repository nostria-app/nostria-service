ALTER TABLE "user_settings"
ADD COLUMN "xUserId" TEXT,
ADD COLUMN "xUsername" TEXT,
ADD COLUMN "xAccessToken" TEXT,
ADD COLUMN "xAccessSecret" TEXT,
ADD COLUMN "xRequestToken" TEXT,
ADD COLUMN "xRequestSecret" TEXT,
ADD COLUMN "xRequestCreated" BIGINT;