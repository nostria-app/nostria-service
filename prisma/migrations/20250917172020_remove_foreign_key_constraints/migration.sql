-- DropForeignKey
ALTER TABLE "public"."notification_settings" DROP CONSTRAINT "notification_settings_pubkey_fkey";

-- DropForeignKey
ALTER TABLE "public"."notification_subscriptions" DROP CONSTRAINT "notification_subscriptions_pubkey_fkey";

-- DropForeignKey
ALTER TABLE "public"."payments" DROP CONSTRAINT "payments_pubkey_fkey";

-- DropForeignKey
ALTER TABLE "public"."user_settings" DROP CONSTRAINT "user_settings_pubkey_fkey";
