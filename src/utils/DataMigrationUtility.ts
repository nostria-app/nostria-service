import logger from '../utils/logger';
import { databaseFeatures } from '../config/features';
import RepositoryFactory from '../database/RepositoryFactory';
import accountRepository from '../database/accountRepository';
import backupJobRepository from '../database/backupJobRepository';
import PrismaAccountRepository from '../database/PrismaAccountRepository';
import PrismaBackupJobRepository from '../database/PrismaBackupJobRepository';

export interface MigrationProgress {
  total: number;
  migrated: number;
  failed: number;
  errors: string[];
}

export interface MigrationOptions {
  batchSize?: number;
  skipExisting?: boolean;
  dryRun?: boolean;
}

export class DataMigrationUtility {
  private static readonly DEFAULT_BATCH_SIZE = 100;

  /**
   * Migrate all accounts from CosmosDB to PostgreSQL
   */
  static async migrateAccounts(options: MigrationOptions = {}): Promise<MigrationProgress> {
    const { batchSize = this.DEFAULT_BATCH_SIZE, skipExisting = true, dryRun = false } = options;
    
    if (!databaseFeatures.MIGRATION_MODE && !dryRun) {
      throw new Error('Migration mode is not enabled. Set MIGRATION_MODE=true to proceed.');
    }

    logger.info('Starting account migration from CosmosDB to PostgreSQL', { 
      batchSize, 
      skipExisting, 
      dryRun 
    });

    const cosmosRepo = accountRepository;
    const postgresRepo = new PrismaAccountRepository();
    
    const progress: MigrationProgress = {
      total: 0,
      migrated: 0,
      failed: 0,
      errors: []
    };

    try {
      // Get all accounts from CosmosDB in batches
      let offset = 0;
      let hasMoreData = true;

      while (hasMoreData) {
        const accounts = await cosmosRepo.getAllAccounts(batchSize);
        
        if (accounts.length === 0) {
          hasMoreData = false;
          break;
        }

        progress.total += accounts.length;

        for (const account of accounts) {
          try {
            if (!dryRun) {
              if (skipExisting) {
                // Check if account already exists in PostgreSQL
                const existingAccount = await postgresRepo.getByPubkey(account.pubkey);
                if (existingAccount) {
                  logger.debug(`Account ${account.pubkey} already exists, skipping`);
                  progress.migrated++;
                  continue;
                }
              }

              // Migrate the account
              await postgresRepo.create(account);
            }
            
            progress.migrated++;
            logger.debug(`${dryRun ? '[DRY RUN] ' : ''}Migrated account: ${account.pubkey}`);
          } catch (error) {
            progress.failed++;
            const errorMessage = `Failed to migrate account ${account.pubkey}: ${(error as Error).message}`;
            progress.errors.push(errorMessage);
            logger.error(errorMessage, error);
          }
        }

        offset += batchSize;
        
        // Log progress
        logger.info(`Account migration progress: ${progress.migrated}/${progress.total} migrated, ${progress.failed} failed`);

        // Break if we got fewer accounts than requested (last batch)
        if (accounts.length < batchSize) {
          hasMoreData = false;
        }
      }

      logger.info(`Account migration completed: ${progress.migrated}/${progress.total} migrated, ${progress.failed} failed`);
      return progress;
    } catch (error) {
      logger.error('Account migration failed:', error);
      throw error;
    }
  }

  /**
   * Migrate backup jobs for a specific user from CosmosDB to PostgreSQL
   */
  static async migrateUserBackupJobs(pubkey: string, options: MigrationOptions = {}): Promise<MigrationProgress> {
    const { skipExisting = true, dryRun = false } = options;
    
    if (!databaseFeatures.MIGRATION_MODE && !dryRun) {
      throw new Error('Migration mode is not enabled. Set MIGRATION_MODE=true to proceed.');
    }

    logger.info(`Starting backup job migration for user ${pubkey}`, { 
      skipExisting, 
      dryRun 
    });

    const cosmosRepo = backupJobRepository;
    const postgresRepo = new PrismaBackupJobRepository();
    
    const progress: MigrationProgress = {
      total: 0,
      migrated: 0,
      failed: 0,
      errors: []
    };

    try {
      // Get all backup jobs for the user from CosmosDB
      const backupJobs = await cosmosRepo.getUserBackupJobs(pubkey, 1000); // Get up to 1000 jobs
      progress.total = backupJobs.length;

      for (const backupJob of backupJobs) {
        try {
          if (!dryRun) {
            if (skipExisting) {
              // Check if backup job already exists in PostgreSQL
              const existingJob = await postgresRepo.getBackupJob(backupJob.id, backupJob.pubkey);
              if (existingJob) {
                logger.debug(`Backup job ${backupJob.id} already exists, skipping`);
                progress.migrated++;
                continue;
              }
            }

            // Migrate the backup job
            await postgresRepo.createBackupJob(backupJob);
          }
          
          progress.migrated++;
          logger.debug(`${dryRun ? '[DRY RUN] ' : ''}Migrated backup job: ${backupJob.id}`);
        } catch (error) {
          progress.failed++;
          const errorMessage = `Failed to migrate backup job ${backupJob.id}: ${(error as Error).message}`;
          progress.errors.push(errorMessage);
          logger.error(errorMessage, error);
        }
      }

      logger.info(`Backup job migration for ${pubkey} completed: ${progress.migrated}/${progress.total} migrated, ${progress.failed} failed`);
      return progress;
    } catch (error) {
      logger.error(`Backup job migration for ${pubkey} failed:`, error);
      throw error;
    }
  }

  /**
   * Verify data consistency between CosmosDB and PostgreSQL
   */
  static async verifyAccountMigration(pubkey: string): Promise<boolean> {
    try {
      const cosmosRepo = accountRepository;
      const postgresRepo = new PrismaAccountRepository();

      const cosmosAccount = await cosmosRepo.getByPubkey(pubkey);
      const postgresAccount = await postgresRepo.getByPubkey(pubkey);

      if (!cosmosAccount && !postgresAccount) {
        return true; // Both don't exist, consistent
      }

      if (!cosmosAccount || !postgresAccount) {
        logger.warn(`Account ${pubkey} exists in one database but not the other`);
        return false;
      }

      // Compare key fields (ignore timestamps and type field)
      const fieldsToCompare = ['pubkey', 'username', 'tier'];
      for (const field of fieldsToCompare) {
        if (cosmosAccount[field as keyof typeof cosmosAccount] !== postgresAccount[field as keyof typeof postgresAccount]) {
          logger.warn(`Account ${pubkey} field ${field} mismatch:`, {
            cosmos: cosmosAccount[field as keyof typeof cosmosAccount],
            postgres: postgresAccount[field as keyof typeof postgresAccount]
          });
          return false;
        }
      }

      return true;
    } catch (error) {
      logger.error(`Failed to verify account migration for ${pubkey}:`, error);
      return false;
    }
  }

  /**
   * Get migration statistics
   */
  static async getMigrationStats(): Promise<{
    cosmos: { accounts: number; backupJobs: number };
    postgres: { accounts: number; backupJobs: number };
  }> {
    try {
      const cosmosAccountRepo = accountRepository;
      const cosmosBackupRepo = backupJobRepository;
      const postgresAccountRepo = new PrismaAccountRepository();
      const postgresBackupRepo = new PrismaBackupJobRepository();

      const [
        cosmosAccounts,
        cosmosBackupJobs,
        postgresAccounts,
        postgresBackupJobs
      ] = await Promise.all([
        cosmosAccountRepo.getAllAccounts(10000), // Large number to get all
        cosmosBackupRepo.getPendingBackupJobs(10000), // This is a proxy for total count
        postgresAccountRepo.getAllAccounts(10000),
        postgresBackupRepo.getPendingBackupJobs(10000)
      ]);

      return {
        cosmos: {
          accounts: cosmosAccounts.length,
          backupJobs: cosmosBackupJobs.length
        },
        postgres: {
          accounts: postgresAccounts.length,
          backupJobs: postgresBackupJobs.length
        }
      };
    } catch (error) {
      logger.error('Failed to get migration stats:', error);
      throw error;
    }
  }

  /**
   * Complete migration process with validation
   */
  static async performFullMigration(options: MigrationOptions = {}): Promise<{
    accounts: MigrationProgress;
    validation: { verified: number; failed: number };
  }> {
    const { dryRun = false } = options;

    logger.info(`Starting full migration${dryRun ? ' (DRY RUN)' : ''}`);

    // Migrate accounts
    const accountProgress = await this.migrateAccounts(options);

    // Verify a sample of migrated accounts
    const sampleSize = Math.min(10, accountProgress.migrated);
    const cosmosRepo = accountRepository;
    const allAccounts = await cosmosRepo.getAllAccounts(sampleSize);
    
    let verified = 0;
    let failed = 0;

    for (const account of allAccounts.slice(0, sampleSize)) {
      const isConsistent = await this.verifyAccountMigration(account.pubkey);
      if (isConsistent) {
        verified++;
      } else {
        failed++;
      }
    }

    logger.info(`Migration completed. Verification: ${verified}/${sampleSize} accounts verified`);

    return {
      accounts: accountProgress,
      validation: { verified, failed }
    };
  }
}

export default DataMigrationUtility;