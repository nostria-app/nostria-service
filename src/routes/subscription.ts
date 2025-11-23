import express, { Request, Response } from 'express';
import notificationService from '../database/notificationService';
import webPush from '../utils/webPush';
import logger from '../utils/logger';
import { nip98 } from 'nostr-tools';
import requireNIP98Auth from '../middleware/requireNIP98Auth';
import requireAdminAuth from '../middleware/requireAdminAuth';
import { createRateLimit } from '../utils/rateLimit';
import { NIP98AuthenticatedRequest } from './types';
import RepositoryFactory from '../database/RepositoryFactory';

type SubscriptionRequest = NIP98AuthenticatedRequest;

// Get repository instance from factory
const notificationSubscriptionRepository = RepositoryFactory.getNotificationSubscriptionRepository();

const authRateLimit = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  500, // limit each IP to 500 requests per windowMs
  'Too many authenticated requests from this IP, please try again later.'
);

// combined middleware to be used for routes requiring
// authenticated user
const authUser = [authRateLimit, requireNIP98Auth];

/**
 * @openapi
 * components:
 *   schemas:
 *     PushSubscription:
 *       type: object
 *       required:
 *         - endpoint
 *         - keys
 *       properties:
 *         endpoint:
 *           type: string
 *           description: Push service endpoint URL
 *           example: "https://fcm.googleapis.com/fcm/send/..."
 *         keys:
 *           type: object
 *           required:
 *             - p256dh
 *             - auth
 *           properties:
 *             p256dh:
 *               type: string
 *               description: P256DH key for encryption
 *               example: "BNbSMUw..."
 *             auth:
 *               type: string
 *               description: Auth secret for encryption
 *               example: "tBHItJI5svbpez7KI4CCXg=="
 *         userAgent:
 *           type: string
 *           description: Browser user agent string
 *           example: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
 *     NotificationData:
 *       type: object
 *       properties:
 *         title:
 *           type: string
 *           description: Notification title
 *           example: "New Message"
 *         body:
 *           type: string
 *           description: Notification body text
 *           example: "You have received a new message"
 *         icon:
 *           type: string
 *           description: Notification icon URL
 *           example: "https://example.com/icon.png"
 *         data:
 *           type: object
 *           description: Additional notification data
 *           additionalProperties: true
 *     DeviceInfo:
 *       type: object
 *       properties:
 *         deviceId:
 *           type: string
 *           description: Unique device identifier
 *         endpoint:
 *           type: string
 *           description: Push service endpoint URL
 *         userAgent:
 *           type: string
 *           nullable: true
 *           description: Browser user agent string
 *         created:
 *           type: number
 *           format: timestamp
 *           description: Device registration timestamp
 *         modified:
 *           type: number
 *           format: timestamp
 *           description: Last modification timestamp
 *     DevicesResponse:
 *       type: object
 *       properties:
 *         pubkey:
 *           type: string
 *           description: User's public key
 *         deviceCount:
 *           type: integer
 *           description: Number of registered devices
 *         devices:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/DeviceInfo'
 *           description: List of user's devices
 *     NotificationSettings:
 *       type: object
 *       description: User notification preferences and filters
 *       additionalProperties: true
 * tags:
 *   - name: Subscriptions
 *     description: Web Push subscription management and device registration
 */

const router = express.Router();

interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
}

interface NotificationData {
  title?: string;
  body?: string;
  icon?: string;
  data?: any;
}

interface DeviceInfo {
  deviceId: string;
  endpoint: string;
  userAgent?: string | null;
  created?: string;
  modified?: string;
}

/**
 * @openapi
 * /subscription/send/{pubkey}:
 *   post:
 *     summary: Send test notification to user's devices
 *     description: |
 *       Send a test notification to all registered devices for a specific user.
 *       Primarily used for testing push notification functionality and syncing data across devices.
 *       Requires NIP-98 authentication.
 *     tags:
 *       - Subscriptions
 *     security:
 *       - NIP98Auth: []
 *     parameters:
 *       - name: pubkey
 *         in: path
 *         required: true
 *         description: User's public key (hexadecimal format)
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{64}$'
 *           example: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NotificationData'
 *           example:
 *             title: "Test Notification"
 *             body: "This is a test notification"
 *             icon: "https://nostria.app/icons/icon-128x128.png"
 *     responses:
 *       '200':
 *         description: Notification sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 success:
 *                   type: boolean
 *       '401':
 *         description: Unauthorized - Invalid NIP-98 token
 *       '500':
 *         description: Failed to send notification
 */
router.post('/send/:pubkey', authUser, async (req: SubscriptionRequest, res: Response): Promise<void> => {
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  console.log('Sending notification to pubkey:', url);

  // Don't get pubkey from route, but from authenticated user.
  const { pubkey } = req.params;
  const pubKeyAuth = req.authenticatedPubkey;

  console.log('Sending notification to pubKeyAuth:', pubKeyAuth);

  if (pubkey !== pubKeyAuth) {
    res.status(400).json({ error: 'Pubkey mismatch' });
    return;
  }

  const notification: NotificationData = req.body;

  const records = await notificationService.getUserEntities(pubkey);

  console.log(`Found ${records.length} devices for user ${pubkey}`);

  for (const record of records) {
    const sub = JSON.parse(record.subscription);

    const payload = {
      "notification": {
        "title": notification.title || "Nostria Notification",
        "body": notification.body || "You have a new notification.",
        "icon": notification.icon || "https://nostria.app/icons/icon-128x128.png",
        "data": notification.data || {
          "onActionClick": {
            "default": { "operation": "navigateLastFocusedOrOpen", "url": "/" },
            "open": { "operation": "navigateLastFocusedOrOpen", "url": "/" },
            "focus": { "operation": "navigateLastFocusedOrOpen", "url": "/specific-path" }
          }
        }
      }
    };

    console.log('Payload for device:', record.partitionKey, payload);

    try {
      const notificationResult = await webPush.sendNotification(sub, payload);

      console.log(`Notification sent to ${record.partitionKey}:`, notificationResult);

      if (notificationResult && notificationResult.error === 'expired_subscription') {
        logger.warn(`Expired subscription for user ${pubkey}, device key: ${record.rowKey}`);
        await notificationService.deleteEntity(pubkey, record.rowKey);
      } else if (notificationResult.statusCode !== 201) {
        logger.error(`Failed to send notification to ${record.partitionKey}: ${notificationResult.statusCode}`);
      }
    } catch (error: any) {
      logger.error(`Failed to send notification to ${record.partitionKey}: ${error.message}`);
      if (error.statusCode === 410 || error.statusCode === 404) {
        logger.info(`Removing expired subscription for device ${record.rowKey} (caught error)`);
        await notificationService.deleteEntity(pubkey, record.rowKey);
      }
    }
  }

  res.status(200).json({
    message: 'Sent notification to all devices',
    success: true
  });
});

/**
 * @openapi
 * /subscription/webpush/{pubkey}:
 *   post:
 *     summary: Register Web Push subscription for a user
 *     description: |
 *       Register a new Web Push subscription for a user's device. This enables the device
 *       to receive push notifications. Automatically sends a welcome notification to test
 *       the subscription. Requires NIP-98 authentication.
 *     tags:
 *       - Subscriptions
 *     security:
 *       - NIP98Auth: []
 *     parameters:
 *       - name: pubkey
 *         in: path
 *         required: true
 *         description: User's public key (hexadecimal format)
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{64}$'
 *           example: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PushSubscription'
 *           example:
 *             endpoint: "https://fcm.googleapis.com/fcm/send/xyz123"
 *             keys:
 *               p256dh: "BNbSMUw5svbpez7KI4CCXg=="
 *               auth: "tBHItJI5svbpez7KI4CCXg=="
 *             userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
 *     responses:
 *       '201':
 *         description: Subscription registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       '400':
 *         description: Invalid subscription data
 *       '401':
 *         description: Unauthorized - Invalid NIP-98 token
 *       '500':
 *         description: Failed to save subscription
 */
router.post('/webpush/:pubkey', authUser, async (req: SubscriptionRequest, res: Response): Promise<void> => {
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    // Don't get pubkey from route, but from authenticated user.
    const { pubkey } = req.params;
    const pubKeyAuth = req.authenticatedPubkey;

    if (pubkey !== pubKeyAuth) {
      res.status(400).json({ error: 'Pubkey mismatch' });
      return;
    }

    const subscription: PushSubscription = req.body;

    if (!pubkey || !subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh) {
      res.status(400).json({ error: 'Invalid subscription data. Missing endpoint or p256dh key.' });
      return;
    }

    // Use p256dh as the rowKey to allow multiple devices per user
    const rowKey = subscription.keys.p256dh;    // Store the subscription in CosmosDB
    await notificationService.upsertEntity(pubkey, rowKey, {
      subscription: JSON.stringify(subscription),
    });

    logger.info(`Web Push subscription saved for user ${pubkey}, device key: ${rowKey.substring(0, 16)}...`);

    // Send a test notification to the newly registered device
    try {
      const payload = {
        "notification": {
          "title": "Setup completed!",
          "body": "Notification setup was setup successfully.",
          "icon": "https://nostria.app/icons/icon-128x128.png",
          "data": {
            "onActionClick": {
              "default": { "operation": "navigateLastFocusedOrOpen", "url": "/?pubkey=" + pubkey }
            }
          }
        }
      };

      // Send Web Push notification to the newly registered device
      await webPush.sendNotification(subscription, payload);
      logger.info(`Test notification sent to new device for user ${pubkey}`);
    } catch (notificationError) {
      // Just log the error but don't fail the registration process
      logger.warn(`Failed to send test notification to new device: ${(notificationError as Error).message}`);
    }

    res.status(201).json({
      success: true,
      message: 'Subscription saved successfully'
    });
  } catch (error) {
    logger.error(`Error saving subscription: ${(error as Error).message}`);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

/**
 * Save user notification settings
 * @route POST /api/subscription/settings/:pubkey
 */
router.post('/settings/:pubkey', authUser, async (req: SubscriptionRequest, res: Response): Promise<void> => {
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    // Don't get pubkey from route, but from authenticated user.
    const { pubkey } = req.params;
    const pubKeyAuth = req.authenticatedPubkey;

    if (pubkey !== pubKeyAuth) {
      res.status(400).json({ error: 'Pubkey mismatch' });
      return;
    }

    let settings: any = req.body;

    // Check if user has premium subscription for custom filters
    // TODO: Enable this when premium subscriptions are implemented
    // const isPremium = await notificationService.hasPremiumSubscription(pubkey);

    // // Non-premium users can only update basic settings
    // if (!isPremium && settings.filters) {
    //   res.status(403).json({
    //     error: 'Custom filters are only available for premium subscribers'
    //   });
    //   return;
    // }

    console.log('PUBKEY:', pubkey);

    // settings = [];    // Store the settings in CosmosDB
    await notificationService.upsertNotificationSettings(pubkey, {
      settings: settings,
    });

    logger.info(`Notification settings updated for user ${pubkey}`);

    res.status(200).json({
      success: true,
      message: 'Notification settings updated successfully',
      // isPremium
    });
  } catch (error) {
    logger.error(`Error updating notification settings: ${(error as Error).message}`);
    res.status(500).json({ error: 'Failed to update notification settings' });
  }
});

/**
 * Get all devices (subscriptions) for a user
 * @route GET /api/subscription/devices/:pubkey
 */
router.get('/devices/:pubkey', authUser, async (req: SubscriptionRequest, res: Response): Promise<void> => {
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    // Don't get pubkey from route, but from authenticated user.
    const { pubkey } = req.params;
    const pubKeyAuth = req.authenticatedPubkey;

    if (pubkey !== pubKeyAuth) {
      res.status(400).json({ error: 'Pubkey mismatch' });
      return;
    }

    // Get all user subscription entities
    const subscriptionEntities = await notificationService.getUserSubscriptions(pubkey);

    // Extract relevant info from subscription entities
    const devices: DeviceInfo[] = subscriptionEntities
      .map((entity: any) => {
        const subscription = JSON.parse(entity.subscription);
        return {
          deviceId: entity.rowKey,
          endpoint: subscription.endpoint,
          userAgent: subscription.userAgent || null, // Optional field
          // Extract browser/device info if available in the subscription
          modified: entity.timestamp,
          created: entity.created
        };
      });

    res.status(200).json({
      pubkey,
      deviceCount: devices.length,
      devices
    });
  } catch (error) {
    logger.error(`Error getting user devices: ${(error as Error).message}`);
    res.status(500).json({ error: 'Failed to get user devices' });
  }
});

/**
 * Get user notification settings
 * @route GET /api/subscription/settings/:pubkey
 */
router.get('/settings/:pubkey', authUser, async (req: SubscriptionRequest, res: Response): Promise<void> => {
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    // Don't get pubkey from route, but from authenticated user.
    const { pubkey } = req.params;
    const pubKeyAuth = req.authenticatedPubkey;

    if (pubkey !== pubKeyAuth) {
      res.status(400).json({ error: 'Pubkey mismatch' });
      return;
    }

    // Get user settings from CosmosDB
    const settings = await notificationService.getNotificationSettings(pubkey);

    // Check if user has premium subscription
    // const isPremium = await notificationService.hasPremiumSubscription(pubkey);

    if (!settings) {
      res.status(200).json({
        enabled: true,
        // Default value
        // isPremium
      });
      return;
    }

    // Remove internal fields
    const { partitionKey, rowKey, timestamp, ...userSettings } = settings || {};

    res.status(200).json({
      ...userSettings,
      // isPremium
    });
  } catch (error) {
    logger.error(`Error getting notification settings: ${(error as Error).message}`);
    res.status(500).json({ error: 'Failed to get notification settings' });
  }
});

/**
 * Delete user's subscription for a specific device
 * @route DELETE /api/subscription/webpush/:pubkey/:deviceKey
 */
router.delete('/webpush/:pubkey/:deviceKey', authUser, async (req: SubscriptionRequest, res: Response): Promise<void> => {
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    // Don't get pubkey from route, but from authenticated user.
    const { pubkey, deviceKey } = req.params;
    const pubKeyAuth = req.authenticatedPubkey;

    if (pubkey !== pubKeyAuth) {
      res.status(400).json({ error: 'Pubkey mismatch' });
      return;
    }

    if (!pubkey || !deviceKey) {
      res.status(400).json({ error: 'Invalid pubkey or deviceKey' });
      return;
    }

    const entity = await notificationService.getEntity(pubkey, deviceKey);

    if (!entity) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }    // Delete the subscription from CosmosDB
    await notificationService.tableClient.deleteEntity(pubkey, deviceKey);

    logger.info(`Web Push subscription deleted for user ${pubkey}, device key: ${deviceKey.substring(0, 16)}...`);

    res.status(200).json({
      success: true,
      message: 'Subscription deleted successfully'
    });
  } catch (error) {
    logger.error(`Error deleting subscription: ${(error as Error).message}`);
    res.status(500).json({ error: 'Failed to delete subscription' });
  }
});

/**
 * @openapi
 * /subscription/list:
 *   get:
 *     operationId: "ListSubscriptions"
 *     summary: List all notification subscriptions (Admin only)
 *     description: Get a list of all notification subscription records (requires admin authentication)
 *     tags: [Subscriptions]
 *     security:
 *       - NIP98Auth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 1000
 *           default: 100
 *         description: Maximum number of subscriptions to return
 *     responses:
 *       200:
 *         description: List of subscriptions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/NotificationSubscription'
 *       401:
 *         description: Unauthorized - NIP-98 authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Forbidden - Admin access required
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
router.get('/list', requireAdminAuth, async (req: NIP98AuthenticatedRequest, res: Response) => {
  try {
    console.log('Subscription list endpoint reached with auth:', req.authenticatedPubkey);
    const limit = parseInt(req.query.limit as string) || 100;
    
    // Validate limit
    if (limit < 1 || limit > 1000) {
      return res.status(400).json({ error: 'Limit must be between 1 and 1000' });
    }

    const subscriptions = await notificationSubscriptionRepository.getAllSubscriptions(limit);

    logger.info(`Retrieved ${subscriptions.length} subscriptions for admin user ${req.authenticatedPubkey?.substring(0, 16)}...`);

    return res.json(subscriptions);
  } catch (error) {
    logger.error('Error retrieving subscriptions:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
