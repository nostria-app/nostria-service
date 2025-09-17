import { databaseFeatures } from '../config/features';
import accountRepository from './accountRepository';
import backupJobRepository from './backupJobRepository';
import PrismaAccountRepository from './PrismaAccountRepository';
import PrismaBackupJobRepository from './PrismaBackupJobRepository';

// Import other repositories as they're created
// import notificationLogRepository from './notificationLogRepository';
// import PrismaNotificationLogRepository from './PrismaNotificationLogRepository';

export interface IAccountRepository {
  create(account: any): Promise<any>;
  isUsernameTaken(username: string, excludePubkey?: string): Promise<boolean>;
  getByPubkey(pubkey: string): Promise<any | null>;
  getByUsername(username: string): Promise<any | null>;
  update(account: any): Promise<any>;
  updateLoginDate(pubkey: string): Promise<void>;
  getAllAccounts(limit?: number): Promise<any[]>;
  deleteAccount(pubkey: string): Promise<void>;
  hasPremiumSubscription(pubkey: string): Promise<boolean>;
}

export interface IBackupJobRepository {
  createBackupJob(backupJob: any): Promise<any>;
  getBackupJob(id: string, pubkey: string): Promise<any | null>;
  getUserBackupJobs(pubkey: string, limit?: number): Promise<any[]>;
  updateBackupJobStatus(id: string, pubkey: string, status: any, updates?: any): Promise<any>;
  deleteBackupJob(id: string, pubkey: string): Promise<void>;
  getPendingBackupJobs(limit?: number): Promise<any[]>;
}

class RepositoryFactory {
  private static prismaAccountRepository?: PrismaAccountRepository;
  private static prismaBackupJobRepository?: PrismaBackupJobRepository;

  static getAccountRepository(): IAccountRepository {
    if (databaseFeatures.USE_POSTGRESQL) {
      if (!this.prismaAccountRepository) {
        this.prismaAccountRepository = new PrismaAccountRepository();
      }
      return this.prismaAccountRepository;
    } else {
      // Return the existing singleton instance
      return accountRepository;
    }
  }

  static getBackupJobRepository(): IBackupJobRepository {
    if (databaseFeatures.USE_POSTGRESQL) {
      if (!this.prismaBackupJobRepository) {
        this.prismaBackupJobRepository = new PrismaBackupJobRepository();
      }
      return this.prismaBackupJobRepository;
    } else {
      // Return the existing singleton instance
      return backupJobRepository;
    }
  }

  // Dual database mode support for gradual migration
  static async migrateAccountFromCosmosToPostgres(pubkey: string): Promise<void> {
    if (!databaseFeatures.MIGRATION_MODE) {
      throw new Error('Migration mode is not enabled');
    }

    const cosmosRepo = accountRepository;
    const postgresRepo = new PrismaAccountRepository();

    const account = await cosmosRepo.getByPubkey(pubkey);
    if (account) {
      try {
        await postgresRepo.create(account);
      } catch (error) {
        // Account might already exist, try update
        await postgresRepo.update(account);
      }
    }
  }

  static async migrateBackupJobFromCosmosToPostgres(id: string, pubkey: string): Promise<void> {
    if (!databaseFeatures.MIGRATION_MODE) {
      throw new Error('Migration mode is not enabled');
    }

    const cosmosRepo = backupJobRepository;
    const postgresRepo = new PrismaBackupJobRepository();

    const backupJob = await cosmosRepo.getBackupJob(id, pubkey);
    if (backupJob) {
      try {
        await postgresRepo.createBackupJob(backupJob);
      } catch (error) {
        // Backup job might already exist, try update with status
        await postgresRepo.updateBackupJobStatus(id, pubkey, backupJob.status, backupJob);
      }
    }
  }

  // Health check methods
  static async checkCosmosHealth(): Promise<boolean> {
    try {
      // Try a simple query to check if CosmosDB is accessible
      await accountRepository.getAllAccounts(1);
      return true;
    } catch (error) {
      return false;
    }
  }

  static async checkPostgresHealth(): Promise<boolean> {
    try {
      const { prisma } = await import('./prismaClient');
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      return false;
    }
  }
}

export default RepositoryFactory;