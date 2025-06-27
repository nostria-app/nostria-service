import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { createRateLimit } from '../utils/rateLimit';
import requireNIP98Auth from '../middleware/requireNIP98Auth';
import { ErrorBody, NIP98AuthenticatedRequest } from './types';
import backupJobRepository from '../database/backupJobRepository';
import { 
  BackupJob, 
  BackupJobStatus, 
  BackupType, 
  CreateBackupJobRequest,
  BackupJobResponse 
} from '../models/backupJob';
import { now } from '../helpers/now';

interface ErrorBodyWithMessage extends ErrorBody {
  message: string;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     BackupType:
 *       type: string
 *       enum: [full, incremental, selective]
 *       description: Type of backup to perform
 *     BackupJobStatus:
 *       type: string
 *       enum: [pending, scheduled, in_progress, completed, failed, expired]
 *       description: Current status of the backup job
 *     CreateBackupJobRequest:
 *       type: object
 *       required:
 *         - backupType
 *       properties:
 *         backupType:
 *           $ref: '#/components/schemas/BackupType'
 *         scheduledAt:
 *           type: number
 *           format: timestamp
 *           description: Optional scheduled execution time (defaults to immediate)
 *         metadata:
 *           type: object
 *           properties:
 *             description:
 *               type: string
 *               description: Optional description for the backup
 *           additionalProperties: true
 *     BackupJobResponse:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique identifier for the backup job
 *         status:
 *           $ref: '#/components/schemas/BackupJobStatus'
 *         backupType:
 *           $ref: '#/components/schemas/BackupType'
 *         requestedAt:
 *           type: number
 *           format: timestamp
 *         scheduledAt:
 *           type: number
 *           format: timestamp
 *           nullable: true
 *         startedAt:
 *           type: number
 *           format: timestamp
 *           nullable: true
 *         completedAt:
 *           type: number
 *           format: timestamp
 *           nullable: true
 *         errorMessage:
 *           type: string
 *           nullable: true
 *         resultUrl:
 *           type: string
 *           nullable: true
 *           description: Download URL for completed backup (expires after some time)
 *         expires:
 *           type: number
 *           format: timestamp
 *           nullable: true
 *           description: When the backup download link expires
 *         metadata:
 *           type: object
 *           nullable: true
 */

// Rate limiting for backup operations
const backupRateLimit = createRateLimit(
  60 * 60 * 1000, // 1 hour
  10, // limit each IP to 10 backup requests per hour
  'Too many backup requests from this IP, please try again later.'
);

const backupQueryRateLimit = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  100, // limit each IP to 100 backup queries per 15 minutes
  'Too many backup query requests from this IP, please try again later.'
);

const router = express.Router();

/**
 * @openapi
 * /backup:
 *   post:
 *     summary: Create a new backup job
 *     description: Request a backup of user data. The backup will be processed asynchronously by a background worker.
 *     tags: [Backup]
 *     security:
 *       - NIP98Auth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateBackupJobRequest'
 *     responses:
 *       201:
 *         description: Backup job created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BackupJobResponse'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - Invalid NIP-98 authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many requests
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', backupRateLimit, requireNIP98Auth, async (req: NIP98AuthenticatedRequest, res: Response<BackupJobResponse | ErrorBodyWithMessage>) => {
  try {
    const { backupType, scheduled, metadata } = req.body as CreateBackupJobRequest;
    const pubkey = req.authenticatedPubkey!;

    // Validate backup type
    if (!Object.values(BackupType).includes(backupType)) {
      return res.status(400).json({
        error: 'Invalid backup type',
        message: `Backup type must be one of: ${Object.values(BackupType).join(', ')}`
      });
    }

    // Validate scheduledAt if provided
    let parsedScheduled: Date | undefined;
    if (scheduled) {
      parsedScheduled = new Date(scheduled);
      if (isNaN(parsedScheduled.getTime())) {
        return res.status(400).json({
          error: 'Invalid scheduled date',
          message: 'scheduledAt must be a valid ISO 8601 date string'
        });
      }

      // Don't allow scheduling too far in the future (30 days max)
      const maxFutureDate = new Date();
      maxFutureDate.setDate(maxFutureDate.getDate() + 30);
      if (parsedScheduled > maxFutureDate) {
        return res.status(400).json({
          error: 'Invalid scheduled date',
          message: 'Cannot schedule backup more than 30 days in the future'
        });
      }
    }    // Create backup job
    const backupJob: BackupJob = {
      id: uuidv4(),
      type: 'backup-job',
      pubkey,
      status: BackupJobStatus.PENDING,
      backupType,
      requested: now(),
      scheduled: parsedScheduled?.getTime(),
      metadata
    };

    const createdJob = await backupJobRepository.createBackupJob(backupJob);

    // Convert to response format
    const response: BackupJobResponse = {
      id: createdJob.id,
      status: createdJob.status,
      backupType: createdJob.backupType,
      requested: createdJob.requested,
      scheduled: createdJob.scheduled,
      started: createdJob.started,
      completed: createdJob.completed,
      errorMessage: createdJob.errorMessage,
      resultUrl: createdJob.resultUrl,
      expires: createdJob.expires,
      metadata: createdJob.metadata
    };

    logger.info(`Backup job created: ${createdJob.id} for user: ${pubkey}`);
    return res.status(201).json(response);
  } catch (error) {
    logger.error('Error creating backup job:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to create backup job'
    });
  }
});

/**
 * @openapi
 * /backup/{jobId}:
 *   get:
 *     summary: Get backup job details
 *     description: Retrieve the status and details of a specific backup job
 *     tags: [Backup]
 *     security:
 *       - NIP98Auth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: The backup job ID
 *     responses:
 *       200:
 *         description: Backup job details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BackupJobResponse'
 *       401:
 *         description: Unauthorized - Invalid NIP-98 authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Backup job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many requests
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:jobId', backupQueryRateLimit, requireNIP98Auth, async (req: NIP98AuthenticatedRequest, res: Response<BackupJobResponse | ErrorBodyWithMessage>) => {
  try {
    const { jobId } = req.params;
    const pubkey = req.authenticatedPubkey!;

    if (!jobId) {
      return res.status(400).json({
        error: 'Invalid job ID',
        message: 'Job ID is required'
      });
    }

    const backupJob = await backupJobRepository.getBackupJob(jobId, pubkey);

    if (!backupJob) {
      return res.status(404).json({
        error: 'Backup job not found',
        message: 'The specified backup job was not found or you do not have access to it'
      });
    }

    // Convert to response format
    const response: BackupJobResponse = {
      id: backupJob.id,
      status: backupJob.status,
      backupType: backupJob.backupType,
      requested: backupJob.requested,
      scheduled: backupJob.scheduled,
      started: backupJob.started,
      completed: backupJob.completed,
      errorMessage: backupJob.errorMessage,
      resultUrl: backupJob.resultUrl,
      expires: backupJob.expires,
      metadata: backupJob.metadata
    };

    return res.json(response);
  } catch (error) {
    logger.error('Error retrieving backup job:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to retrieve backup job'
    });
  }
});

/**
 * @openapi
 * /backup:
 *   get:
 *     summary: Get user's backup jobs
 *     description: Retrieve a list of all backup jobs for the authenticated user
 *     tags: [Backup]
 *     security:
 *       - NIP98Auth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Maximum number of backup jobs to return
 *     responses:
 *       200:
 *         description: Backup jobs retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobs:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/BackupJobResponse'
 *                 total:
 *                   type: integer
 *                   description: Total number of jobs returned
 *       401:
 *         description: Unauthorized - Invalid NIP-98 authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many requests
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', backupQueryRateLimit, requireNIP98Auth, async (req: NIP98AuthenticatedRequest, res: Response) => {
  try {
    const pubkey = req.authenticatedPubkey!;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const backupJobs = await backupJobRepository.getUserBackupJobs(pubkey, limit);

    // Convert to response format
    const response = {
      jobs: backupJobs.map(job => ({
        id: job.id,
        status: job.status,
        backupType: job.backupType,
        requested: job.requested,
        scheduled: job.scheduled,
        started: job.started,
        completed: job.completed,
        errorMessage: job.errorMessage,
        resultUrl: job.resultUrl,
        expires: job.expires,
        metadata: job.metadata
      } as BackupJobResponse)),
      total: backupJobs.length
    };

    return res.json(response);
  } catch (error) {
    logger.error('Error retrieving user backup jobs:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to retrieve backup jobs'
    });
  }
});

export default router;
