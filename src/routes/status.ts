import express, { Request, Response } from 'express';
import os from 'os';
import logger from '../utils/logger';

/**
 * @openapi
 * components:
 *   schemas:
 *     ServiceStatus:
 *       type: object
 *       properties:
 *         service:
 *           type: string
 *           description: Service name
 *           example: "Nostria Service"
 *         version:
 *           type: string
 *           description: Service version
 *           example: "1.0.0"
 *         uptime:
 *           type: number
 *           description: Service uptime in seconds
 *           example: 3600.5
 *         environment:
 *           type: string
 *           description: Runtime environment
 *           enum: [development, staging, production]
 *           example: "production"
 *         key:
 *           type: string
 *           description: Public VAPID key for Web Push
 *           example: "BK8j..."
 *         timestamp:
 *           type: number
 *           format: timestamp
 *           description: Current server timestamp
 *         system:
 *           type: object
 *           properties:
 *             platform:
 *               type: string
 *               description: Operating system platform
 *               example: "linux"
 *             arch:
 *               type: string
 *               description: System architecture
 *               example: "x64"
 *             memory:
 *               type: object
 *               properties:
 *                 total:
 *                   type: string
 *                   description: Total system memory
 *                   example: "8192 MB"
 *                 free:
 *                   type: string
 *                   description: Available system memory
 *                   example: "4096 MB"
 *           description: System information (deprecated - will be removed for security)
 *     HealthStatus:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 *           enum: [ok]
 *           description: Health check status
 *           example: "ok"
 * tags:
 *   - name: Status
 *     description: Service status and health monitoring endpoints
 */

const router = express.Router();

/**
 * @openapi
 * /status:
 *   get:
 *     summary: Get comprehensive service status
 *     description: |
 *       Retrieve detailed information about the service including version, uptime, environment,
 *       VAPID key, and system information. System information is deprecated and will be removed
 *       in future versions for security reasons.
 *     tags:
 *       - Status
 *     responses:
 *       '200':
 *         description: Service status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ServiceStatus'
 *             example:
 *               service: "Nostria Service"
 *               version: "1.0.0"
 *               uptime: 3600.5
 *               environment: "production"
 *               key: "BK8j9X7YjKl3mN4pQ5rS6tU7vW8xY9zA1bC2dE3fG4hI5jK6lM7nO8pQ9rS0tU1v"
 *               timestamp: "2023-06-24T10:30:00.000Z"
 *               system:
 *                 platform: "linux"
 *                 arch: "x64"
 *                 memory:
 *                   total: "8192 MB"
 *                   free: "4096 MB"
 *       '500':
 *         description: Failed to retrieve service status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Failed to get service status"
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const status = {
      service: 'Nostria Service',
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      key: process.env.PUBLIC_VAPID_KEY,
      timestamp: new Date().toISOString(),

      // TODO: This information will not be provided in the future. This can be abused to validate if potential
      // attacks is successful (increased memory usage, etc.).
      system: {
        platform: os.platform(),
        arch: os.arch(),
        memory: {
          total: Math.round(os.totalmem() / (1024 * 1024)) + ' MB',
          free: Math.round(os.freemem() / (1024 * 1024)) + ' MB',
        }
      }
    };
    
    res.status(200).json(status);
  } catch (error) {
    logger.error(`Error getting service status: ${(error as Error).message}`);
    res.status(500).json({ error: 'Failed to get service status' });
  }
});

/**
 * @openapi
 * /status/health:
 *   get:
 *     summary: Health check endpoint
 *     description: |
 *       Simple health check endpoint that returns the service availability status.
 *       Used for load balancer health checks and monitoring systems.
 *     tags:
 *       - Status
 *     responses:
 *       '200':
 *         description: Service is healthy and operational
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthStatus'
 *             example:
 *               status: "ok"
 */
router.get('/health', (req: Request, res: Response): void => {
  res.status(200).json({ status: 'ok' });
});

export default router;
