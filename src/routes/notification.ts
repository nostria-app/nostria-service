import express, { Request, Response } from 'express';
import notificationService from '../database/notificationService';
import webPush from '../utils/webPush';
import logger from '../utils/logger';

/**
 * @openapi
 * components:
 *   schemas:
 *     NotificationRequest:
 *       type: object
 *       properties:
 *         pubkeys:
 *           type: array
 *           items:
 *             type: string
 *           description: Array of user public keys to send notifications to. If empty, sends to all users.
 *         template:
 *           type: string
 *           description: Template name for legacy template-based notifications
 *         args:
 *           type: object
 *           additionalProperties: true
 *           description: Template arguments for legacy template-based notifications
 *         title:
 *           type: string
 *           description: Notification title (required for direct format)
 *         body:
 *           type: string
 *           description: Notification body text (required for direct format)
 *         icon:
 *           type: string
 *           description: Notification icon URL (optional, defaults to Nostria icon)
 *         url:
 *           type: string
 *           description: URL to open when notification is clicked
 *     NotificationResult:
 *       type: object
 *       properties:
 *         success:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               pubkey:
 *                 type: string
 *               successCount:
 *                 type: integer
 *               failCount:
 *                 type: integer
 *           description: Successfully sent notifications
 *         failed:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               pubkey:
 *                 type: string
 *               reason:
 *                 type: string
 *               deviceCount:
 *                 type: integer
 *           description: Failed notifications with reasons
 *         filtered:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               pubkey:
 *                 type: string
 *               reason:
 *                 type: string
 *           description: Notifications filtered by user settings
 *         limited:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               pubkey:
 *                 type: string
 *               reason:
 *                 type: string
 *           description: Notifications blocked by rate limits
 *         summary:
 *           type: object
 *           properties:
 *             totalTargeted:
 *               type: integer
 *               description: Total number of users targeted
 *             successful:
 *               type: integer
 *               description: Number of successful notifications
 *             failed:
 *               type: integer
 *               description: Number of failed notifications
 *             filtered:
 *               type: integer
 *               description: Number of filtered notifications
 *             limited:
 *               type: integer
 *               description: Number of rate-limited notifications
 *     NotificationStatus:
 *       type: object
 *       properties:
 *         pubkey:
 *           type: string
 *           description: User's public key
 *         hasSubscription:
 *           type: boolean
 *           description: Whether user has active push subscriptions
 *         deviceCount:
 *           type: integer
 *           description: Number of registered devices
 *         isPremium:
 *           type: boolean
 *           description: Whether user has premium subscription
 *         settings:
 *           type: object
 *           properties:
 *             enabled:
 *               type: boolean
 *               description: Whether notifications are enabled
 *           description: User notification settings
 *         notifications:
 *           type: object
 *           properties:
 *             count24h:
 *               type: integer
 *               description: Number of notifications sent in last 24 hours
 *             dailyLimit:
 *               type: integer
 *               description: Daily notification limit for user's tier
 *             remaining:
 *               type: integer
 *               description: Remaining notifications for today
 *   securitySchemes:
 *     ApiKeyAuth:
 *       type: apiKey
 *       in: header
 *       name: X-API-Key
 *       description: API key for server-to-server notification sending
 * tags:
 *   - name: Notifications
 *     description: Push notification management and delivery
 */

const router = express.Router();

interface NotificationRequest {
  pubkeys?: string[];
  template?: string;
  args?: Record<string, any>;
  title?: string;
  body?: string;
  icon?: string;
  url?: string;
}

interface NotificationResult {
  success: Array<{ pubkey: string; successCount: number; failCount: number }>;
  failed: Array<{ pubkey: string; reason: string; deviceCount?: number }>;
  filtered: Array<{ pubkey: string; reason: string }>;
  limited: Array<{ pubkey: string; reason: string }>;
}

interface NotificationPayload {
  title?: string;
  body?: string;
  content?: string;
  template?: string;
  icon?: string;
  url?: string;
  timestamp: string;
}

interface WebPushPayload {
  title?: string;
  content?: string;
  template?: string;
  timestamp?: string;
  notification?: {
    title: string;
    body: string;
    icon: string;
    data?: {
      onActionClick: {
        default: { operation: string; url: string };
      };
    };
  };
}

/**
 * @openapi
 * /notification/send:
 *   post:
 *     summary: Send notifications to users
 *     description: |
 *       Send push notifications to specified users or broadcast to all users. Supports both legacy template-based format
 *       and new direct notification format. Handles rate limiting, user preferences, and device management automatically.
 *     tags:
 *       - Notifications
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NotificationRequest'
 *           examples:
 *             directNotification:
 *               summary: Direct notification format
 *               value:
 *                 title: "New Message"
 *                 body: "You have received a new message"
 *                 icon: "https://example.com/icon.png"
 *                 url: "https://app.example.com/messages"
 *                 pubkeys: ["pubkey1", "pubkey2"]
 *             templateNotification:
 *               summary: Template-based notification (legacy)
 *               value:
 *                 template: "message_received"
 *                 args:
 *                   username: "John"
 *                   count: 3
 *                 pubkeys: ["pubkey1"]
 *             broadcastNotification:
 *               summary: Broadcast to all users
 *               value:
 *                 title: "System Announcement"
 *                 body: "The system will undergo maintenance tonight"
 *     responses:
 *       '200':
 *         description: Notification processing completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/NotificationResult'
 *       '400':
 *         description: Invalid request parameters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Title and body are required"
 *       '401':
 *         description: Unauthorized - Invalid API key
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Failed to process notifications"
 */
router.post('/send', async (req: Request, res: Response): Promise<void> => {
  try {
    const { pubkeys, template, args, title, body, icon, url }: NotificationRequest = req.body;

    // Support both template-based and direct notification formats
    let notificationPayload: NotificationPayload;
    let targetPubkeys = pubkeys;

    console.log(`Received notification request: ${JSON.stringify(req.body)}`);

    if (template) {
      // Legacy template-based format
      if (!template) {
        res.status(400).json({ error: 'Template is required when using template format' });
        return;
      }

      // Process the notification content
      const content = webPush.processTemplate(template, args);

      notificationPayload = {
        title: 'Nostria Notification',
        content,
        template,
        timestamp: new Date().toISOString()
      };
    } else {
      // New direct format from the form
      if (!title || !body) {
        res.status(400).json({ error: 'Title and body are required' });
        return;
      }

      notificationPayload = {
        title,
        body,
        icon: icon || "https://nostria.app/icons/icon-128x128.png",
        url,
        timestamp: new Date().toISOString()
      };
    }

    // If no pubkeys specified, get all registered users
    if (!targetPubkeys || targetPubkeys.length === 0) {
      try {
        targetPubkeys = await notificationService.getAllUserPubkeys();
        logger.info(`Broadcasting notification to all ${targetPubkeys.length} registered users`);
      } catch (error) {
        logger.error(`Error getting all users: ${(error as Error).message}`);
        res.status(500).json({ error: 'Failed to get user list for broadcast' });
        return;
      }
    }

    // Process notifications for each pubkey
    const results: NotificationResult = {
      success: [],
      failed: [],
      filtered: [],
      limited: []
    };

    for (const pubkey of targetPubkeys) {
      try {
        // Get all subscriptions for this user
        const subscriptionEntities = await notificationService.getUserSubscriptions(pubkey);

        console.log(`Processing notification for user ${pubkey}, found ${subscriptionEntities.length} devices`);

        if (!subscriptionEntities.length) {
          results.failed.push({ pubkey, reason: 'No subscriptions found' });
          continue;
        }

        // Check if user can receive more notifications (tier limits)
        const canReceive = await webPush.canReceiveNotification(pubkey);

        if (!canReceive) {
          results.limited.push({ pubkey, reason: 'Daily notification limit reached' });
          continue;
        }

        // Create the Web Push notification payload
        let webPushPayload: WebPushPayload;

        if (template) {
          // Legacy template format - keep existing behavior
          const passesFilters = await webPush.passesCustomFilters(pubkey, notificationPayload);
          
          if (!passesFilters) {
            results.filtered.push({ pubkey, reason: 'Filtered by user settings' });
            continue;
          }

          // Use legacy signing if available
          webPushPayload = notificationPayload as WebPushPayload;
        } else {
          // New direct format - create Web Push payload structure
          webPushPayload = {
            notification: {
              title: notificationPayload.title!,
              body: notificationPayload.body!,
              icon: notificationPayload.icon!,
              data: notificationPayload.url ? {
                onActionClick: {
                  default: { operation: "navigateLastFocusedOrOpen", url: notificationPayload.url + "?pubkey=" + pubkey }
                }
              } : {
                onActionClick: {
                  default: { operation: "navigateLastFocusedOrOpen", url: "/?pubkey=" + pubkey }
                }
              }
            }
          };
        }

        let deviceSuccessCount = 0;
        let deviceFailCount = 0;

        // Send notification to all user's devices
        for (const subscriptionEntity of subscriptionEntities) {
          try {
            // Parse subscription from string
            const subscription = JSON.parse(subscriptionEntity.subscription);

            // Send Web Push notification
            const pushResult = await webPush.sendNotification(subscription, webPushPayload);

            if (pushResult && pushResult.error === 'expired_subscription') {
              logger.warn(`Expired subscription for user ${pubkey}, device key: ${subscriptionEntity.rowKey.substring(0, 16)}...`);
              deviceFailCount++;
              // Could delete expired subscription here if desired
            } else {
              deviceSuccessCount++;
            }
          } catch (deviceError) {
            logger.error(`Error sending notification to device ${subscriptionEntity.rowKey.substring(0, 16)}... for user ${pubkey}: ${(deviceError as Error).message}`);
            deviceFailCount++;
          }
        }

        // Log the notification to file and database
        await webPush.logNotificationToFile(pubkey, notificationPayload);

        if (deviceSuccessCount > 0) {
          results.success.push({
            pubkey,
            successCount: deviceSuccessCount,
            failCount: deviceFailCount
          });
        } else {
          results.failed.push({
            pubkey,
            reason: 'All device notifications failed',
            deviceCount: deviceFailCount
          });
        }
      } catch (error) {
        logger.error(`Failed to send notification to ${pubkey}: ${(error as Error).message}`);
        results.failed.push({ pubkey, reason: (error as Error).message });
      }
    }

    // Log summary
    const totalTargeted = targetPubkeys.length;
    logger.info(`Notification sent to ${results.success.length}/${totalTargeted} users, ` +
      `failed for ${results.failed.length}, ` +
      `filtered for ${results.filtered.length}, ` +
      `limited for ${results.limited.length}`);

    res.status(200).json({
      ...results,
      summary: {
        totalTargeted,
        successful: results.success.length,
        failed: results.failed.length,
        filtered: results.filtered.length,
        limited: results.limited.length
      }
    });
  } catch (error) {
    logger.error(`Error sending notifications: ${(error as Error).message}`);
    res.status(500).json({ error: 'Failed to process notifications' });
  }
});

/**
 * @openapi
 * /notification/status/{pubkey}:
 *   get:
 *     summary: Get notification status for a user
 *     description: |
 *       Retrieve comprehensive notification status for a specific user including subscription status,
 *       device count, premium status, notification settings, and usage statistics.
 *     tags:
 *       - Notifications
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - name: pubkey
 *         in: path
 *         required: true
 *         description: User's public key (hexadecimal format)
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{64}$'
 *           example: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
 *     responses:
 *       '200':
 *         description: User notification status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/NotificationStatus'
 *             example:
 *               pubkey: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
 *               hasSubscription: true
 *               deviceCount: 2
 *               isPremium: false
 *               settings:
 *                 enabled: true
 *               notifications:
 *                 count24h: 3
 *                 dailyLimit: 5
 *                 remaining: 2
 *       '400':
 *         description: Invalid pubkey parameter
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid pubkey"
 *       '401':
 *         description: Unauthorized - Invalid API key
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Failed to get notification status"
 */
router.get('/status/:pubkey', async (req: Request, res: Response): Promise<void> => {
  try {
    const { pubkey } = req.params;

    if (!pubkey) {
      res.status(400).json({ error: 'Invalid pubkey' });
      return;
    }    // Check subscription status - get all user's devices
    const subscriptionEntities = await notificationService.getUserSubscriptions(pubkey);
    const hasSubscription = subscriptionEntities.length > 0;
    const deviceCount = subscriptionEntities.length;

    // Check premium status
    const isPremium = await notificationService.hasPremiumSubscription(pubkey);

    // Get notification settings from CosmosDB
    const settings = await notificationService.getNotificationSettings(pubkey);

    // Get 24-hour notification count
    const notificationCount = await notificationService.get24HourNotificationCount(pubkey);

    // Get daily limits based on tier
    const dailyLimit = isPremium
      ? parseInt(process.env.PREMIUM_TIER_DAILY_LIMIT || '50')
      : parseInt(process.env.FREE_TIER_DAILY_LIMIT || '5');

    const status = {
      pubkey,
      hasSubscription,
      deviceCount,
      isPremium,
      settings: settings || { enabled: true },
      notifications: {
        count24h: notificationCount,
        dailyLimit,
        remaining: Math.max(0, dailyLimit - notificationCount)
      }
    };

    res.status(200).json(status);
  } catch (error) {
    logger.error(`Error getting notification status: ${(error as Error).message}`);
    res.status(500).json({ error: 'Failed to get notification status' });
  }
});

export default router;
