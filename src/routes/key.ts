import express, { Request, Response } from 'express';
import logger from '../utils/logger';

/**
 * @openapi
 * components:
 *   schemas:
 *     VapidKey:
 *       type: object
 *       properties:
 *         key:
 *           type: string
 *           description: Public VAPID key for Web Push notifications
 *           example: "BK8j9X7YjKl3mN4pQ5rS6tU7vW8xY9zA1bC2dE3fG4hI5jK6lM7nO8pQ9rS0tU1v"
 * tags:
 *   - name: Keys
 *     description: Cryptographic key management endpoints
 */

const router = express.Router();

/**
 * @openapi
 * /key:
 *   get:
 *     summary: Get service public VAPID key
 *     description: |
 *       Retrieve the public VAPID (Voluntary Application Server Identification) key
 *       required for Web Push notification subscriptions. This key is used by clients
 *       to identify the server when subscribing to push notifications.
 *     tags:
 *       - Keys
 *     responses:
 *       '200':
 *         description: Public VAPID key retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VapidKey'
 *             example:
 *               key: "BK8j9X7YjKl3mN4pQ5rS6tU7vW8xY9zA1bC2dE3fG4hI5jK6lM7nO8pQ9rS0tU1v"
 *       '500':
 *         description: Failed to retrieve public key
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Failed to get key"
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const status = {
      key: process.env.PUBLIC_VAPID_KEY,
    };

    res.status(200).json(status);
  } catch (error) {
    logger.error(`Error getting service key: ${(error as Error).message}`);
    res.status(500).json({ error: 'Failed to get key' });
  }
});

export default router;
