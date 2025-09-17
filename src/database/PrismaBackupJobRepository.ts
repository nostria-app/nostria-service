import { BackupJob } from "../models/backupJob";
import { PrismaBaseRepository } from "./PrismaBaseRepository";
import logger from "../utils/logger";
import { now } from "../helpers/now";

class PrismaBackupJobRepository extends PrismaBaseRepository {
  constructor() {
    super('backup-job');
  }

  private transformPrismaBackupJobToBackupJob(prismaBackupJob: any): BackupJob {
    return {
      id: prismaBackupJob.id,
      type: 'backup-job',
      pubkey: prismaBackupJob.pubkey,
      status: prismaBackupJob.status,
      backupType: prismaBackupJob.backupType,
      requested: Number(prismaBackupJob.requested),
      scheduled: prismaBackupJob.scheduled ? Number(prismaBackupJob.scheduled) : undefined,
      started: prismaBackupJob.started ? Number(prismaBackupJob.started) : undefined,
      completed: prismaBackupJob.completed ? Number(prismaBackupJob.completed) : undefined,
      errorMessage: prismaBackupJob.errorMessage,
      resultUrl: prismaBackupJob.resultUrl,
      expires: prismaBackupJob.expires ? Number(prismaBackupJob.expires) : undefined,
      metadata: prismaBackupJob.metadata,
    };
  }

  async createBackupJob(backupJob: BackupJob): Promise<BackupJob> {
    try {
      const backupJobData = {
        id: backupJob.id,
        pubkey: backupJob.pubkey,
        status: backupJob.status,
        backupType: backupJob.backupType,
        requested: BigInt(backupJob.requested),
        scheduled: backupJob.scheduled ? BigInt(backupJob.scheduled) : null,
        started: backupJob.started ? BigInt(backupJob.started) : null,
        completed: backupJob.completed ? BigInt(backupJob.completed) : null,
        errorMessage: backupJob.errorMessage,
        resultUrl: backupJob.resultUrl,
        expires: backupJob.expires ? BigInt(backupJob.expires) : null,
        metadata: backupJob.metadata as any,
      };

      const result = await this.prisma.backupJob.create({
        data: backupJobData
      });

      logger.info(`Created backup job: ${backupJob.id}`);
      return this.transformPrismaBackupJobToBackupJob(result);
    } catch (error) {
      this.handlePrismaError(error, 'create');
    }
  }

  async getBackupJob(id: string, pubkey: string): Promise<BackupJob | null> {
    try {
      const result = await this.prisma.backupJob.findFirst({
        where: { 
          id: id,
          pubkey: pubkey 
        }
      });

      return result ? this.transformPrismaBackupJobToBackupJob(result) : null;
    } catch (error) {
      logger.error('Failed to get backup job by id:', error);
      throw new Error(`Failed to get backup job: ${(error as Error).message}`);
    }
  }

  async getUserBackupJobs(pubkey: string, limit: number = 50): Promise<BackupJob[]> {
    try {
      const results = await this.prisma.backupJob.findMany({
        where: { pubkey },
        orderBy: { requested: 'desc' },
        take: limit
      });

      return results.map(result => this.transformPrismaBackupJobToBackupJob(result));
    } catch (error) {
      logger.error('Failed to get backup jobs by pubkey:', error);
      throw new Error(`Failed to get backup jobs: ${(error as Error).message}`);
    }
  }

  async updateBackupJobStatus(
    id: string,
    pubkey: string,
    status: string,
    updates: Partial<BackupJob> = {}
  ): Promise<BackupJob> {
    try {
      // Get the existing backup job first
      const existingJob = await this.getBackupJob(id, pubkey);
      if (!existingJob) {
        throw new Error('Backup job not found');
      }

      // Merge the existing job with updates and new status
      const mergedJob = {
        ...existingJob,
        ...updates,
        status,
      };

      const backupJobData = {
        status: mergedJob.status,
        backupType: mergedJob.backupType,
        scheduled: mergedJob.scheduled ? BigInt(mergedJob.scheduled) : null,
        started: mergedJob.started ? BigInt(mergedJob.started) : null,
        completed: mergedJob.completed ? BigInt(mergedJob.completed) : null,
        errorMessage: mergedJob.errorMessage,
        resultUrl: mergedJob.resultUrl,
        expires: mergedJob.expires ? BigInt(mergedJob.expires) : null,
        metadata: mergedJob.metadata as any,
      };

      const result = await this.prisma.backupJob.update({
        where: { 
          id: id,
          pubkey: pubkey 
        },
        data: backupJobData
      });

      logger.info(`Updated backup job status: ${id} to ${status}`);
      return this.transformPrismaBackupJobToBackupJob(result);
    } catch (error) {
      this.handlePrismaError(error, 'update');
    }
  }

  async deleteBackupJob(id: string, pubkey: string): Promise<void> {
    try {
      await this.prisma.backupJob.delete({
        where: { id }
      });

      logger.info(`Deleted backup job: ${id}`);
    } catch (error) {
      this.handlePrismaError(error, 'delete');
    }
  }

  async getPendingBackupJobs(limit: number = 100): Promise<BackupJob[]> {
    try {
      const results = await this.prisma.backupJob.findMany({
        where: { status: 'pending' },
        orderBy: { requested: 'asc' },
        take: limit
      });

      return results.map(result => this.transformPrismaBackupJobToBackupJob(result));
    } catch (error) {
      logger.error('Failed to get pending backup jobs:', error);
      throw new Error(`Failed to get pending backup jobs: ${(error as Error).message}`);
    }
  }

  // Additional helper methods to match the original interface
  async getByStatus(status: string, limit: number = 100): Promise<BackupJob[]> {
    try {
      const results = await this.prisma.backupJob.findMany({
        where: { status },
        orderBy: { requested: 'asc' },
        take: limit
      });

      return results.map(result => this.transformPrismaBackupJobToBackupJob(result));
    } catch (error) {
      logger.error('Failed to get backup jobs by status:', error);
      throw new Error(`Failed to get backup jobs: ${(error as Error).message}`);
    }
  }

  async getExpiredJobs(): Promise<BackupJob[]> {
    try {
      const results = await this.prisma.backupJob.findMany({
        where: {
          expires: {
            lt: BigInt(now())
          }
        }
      });

      return results.map(result => this.transformPrismaBackupJobToBackupJob(result));
    } catch (error) {
      logger.error('Failed to get expired backup jobs:', error);
      throw new Error(`Failed to get expired backup jobs: ${(error as Error).message}`);
    }
  }
}

export default PrismaBackupJobRepository;