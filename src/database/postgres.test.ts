import { beforeAll, afterAll, describe, test, expect, beforeEach } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import PrismaAccountRepository from '../database/PrismaAccountRepository';
import PrismaBackupJobRepository from '../database/PrismaBackupJobRepository';
import { Account } from '../models/account';
import { BackupJob, BackupJobStatus, BackupType } from '../models/backupJob';
import { DEFAULT_SUBSCRIPTION } from '../models/accountSubscription';
import { now } from '../helpers/now';

describe('PostgreSQL Repositories', () => {
  let prisma: PrismaClient;
  let accountRepo: PrismaAccountRepository;
  let backupJobRepo: PrismaBackupJobRepository;

  const testAccount: Account = {
    id: 'test-pubkey-123',
    type: 'account',
    pubkey: 'test-pubkey-123',
    username: 'testuser',
    tier: 'free',
    subscription: DEFAULT_SUBSCRIPTION,
    created: now(),
    modified: now(),
  };

  const testBackupJob: BackupJob = {
    id: 'test-backup-job-123',
    type: 'backup-job',
    pubkey: 'test-pubkey-123',
    status: BackupJobStatus.PENDING,
    backupType: BackupType.FULL,
    requested: now(),
  };

  beforeAll(async () => {
    // Use test database URL
    const testDatabaseUrl = process.env.TEST_DATABASE_URL || 'postgresql://postgres:password@localhost:5432/nostria_test';
    
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: testDatabaseUrl,
        },
      },
    });

    await prisma.$connect();

    // Create repositories
    accountRepo = new PrismaAccountRepository();
    backupJobRepo = new PrismaBackupJobRepository();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up test data before each test
    await prisma.backupJob.deleteMany({
      where: { pubkey: testAccount.pubkey },
    });
    await prisma.account.deleteMany({
      where: { pubkey: testAccount.pubkey },
    });
  });

  describe('PrismaAccountRepository', () => {
    test('should create an account', async () => {
      const createdAccount = await accountRepo.create(testAccount);

      expect(createdAccount).toBeDefined();
      expect(createdAccount.pubkey).toBe(testAccount.pubkey);
      expect(createdAccount.username).toBe(testAccount.username);
      expect(createdAccount.tier).toBe(testAccount.tier);
      expect(createdAccount.type).toBe('account');
    });

    test('should get account by pubkey', async () => {
      await accountRepo.create(testAccount);
      const retrievedAccount = await accountRepo.getByPubkey(testAccount.pubkey);

      expect(retrievedAccount).toBeDefined();
      expect(retrievedAccount?.pubkey).toBe(testAccount.pubkey);
      expect(retrievedAccount?.username).toBe(testAccount.username);
    });

    test('should get account by username', async () => {
      await accountRepo.create(testAccount);
      const retrievedAccount = await accountRepo.getByUsername(testAccount.username!);

      expect(retrievedAccount).toBeDefined();
      expect(retrievedAccount?.pubkey).toBe(testAccount.pubkey);
      expect(retrievedAccount?.username).toBe(testAccount.username);
    });

    test('should check if username is taken', async () => {
      await accountRepo.create(testAccount);
      
      const isTaken = await accountRepo.isUsernameTaken(testAccount.username!);
      expect(isTaken).toBe(true);

      const isNotTaken = await accountRepo.isUsernameTaken('nonexistentuser');
      expect(isNotTaken).toBe(false);
    });

    test('should update an account', async () => {
      await accountRepo.create(testAccount);
      
      const updatedAccount = {
        ...testAccount,
        username: 'updateduser',
        tier: 'premium' as const,
      };

      const result = await accountRepo.update(updatedAccount);
      expect(result.username).toBe('updateduser');
      expect(result.tier).toBe('premium');
    });

    test('should update login date', async () => {
      await accountRepo.create(testAccount);
      
      await accountRepo.updateLoginDate(testAccount.pubkey);
      
      const retrievedAccount = await accountRepo.getByPubkey(testAccount.pubkey);
      expect(retrievedAccount?.lastLoginDate).toBeDefined();
      expect(retrievedAccount?.lastLoginDate).toBeGreaterThan(testAccount.created);
    });

    test('should delete an account', async () => {
      await accountRepo.create(testAccount);
      
      await accountRepo.deleteAccount(testAccount.pubkey);
      
      const retrievedAccount = await accountRepo.getByPubkey(testAccount.pubkey);
      expect(retrievedAccount).toBeNull();
    });

    test('should check premium subscription status', async () => {
      // Test free account
      await accountRepo.create(testAccount);
      let hasPremium = await accountRepo.hasPremiumSubscription(testAccount.pubkey);
      expect(hasPremium).toBe(false);

      // Test premium account
      const premiumAccount = {
        ...testAccount,
        tier: 'premium' as const,
        expires: now() + 86400000, // 1 day from now
      };
      await accountRepo.update(premiumAccount);
      
      hasPremium = await accountRepo.hasPremiumSubscription(testAccount.pubkey);
      expect(hasPremium).toBe(true);

      // Test expired premium account
      const expiredPremiumAccount = {
        ...testAccount,
        tier: 'premium' as const,
        expires: now() - 86400000, // 1 day ago
      };
      await accountRepo.update(expiredPremiumAccount);
      
      hasPremium = await accountRepo.hasPremiumSubscription(testAccount.pubkey);
      expect(hasPremium).toBe(false);
    });
  });

  describe('PrismaBackupJobRepository', () => {
    beforeEach(async () => {
      // Create account first for foreign key constraint
      await accountRepo.create(testAccount);
    });

    test('should create a backup job', async () => {
      const createdJob = await backupJobRepo.createBackupJob(testBackupJob);

      expect(createdJob).toBeDefined();
      expect(createdJob.id).toBe(testBackupJob.id);
      expect(createdJob.pubkey).toBe(testBackupJob.pubkey);
      expect(createdJob.status).toBe(BackupJobStatus.PENDING);
      expect(createdJob.type).toBe('backup-job');
    });

    test('should get backup job by id', async () => {
      await backupJobRepo.createBackupJob(testBackupJob);
      const retrievedJob = await backupJobRepo.getBackupJob(testBackupJob.id, testBackupJob.pubkey);

      expect(retrievedJob).toBeDefined();
      expect(retrievedJob?.id).toBe(testBackupJob.id);
      expect(retrievedJob?.pubkey).toBe(testBackupJob.pubkey);
    });

    test('should get user backup jobs', async () => {
      await backupJobRepo.createBackupJob(testBackupJob);
      
      const userJobs = await backupJobRepo.getUserBackupJobs(testBackupJob.pubkey);
      expect(userJobs).toHaveLength(1);
      expect(userJobs[0].id).toBe(testBackupJob.id);
    });

    test('should update a backup job', async () => {
      await backupJobRepo.createBackupJob(testBackupJob);
      
      const updatedJob = {
        ...testBackupJob,
        status: BackupJobStatus.COMPLETED,
        completed: now(),
        resultUrl: 'https://example.com/backup.zip',
      };

      const result = await backupJobRepo.updateBackupJobStatus(
        testBackupJob.id!,
        testBackupJob.pubkey,
        BackupJobStatus.COMPLETED,
        {
          completed: updatedJob.completed,
          resultUrl: updatedJob.resultUrl
        }
      );
      expect(result.status).toBe(BackupJobStatus.COMPLETED);
      expect(result.completed).toBeDefined();
      expect(result.resultUrl).toBe('https://example.com/backup.zip');
    });

    test('should delete a backup job', async () => {
      await backupJobRepo.createBackupJob(testBackupJob);
      
      await backupJobRepo.deleteBackupJob(testBackupJob.id, testBackupJob.pubkey);
      
      const retrievedJob = await backupJobRepo.getBackupJob(testBackupJob.id, testBackupJob.pubkey);
      expect(retrievedJob).toBeNull();
    });

    test('should get pending backup jobs', async () => {
      await backupJobRepo.createBackupJob(testBackupJob);
      
      const pendingJobs = await backupJobRepo.getPendingBackupJobs();
      expect(pendingJobs.length).toBeGreaterThan(0);
      expect(pendingJobs.some(job => job.id === testBackupJob.id)).toBe(true);
    });
  });
});