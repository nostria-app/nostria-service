-- CreateTable
CREATE TABLE "public"."accounts" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "username" TEXT,
    "tier" TEXT NOT NULL,
    "expires" BIGINT,
    "created" BIGINT NOT NULL,
    "modified" BIGINT NOT NULL,
    "lastLoginDate" BIGINT,
    "subscription" JSONB NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."backup_jobs" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "backupType" TEXT NOT NULL,
    "requested" BIGINT NOT NULL,
    "scheduled" BIGINT,
    "started" BIGINT,
    "completed" BIGINT,
    "errorMessage" TEXT,
    "resultUrl" TEXT,
    "expires" BIGINT,
    "metadata" JSONB,

    CONSTRAINT "backup_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notification_logs" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "content" TEXT,
    "template" TEXT,
    "created" BIGINT NOT NULL,
    "modified" BIGINT NOT NULL,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notification_settings" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "filters" JSONB,
    "settings" JSONB,
    "created" BIGINT NOT NULL,
    "modified" BIGINT NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notification_subscriptions" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "subscription" JSONB NOT NULL,
    "deviceKey" TEXT NOT NULL,
    "created" BIGINT NOT NULL,
    "modified" BIGINT NOT NULL,

    CONSTRAINT "notification_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payments" (
    "id" TEXT NOT NULL,
    "paymentType" TEXT NOT NULL,
    "lnHash" TEXT NOT NULL,
    "lnInvoice" TEXT NOT NULL,
    "lnAmountSat" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "isPaid" BOOLEAN NOT NULL,
    "paid" BIGINT,
    "expires" BIGINT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "created" BIGINT NOT NULL,
    "modified" BIGINT NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_settings" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "releaseChannel" TEXT NOT NULL,
    "socialSharing" BOOLEAN NOT NULL,
    "created" BIGINT NOT NULL,
    "modified" BIGINT NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_pubkey_key" ON "public"."accounts"("pubkey");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_username_key" ON "public"."accounts"("username");

-- CreateIndex
CREATE INDEX "backup_jobs_pubkey_idx" ON "public"."backup_jobs"("pubkey");

-- CreateIndex
CREATE INDEX "backup_jobs_status_idx" ON "public"."backup_jobs"("status");

-- CreateIndex
CREATE INDEX "notification_logs_pubkey_idx" ON "public"."notification_logs"("pubkey");

-- CreateIndex
CREATE INDEX "notification_logs_created_idx" ON "public"."notification_logs"("created");

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_pubkey_key" ON "public"."notification_settings"("pubkey");

-- CreateIndex
CREATE INDEX "notification_subscriptions_pubkey_idx" ON "public"."notification_subscriptions"("pubkey");

-- CreateIndex
CREATE UNIQUE INDEX "notification_subscriptions_pubkey_deviceKey_key" ON "public"."notification_subscriptions"("pubkey", "deviceKey");

-- CreateIndex
CREATE INDEX "payments_pubkey_idx" ON "public"."payments"("pubkey");

-- CreateIndex
CREATE INDEX "payments_lnHash_idx" ON "public"."payments"("lnHash");

-- CreateIndex
CREATE INDEX "payments_isPaid_idx" ON "public"."payments"("isPaid");

-- CreateIndex
CREATE INDEX "payments_expires_idx" ON "public"."payments"("expires");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_pubkey_key" ON "public"."user_settings"("pubkey");

-- AddForeignKey
ALTER TABLE "public"."backup_jobs" ADD CONSTRAINT "backup_jobs_pubkey_fkey" FOREIGN KEY ("pubkey") REFERENCES "public"."accounts"("pubkey") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notification_logs" ADD CONSTRAINT "notification_logs_pubkey_fkey" FOREIGN KEY ("pubkey") REFERENCES "public"."accounts"("pubkey") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notification_settings" ADD CONSTRAINT "notification_settings_pubkey_fkey" FOREIGN KEY ("pubkey") REFERENCES "public"."accounts"("pubkey") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_pubkey_fkey" FOREIGN KEY ("pubkey") REFERENCES "public"."accounts"("pubkey") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payments" ADD CONSTRAINT "payments_pubkey_fkey" FOREIGN KEY ("pubkey") REFERENCES "public"."accounts"("pubkey") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_settings" ADD CONSTRAINT "user_settings_pubkey_fkey" FOREIGN KEY ("pubkey") REFERENCES "public"."accounts"("pubkey") ON DELETE CASCADE ON UPDATE CASCADE;
