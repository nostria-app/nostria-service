import express, { Request, Response } from 'express';
import notificationService from '../database/notificationService';
import notificationSettingsRepository from '../database/notificationSettingsRepository';
import notificationSubscriptionRepository from '../database/notificationSubscriptionRepository';
import logger from '../utils/logger';

const router = express.Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     UserWithNotificationSettings:
 *       type: object
 *       properties:
 *         pubkey:
 *           type: string
 *           description: User's public key
 *         enabled:
 *           type: boolean
 *           description: Whether notifications are enabled for this user
 *         filters:
 *           type: object
 *           additionalProperties: true
 *           description: Custom notification filters (for premium users)
 *         settings:
 *           type: object
 *           additionalProperties: true
 *           description: Additional notification settings
 *         subscriptionCount:
 *           type: integer
 *           description: Number of active notification subscriptions for this user
 *         created:
 *           type: integer
 *           description: Timestamp when the user's notification settings were created
 *         modified:
 *           type: integer
 *           description: Timestamp when the user's notification settings were last modified
 *       required:
 *         - pubkey
 *         - enabled
 *     UsersResponse:
 *       type: object
 *       properties:
 *         users:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/UserWithNotificationSettings'
 *         total:
 *           type: integer
 *           description: Total number of users returned
 *         hasMore:
 *           type: boolean
 *           description: Whether there are more users available (when using limit)
 */

/**
 * @openapi
 * /api/users:
 *   get:
 *     summary: Get users who should receive notifications with their notification settings
 *     description: Returns a list of users who have notification subscriptions and their notification settings. Protected with API key authentication.
 *     tags:
 *       - Users
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 1000
 *           default: 100
 *         description: Maximum number of users to return
 *       - in: query
 *         name: enabledOnly
 *         schema:
 *           type: boolean
 *           default: false
 *         description: If true, only return users who have notifications enabled
 *     responses:
 *       200:
 *         description: Successfully retrieved users with notification settings
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UsersResponse'
 *       401:
 *         description: Unauthorized - Invalid API key
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Unauthorized: Invalid API key"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Failed to fetch users"
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const enabledOnly = req.query.enabledOnly === 'true';

    logger.info(`Fetching users with notification settings (limit: ${limit}, enabledOnly: ${enabledOnly})`);

    // Get all users who have notification subscriptions
    const userPubkeys = await notificationSubscriptionRepository.getAllUserPubkeys();
    
    if (userPubkeys.length === 0) {
      res.json({
        users: [],
        total: 0,
        hasMore: false
      });
      return;
    }

    // Get notification settings for each user and their subscription counts
    const usersWithSettings = await Promise.all(
      userPubkeys.slice(0, limit).map(async (pubkey) => {
        try {
          // Get notification settings (might be null if user never explicitly set them)
          const settings = await notificationSettingsRepository.getSettings(pubkey);
          
          // Get subscription count for this user
          const subscriptions = await notificationSubscriptionRepository.getUserSubscriptions(pubkey);
          
          // Default settings if user hasn't set any
          const userSettings = {
            pubkey,
            enabled: settings?.enabled ?? true, // Default to enabled if no explicit settings
            filters: settings?.filters || null,
            settings: settings?.settings || null,
            subscriptionCount: subscriptions.length,
            created: settings?.created || null,
            modified: settings?.modified || null
          };

          // Filter out disabled users if enabledOnly is true
          if (enabledOnly && !userSettings.enabled) {
            return null;
          }

          return userSettings;
        } catch (error) {
          logger.error(`Failed to get settings for user ${pubkey}:`, error);
          // Return user with default settings if we can't fetch their specific settings
          return {
            pubkey,
            enabled: true, // Default to enabled
            filters: null,
            settings: null,
            subscriptionCount: 0,
            created: null,
            modified: null
          };
        }
      })
    );

    // Filter out null entries (disabled users when enabledOnly is true)
    const filteredUsers = usersWithSettings.filter(user => user !== null);

    const response = {
      users: filteredUsers,
      total: filteredUsers.length,
      hasMore: userPubkeys.length > limit
    };

    logger.info(`Retrieved ${filteredUsers.length} users with notification settings`);
    res.json(response);

  } catch (error) {
    logger.error('Failed to fetch users with notification settings:', error);
    res.status(500).json({ 
      error: 'Failed to fetch users',
      details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

export default router;