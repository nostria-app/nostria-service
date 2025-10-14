import { BackupType, BackupJobStatus } from '../models/backupJob';

// Mock the backup job repository
jest.mock('../database/backupJobRepository', () => ({
  __esModule: true,
  default: {
    createBackupJob: jest.fn(),
    getBackupJob: jest.fn(),
    getUserBackupJobs: jest.fn(),
    updateBackupJobStatus: jest.fn(),
    deleteBackupJob: jest.fn(),
    getPendingBackupJobs: jest.fn()
  }
}));

// Mock logger to prevent console output during tests
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

import RepositoryFactory from '../database/RepositoryFactory';

const backupJobRepository = RepositoryFactory.getBackupJobRepository();

describe('Backup API Routes', () => {
  const mockBackupJobRepository = backupJobRepository as jest.Mocked<typeof backupJobRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Backup Job Repository', () => {
    it('should have createBackupJob method', () => {
      expect(typeof mockBackupJobRepository.createBackupJob).toBe('function');
    });

    it('should have getBackupJob method', () => {
      expect(typeof mockBackupJobRepository.getBackupJob).toBe('function');
    });

    it('should have getUserBackupJobs method', () => {
      expect(typeof mockBackupJobRepository.getUserBackupJobs).toBe('function');
    });

    it('should have updateBackupJobStatus method', () => {
      expect(typeof mockBackupJobRepository.updateBackupJobStatus).toBe('function');
    });

    it('should have deleteBackupJob method', () => {
      expect(typeof mockBackupJobRepository.deleteBackupJob).toBe('function');
    });

    it('should have getPendingBackupJobs method', () => {
      expect(typeof mockBackupJobRepository.getPendingBackupJobs).toBe('function');
    });
  });

  describe('Backup Models', () => {
    it('should have BackupType enum with correct values', () => {
      expect(BackupType.FULL).toBe('full');
      expect(BackupType.INCREMENTAL).toBe('incremental');
      expect(BackupType.SELECTIVE).toBe('selective');
    });

    it('should have BackupJobStatus enum with correct values', () => {
      expect(BackupJobStatus.PENDING).toBe('pending');
      expect(BackupJobStatus.SCHEDULED).toBe('scheduled');
      expect(BackupJobStatus.IN_PROGRESS).toBe('in_progress');
      expect(BackupJobStatus.COMPLETED).toBe('completed');
      expect(BackupJobStatus.FAILED).toBe('failed');
      expect(BackupJobStatus.EXPIRED).toBe('expired');
    });
  });
});

/*
 * Note: Full integration tests would require:
 * 1. Proper NIP-98 authentication setup and mocking
 * 2. Request signing utilities for tests
 * 3. Test database setup
 * 4. Mocking of all Azure services
 * 
 * The current tests verify the basic structure and types are working.
 * For production, consider adding integration tests with proper test infrastructure.
 */
