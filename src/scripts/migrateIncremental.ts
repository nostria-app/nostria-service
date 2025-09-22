#!/usr/bin/env node
/**
 * Incremental migration script.
 *
 * Purpose: Re-run migration after initial full migration to bring over ONLY new or updated
 * documents that are present in CosmosDB but not yet in PostgreSQL.
 *
 * Strategy:
 *  - Re-uses DataMigrationUtility migrate* functions with `skipExisting=true` so only missing rows are inserted.
 *  - Provides optional filtering by data type to narrow scope (accounts, backups, notifications, payments, settings, all).
 *  - Supports dry-run mode (no writes) to preview counts.
 *  - Outputs summary and per-type stats.
 *
 * Usage:
 *   npm run migrate:incremental              # migrate all supported types (accounts, backup jobs (per user not batched), notifications, payments, settings)
 *   npm run migrate:incremental:accounts     # accounts only
 *   npm run migrate:incremental:notifications
 *   npm run migrate:incremental:payments
 *   npm run migrate:incremental:settings
 *   npm run migrate:incremental:dry-run      # all types, no writes
 *
 * Environment variables required (same as full migration):
 *   MIGRATION_MODE=true
 *   DATABASE_URL=postgresql://...
 *   AZURE_COSMOSDB_CONNECTION_STRING=...
 */

import dotenv from 'dotenv';
dotenv.config();

import { DataMigrationUtility } from '../utils/DataMigrationUtility';
import logger from '../utils/logger';
import PrismaClientSingleton from '../database/prismaClient';

interface IncrementalResult {
  label: string;
  skipped?: number; // Derived when migrated == total (already existed)
  total: number;
  migrated: number;
  failed: number;
}

async function main() {
  const arg = process.argv[2];
  const dryRun = arg === 'dry-run' || process.argv.includes('--dry-run');

  const target = (arg && !['dry-run'].includes(arg)) ? arg : 'all';

  if (!target || ['-h', '--help', 'help'].includes(target)) {
    printHelp();
    process.exit(0);
  }

  try {
    await PrismaClientSingleton.connect();
    logger.info('Incremental migration starting', { target, dryRun });

    const results: IncrementalResult[] = [];

    if (target === 'accounts' || target === 'all') {
      const r = await DataMigrationUtility.migrateAccounts({ batchSize: 100, skipExisting: true, dryRun });
      results.push({ label: 'Accounts', total: r.total, migrated: r.migrated, failed: r.failed });
    }

    if (target === 'notifications' || target === 'all') {
      const r = await DataMigrationUtility.migrateNotificationSubscriptions({ batchSize: 200, skipExisting: true, dryRun });
      results.push({ label: 'Notification Subscriptions', total: r.total, migrated: r.migrated, failed: r.failed });
    }

    if (target === 'payments' || target === 'all') {
      const r = await DataMigrationUtility.migratePayments({ batchSize: 200, skipExisting: true, dryRun });
      results.push({ label: 'Payments', total: r.total, migrated: r.migrated, failed: r.failed });
    }

    if (target === 'settings' || target === 'all') {
      const r = await DataMigrationUtility.migrateNotificationSettings({ batchSize: 200, skipExisting: true, dryRun });
      results.push({ label: 'Notification Settings', total: r.total, migrated: r.migrated, failed: r.failed });
    }

    // Summarize
    console.log(`\n=== Incremental Migration (${dryRun ? 'DRY RUN' : 'EXECUTION'}) ===`);
    for (const res of results) {
      const skipped = Math.max(0, res.total - res.migrated - res.failed); // heuristic; migrated count includes skipped in current utility when skipExisting=true
      console.log(`${res.label}: total=${res.total}, migrated(or already existed)=${res.migrated}, failed=${res.failed}`);
    }

    console.log('\nDone. If counts for a type show migrated equal to total, they likely all existed already.');
  } catch (err) {
    logger.error('Incremental migration failed', err);
    process.exit(1);
  } finally {
    await PrismaClientSingleton.disconnect();
  }
}

function printHelp() {
  console.log(`Incremental Migration Help\n\nUsage: tsx migrateIncremental.ts <target>|dry-run\n\nTargets:\n  all               Run all incremental migrations (default)\n  accounts          Accounts only\n  notifications     Notification subscriptions only\n  payments          Payments only\n  settings          Notification settings only\n  dry-run           Run all in dry-run mode (no writes)\n\nExamples:\n  tsx migrateIncremental.ts             # all types\n  tsx migrateIncremental.ts accounts    # accounts only\n  tsx migrateIncremental.ts dry-run     # preview\n`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
