import PrismaAccountRepository from './PrismaAccountRepository';
import PrismaBackupJobRepository from './PrismaBackupJobRepository';
import PrismaPaymentRepository from './PrismaPaymentRepository';
import PrismaUserSettingsRepository from './PrismaUserSettingsRepository';
import PrismaNotificationSubscriptionRepository from './PrismaNotificationSubscriptionRepository';
import PrismaNotificationSettingsRepository from './PrismaNotificationSettingsRepository';

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

export interface IPaymentRepository {
  create(payment: any): Promise<any>;
  update(payment: any): Promise<any>;
  get(id: string, pubkey: string): Promise<any | null>;
  getAllPayments(limit?: number): Promise<any[]>;
  getPaymentsByPubkey(pubkey: string, limit?: number): Promise<any[]>;
}

export interface IUserSettingsRepository {
  upsertUserSettings(pubkey: string, settingsData: any): Promise<any>;
  getUserSettings(pubkey: string): Promise<any | null>;
  updateUserSettings(pubkey: string, updates: any): Promise<any>;
  deleteUserSettings(pubkey: string): Promise<void>;
  getUsersByReleaseChannel(channel: 'stable' | 'beta' | 'alpha'): Promise<string[]>;
  getDefaultSettings(): any;
}

export interface INotificationSubscriptionRepository {
  createSubscription(pubkey: string, subscription: any): Promise<any>;
  getSubscriptionByDeviceKey(pubkey: string, deviceKey: string): Promise<any | null>;
  deleteSubscription(pubkey: string, deviceKey: string): Promise<void>;
  getAllSubscriptions(limit?: number): Promise<any[]>;
  getSubscriptionsByPubkey(pubkey: string): Promise<any[]>;
}

export interface INotificationSettingsRepository {
  upsertSettings(pubkey: string, settingsData: any): Promise<any>;
  getSettings(pubkey: string): Promise<any | null>;
  deleteSettings(pubkey: string): Promise<void>;
  getAllSettings(limit?: number): Promise<any[]>;
}

class RepositoryFactory {
  private static prismaAccountRepository?: PrismaAccountRepository;
  private static prismaBackupJobRepository?: PrismaBackupJobRepository;
  private static prismaPaymentRepository?: PrismaPaymentRepository;
  private static prismaUserSettingsRepository?: PrismaUserSettingsRepository;
  private static prismaNotificationSubscriptionRepository?: PrismaNotificationSubscriptionRepository;
  private static prismaNotificationSettingsRepository?: PrismaNotificationSettingsRepository;

  static getAccountRepository(): IAccountRepository {
    if (!this.prismaAccountRepository) {
      this.prismaAccountRepository = new PrismaAccountRepository();
    }
    return this.prismaAccountRepository;
  }

  static getBackupJobRepository(): IBackupJobRepository {
    if (!this.prismaBackupJobRepository) {
      this.prismaBackupJobRepository = new PrismaBackupJobRepository();
    }
    return this.prismaBackupJobRepository;
  }

  static getPaymentRepository(): IPaymentRepository {
    if (!this.prismaPaymentRepository) {
      this.prismaPaymentRepository = new PrismaPaymentRepository();
    }
    return this.prismaPaymentRepository;
  }

  static getUserSettingsRepository(): IUserSettingsRepository {
    if (!this.prismaUserSettingsRepository) {
      this.prismaUserSettingsRepository = new PrismaUserSettingsRepository();
    }
    return this.prismaUserSettingsRepository;
  }

  static getNotificationSubscriptionRepository(): INotificationSubscriptionRepository {
    if (!this.prismaNotificationSubscriptionRepository) {
      this.prismaNotificationSubscriptionRepository = new PrismaNotificationSubscriptionRepository();
    }
    return this.prismaNotificationSubscriptionRepository;
  }

  static getNotificationSettingsRepository(): INotificationSettingsRepository {
    if (!this.prismaNotificationSettingsRepository) {
      this.prismaNotificationSettingsRepository = new PrismaNotificationSettingsRepository();
    }
    return this.prismaNotificationSettingsRepository;
  }

  // Health check method
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