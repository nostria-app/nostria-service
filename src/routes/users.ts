import express, { Request, Response } from 'express';
import RepositoryFactory from '../database/RepositoryFactory';
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
 * /users:
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

    logger.info(`[Users API] Starting request - limit: ${limit}, enabledOnly: ${enabledOnly}`);

    // Get repositories based on configuration (CosmosDB or PostgreSQL)
    const notificationSubscriptionRepository = RepositoryFactory.getNotificationSubscriptionRepository();
    const notificationSettingsRepository = RepositoryFactory.getNotificationSettingsRepository();

    // Get all users who have notification subscriptions
    logger.info('[Users API] Fetching all user pubkeys from notification subscriptions...');
    const userPubkeys = await (notificationSubscriptionRepository as any).getAllUserPubkeys();
    logger.info(`[Users API] Found ${userPubkeys.length} users with notification subscriptions`);
    
    if (userPubkeys.length === 0) {
      logger.warn('[Users API] No users found with notification subscriptions, returning empty result');
      res.json({
        users: [],
        total: 0,
        hasMore: false
      });
      return;
    }

    logger.info(`[Users API] Processing first ${Math.min(userPubkeys.length, limit)} users`);

    // Get notification settings for each user and their subscription counts
    const usersWithSettings = await Promise.all(
      userPubkeys.slice(0, limit).map(async (pubkey: string, index: number) => {
        try {
          logger.debug(`[Users API] Processing user ${index + 1}/${Math.min(userPubkeys.length, limit)}: ${pubkey}`);
          
          // Get notification settings (might be null if user never explicitly set them)
          const settings = await notificationSettingsRepository.getSettings(pubkey);
          logger.debug(`[Users API] Settings for ${pubkey}: ${settings ? 'found' : 'not found (using defaults)'}`);
          
          // Get subscription count for this user
          const subscriptions = await (notificationSubscriptionRepository as any).getUserSubscriptions(pubkey);
          logger.debug(`[Users API] User ${pubkey} has ${subscriptions.length} subscription(s)`);
          
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
            logger.debug(`[Users API] User ${pubkey} filtered out (enabledOnly=true, enabled=false)`);
            return null;
          }

          return userSettings;
        } catch (error) {
          logger.error(`[Users API] Failed to get settings for user ${pubkey}:`, error);
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
    const filteredUsers = usersWithSettings.filter((user: any) => user !== null);
    logger.info(`[Users API] After filtering: ${filteredUsers.length} users (filtered out: ${usersWithSettings.length - filteredUsers.length})`);

    const response = {
      users: filteredUsers,
      total: filteredUsers.length,
      hasMore: userPubkeys.length > limit
    };

    logger.info(`[Users API] Successfully retrieved ${filteredUsers.length} users with notification settings`);
    res.json(response);

  } catch (error) {
    logger.error('[Users API] Failed to fetch users with notification settings:', error);
    res.status(500).json({ 
      error: 'Failed to fetch users',
      details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

export default router;