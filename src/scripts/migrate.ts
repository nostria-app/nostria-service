#!/usr/bin/env node

/**
 * Migration script for Nostria Service
 * 
 * This script helps migrate data from CosmosDB to PostgreSQL.
 * 
 * Usage:
 *   npm run migrate:accounts        # Migrate all accounts
 *   npm run migrate:verify          # Verify migration consistency
 *   npm run migrate:stats           # Show migration statistics
 *   npm run migrate:full            # Full migration with verification
 * 
 * Environment variables:
 *   USE_POSTGRESQL=true             # Use PostgreSQL as primary database
 *   DUAL_DATABASE_MODE=true         # Support both databases
 *   MIGRATION_MODE=true             # Enable migration utilities
 *   DATABASE_URL=postgresql://...   # PostgreSQL connection string
 */

import dotenv from 'dotenv';
dotenv.config();

import { DataMigrationUtility } from '../utils/DataMigrationUtility';
import logger from '../utils/logger';
import PrismaClientSingleton from '../database/prismaClient';

async function main() {
  const command = process.argv[2];
  
  if (!command) {
    console.log(`
Usage: tsx migrate.ts <command>

Commands:
  accounts              - Migrate all accounts from CosmosDB to PostgreSQL
  notifications         - Migrate all notification subscriptions
  payments              - Migrate all payments
  settings              - Migrate all notification settings
  user <pubkey>         - Migrate specific user's data (accounts + backup jobs)
  verify <pubkey>       - Verify migration consistency for a specific user
  stats                 - Show migration statistics for all data types
  full                  - Perform full migration of all data types with verification
  dry-run               - Perform a dry run migration (no actual changes)

Environment setup required:
  MIGRATION_MODE=true
  DATABASE_URL=postgresql://...
  AZURE_COSMOSDB_CONNECTION_STRING=...
`);
    process.exit(1);
  }

  try {
    // Initialize PostgreSQL connection
    await PrismaClientSingleton.connect();
    logger.info('Database connections initialized');

    switch (command) {
      case 'accounts':
        await migrateAccounts();
        break;
      
      case 'notifications':
        await migrateNotifications();
        break;
      
      case 'payments':
        await migratePayments();
        break;
      
      case 'settings':
        await migrateSettings();
        break;
      
      case 'user':
        const pubkey = process.argv[3];
        if (!pubkey) {
          console.error('Usage: tsx migrate.ts user <pubkey>');
          process.exit(1);
        }
        await migrateUser(pubkey);
        break;
      
      case 'verify':
        const verifyPubkey = process.argv[3];
        if (!verifyPubkey) {
          console.error('Usage: tsx migrate.ts verify <pubkey>');
          process.exit(1);
        }
        await verifyUser(verifyPubkey);
        break;
      
      case 'stats':
        await showStats();
        break;
      
      case 'full':
        await fullMigration();
        break;
      
      case 'dry-run':
        await dryRunMigration();
        break;
      
      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }

    logger.info('Migration script completed successfully');
  } catch (error) {
    logger.error('Migration script failed:', error);
    process.exit(1);
  } finally {
    await PrismaClientSingleton.disconnect();
  }
}

async function migrateAccounts() {
  logger.info('Starting account migration...');
  const progress = await DataMigrationUtility.migrateAccounts({
    batchSize: 50,
    skipExisting: true
  });
  
  console.log('\n=== Account Migration Results ===');
  console.log(`Total accounts: ${progress.total}`);
  console.log(`Successfully migrated: ${progress.migrated}`);
  console.log(`Failed: ${progress.failed}`);
  
  if (progress.errors.length > 0) {
    console.log('\nErrors:');
    progress.errors.forEach((error, index) => {
      console.log(`${index + 1}. ${error}`);
    });
  }
}

async function migrateNotifications() {
  logger.info('Starting notification subscription migration...');
  const progress = await DataMigrationUtility.migrateNotificationSubscriptions({
    batchSize: 50,
    skipExisting: true
  });
  
  console.log('\n=== Notification Subscription Migration Results ===');
  console.log(`Total subscriptions: ${progress.total}`);
  console.log(`Successfully migrated: ${progress.migrated}`);
  console.log(`Failed: ${progress.failed}`);
  
  if (progress.errors.length > 0) {
    console.log('\nErrors:');
    progress.errors.forEach((error, index) => {
      console.log(`${index + 1}. ${error}`);
    });
  }
}

async function migratePayments() {
  logger.info('Starting payment migration...');
  const progress = await DataMigrationUtility.migratePayments({
    batchSize: 50,
    skipExisting: true
  });
  
  console.log('\n=== Payment Migration Results ===');
  console.log(`Total payments: ${progress.total}`);
  console.log(`Successfully migrated: ${progress.migrated}`);
  console.log(`Failed: ${progress.failed}`);
  
  if (progress.errors.length > 0) {
    console.log('\nErrors:');
    progress.errors.forEach((error, index) => {
      console.log(`${index + 1}. ${error}`);
    });
  }
}

async function migrateSettings() {
  logger.info('Starting notification settings migration...');
  const progress = await DataMigrationUtility.migrateNotificationSettings({
    batchSize: 50,
    skipExisting: true
  });
  
  console.log('\n=== Notification Settings Migration Results ===');
  console.log(`Total settings: ${progress.total}`);
  console.log(`Successfully migrated: ${progress.migrated}`);
  console.log(`Failed: ${progress.failed}`);
  
  if (progress.errors.length > 0) {
    console.log('\nErrors:');
    progress.errors.forEach((error, index) => {
      console.log(`${index + 1}. ${error}`);
    });
  }
}

async function migrateUser(pubkey: string) {
  logger.info(`Starting migration for user: ${pubkey}`);
  
  // First migrate the account
  try {
    await DataMigrationUtility.migrateAccounts({
      batchSize: 1,
      skipExisting: true
    });
    logger.info(`Account migration completed for ${pubkey}`);
  } catch (error) {
    logger.error(`Account migration failed for ${pubkey}:`, error);
  }
  
  // Then migrate backup jobs
  try {
    const progress = await DataMigrationUtility.migrateUserBackupJobs(pubkey, {
      skipExisting: true
    });
    
    console.log(`\n=== Migration Results for ${pubkey} ===`);
    console.log(`Backup jobs migrated: ${progress.migrated}/${progress.total}`);
    console.log(`Failed: ${progress.failed}`);
    
    if (progress.errors.length > 0) {
      console.log('\nErrors:');
      progress.errors.forEach((error, index) => {
        console.log(`${index + 1}. ${error}`);
      });
    }
  } catch (error) {
    logger.error(`Backup job migration failed for ${pubkey}:`, error);
  }
}

async function verifyUser(pubkey: string) {
  logger.info(`Verifying migration for user: ${pubkey}`);
  
  const isConsistent = await DataMigrationUtility.verifyAccountMigration(pubkey);
  
  console.log(`\n=== Verification Results for ${pubkey} ===`);
  console.log(`Data consistency: ${isConsistent ? 'PASS' : 'FAIL'}`);
}

async function showStats() {
  logger.info('Fetching migration statistics...');
  
  const stats = await DataMigrationUtility.getMigrationStats();
  
  console.log('\n=== Migration Statistics ===');
  console.log('CosmosDB:');
  console.log(`  Accounts: ${stats.cosmos.accounts}`);
  console.log(`  Backup Jobs: ${stats.cosmos.backupJobs}`);
  console.log(`  Notification Subscriptions: ${stats.cosmos.notificationSubscriptions}`);
  console.log(`  Payments: ${stats.cosmos.payments}`);
  console.log(`  Notification Settings: ${stats.cosmos.notificationSettings}`);
  console.log('PostgreSQL:');
  console.log(`  Accounts: ${stats.postgres.accounts}`);
  console.log(`  Backup Jobs: ${stats.postgres.backupJobs}`);
  console.log(`  Notification Subscriptions: ${stats.postgres.notificationSubscriptions}`);
  console.log(`  Payments: ${stats.postgres.payments}`);
  console.log(`  Notification Settings: ${stats.postgres.notificationSettings}`);
  
  const accountProgress = stats.postgres.accounts / Math.max(stats.cosmos.accounts, 1) * 100;
  const backupJobProgress = stats.postgres.backupJobs / Math.max(stats.cosmos.backupJobs, 1) * 100;
  const notificationProgress = stats.postgres.notificationSubscriptions / Math.max(stats.cosmos.notificationSubscriptions, 1) * 100;
  const paymentProgress = stats.postgres.payments / Math.max(stats.cosmos.payments, 1) * 100;
  const settingsProgress = stats.postgres.notificationSettings / Math.max(stats.cosmos.notificationSettings, 1) * 100;
  
  console.log('\nMigration Progress:');
  console.log(`  Accounts: ${accountProgress.toFixed(1)}%`);
  console.log(`  Backup Jobs: ${backupJobProgress.toFixed(1)}%`);
  console.log(`  Notification Subscriptions: ${notificationProgress.toFixed(1)}%`);
  console.log(`  Payments: ${paymentProgress.toFixed(1)}%`);
  console.log(`  Notification Settings: ${settingsProgress.toFixed(1)}%`);
}

async function fullMigration() {
  logger.info('Starting full migration with verification...');
  
  const result = await DataMigrationUtility.performFullMigration({
    batchSize: 50,
    skipExisting: true
  });
  
  console.log('\n=== Full Migration Results ===');
  console.log(`Accounts migrated: ${result.accounts.migrated}/${result.accounts.total} (failed: ${result.accounts.failed})`);
  console.log(`Backup Jobs migrated: ${result.backupJobs.migrated}/${result.backupJobs.total} (failed: ${result.backupJobs.failed})`);
  console.log(`Notification Subscriptions migrated: ${result.notificationSubscriptions.migrated}/${result.notificationSubscriptions.total} (failed: ${result.notificationSubscriptions.failed})`);
  console.log(`Payments migrated: ${result.payments.migrated}/${result.payments.total} (failed: ${result.payments.failed})`);
  console.log(`Notification Settings migrated: ${result.notificationSettings.migrated}/${result.notificationSettings.total} (failed: ${result.notificationSettings.failed})`);
  console.log(`Verification: ${result.validation.verified} passed, ${result.validation.failed} failed`);
  
  // Show errors from all data types
  const allErrors = [
    ...result.accounts.errors,
    ...result.backupJobs.errors,
    ...result.notificationSubscriptions.errors,
    ...result.payments.errors,
    ...result.notificationSettings.errors
  ];
  
  if (allErrors.length > 0) {
    console.log('\nErrors:');
    allErrors.slice(0, 10).forEach((error, index) => {
      console.log(`${index + 1}. ${error}`);
    });
    
    if (allErrors.length > 10) {
      console.log(`... and ${allErrors.length - 10} more errors`);
    }
  }
}

async function dryRunMigration() {
  logger.info('Starting dry run migration (no changes will be made)...');
  
  const result = await DataMigrationUtility.performFullMigration({
    batchSize: 10,
    skipExisting: true,
    dryRun: true
  });
  
  console.log('\n=== Dry Run Results ===');
  console.log(`Would migrate ${result.accounts.migrated}/${result.accounts.total} accounts (${result.accounts.failed} would fail)`);
  console.log(`Would migrate ${result.backupJobs.migrated}/${result.backupJobs.total} backup jobs (${result.backupJobs.failed} would fail)`);
  console.log(`Would migrate ${result.notificationSubscriptions.migrated}/${result.notificationSubscriptions.total} notification subscriptions (${result.notificationSubscriptions.failed} would fail)`);
  console.log(`Would migrate ${result.payments.migrated}/${result.payments.total} payments (${result.payments.failed} would fail)`);
  console.log(`Would migrate ${result.notificationSettings.migrated}/${result.notificationSettings.total} notification settings (${result.notificationSettings.failed} would fail)`);
  
  // Show errors from all data types
  const allErrors = [
    ...result.accounts.errors,
    ...result.backupJobs.errors,
    ...result.notificationSubscriptions.errors,
    ...result.payments.errors,
    ...result.notificationSettings.errors
  ];
  
  if (allErrors.length > 0) {
    console.log('\nPotential errors:');
    allErrors.slice(0, 5).forEach((error, index) => {
      console.log(`${index + 1}. ${error}`);
    });
    
    if (allErrors.length > 5) {
      console.log(`... and ${allErrors.length - 5} more potential errors`);
    }
  }
}

// Run the script
main().catch((error) => {
  console.error('Migration script error:', error);
  process.exit(1);
});