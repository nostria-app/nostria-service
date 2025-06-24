import express, { Request, Response } from 'express';
import notificationService from '../database/notificationService';
import webPush from '../utils/webPush';
import logger from '../utils/logger';
import { nip98 } from 'nostr-tools';

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

/** Forwards the incoming notification to all instances for this user. Used for testing or syncing data across devices. */
router.post('/send/:pubkey', async (req: Request, res: Response): Promise<void> => {
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  let valid = false;
  try {
    valid = await nip98.validateToken(req.headers.authorization!, url, 'POST');
  } catch (validationError) {
    logger.warn(`NIP-98 validation error: ${(validationError as Error).message}`);
    res.status(401).json({ error: `Authorization validation failed: ${(validationError as Error).message}` });
    return;
  }

  if (!valid) {
    res.status(401).json({ error: 'Invalid or missing authorization token' });
    return;
  }

  const { pubkey } = req.params;
  const notification: NotificationData = req.body;

  const records = await notificationService.getUserEntities(pubkey);

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

    const notificationResult = await webPush.sendNotification(sub, payload);

    if (notificationResult.statusCode !== 201) {
      logger.error(`Failed to send notification to ${record.partitionKey}: ${notificationResult.statusCode}`);
    }
  }

  res.status(200).json({
    message: 'Sent notification to all devices',
    success: true
  });
});

/**
 * Save Web Push subscription for a user
 * @route POST /api/subscription/webpush/:pubkey
 */
router.post('/webpush/:pubkey', async (req: Request, res: Response): Promise<void> => {
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    let valid = false;
    try {
      valid = await nip98.validateToken(req.headers.authorization!, url, 'POST');
    } catch (validationError) {
      logger.warn(`NIP-98 validation error: ${(validationError as Error).message}`);
      res.status(401).json({ error: `Authorization validation failed: ${(validationError as Error).message}` });
      return;
    }

    if (!valid) {
      res.status(401).json({ error: 'Invalid or missing authorization token' });
      return;
    }

    const { pubkey } = req.params;
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
router.post('/settings/:pubkey', async (req: Request, res: Response): Promise<void> => {
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    let valid = false;
    try {
      valid = await nip98.validateToken(req.headers.authorization!, url, 'POST');
    } catch (validationError) {
      logger.warn(`NIP-98 validation error: ${(validationError as Error).message}`);
      res.status(401).json({ error: `Authorization validation failed: ${(validationError as Error).message}` });
      return;
    }

    if (!valid) {
      res.status(401).json({ error: 'Invalid or missing authorization token' });
      return;
    }

    const { pubkey } = req.params;
    let settings: any = req.body;

    if (!pubkey) {
      res.status(400).json({ error: 'Invalid pubkey' });
      return;
    }    // Check if user has premium subscription for custom filters
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
      settings: JSON.stringify(settings),
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
router.get('/devices/:pubkey', async (req: Request, res: Response): Promise<void> => {
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    let valid = false;
    try {
      valid = await nip98.validateToken(req.headers.authorization!, url, 'GET');
    } catch (validationError) {
      logger.warn(`NIP-98 validation error: ${(validationError as Error).message}`);
      res.status(401).json({ error: `Authorization validation failed: ${(validationError as Error).message}` });
      return;
    }

    if (!valid) {
      res.status(401).json({ error: 'Invalid or missing authorization token' });
      return;
    }

    const { pubkey } = req.params;

    if (!pubkey) {
      res.status(400).json({ error: 'Invalid pubkey' });
      return;
    }    // Get all user subscription entities
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
router.get('/settings/:pubkey', async (req: Request, res: Response): Promise<void> => {
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    let valid = false;
    try {
      valid = await nip98.validateToken(req.headers.authorization!, url, 'GET');
    } catch (validationError) {
      logger.warn(`NIP-98 validation error: ${(validationError as Error).message}`);
      res.status(401).json({ error: `Authorization validation failed: ${(validationError as Error).message}` });
      return;
    }

    if (!valid) {
      res.status(401).json({ error: 'Invalid or missing authorization token' });
      return;
    }

    const { pubkey } = req.params;

    if (!pubkey) {
      res.status(400).json({ error: 'Invalid pubkey' });
      return;
    }    // Get user settings from CosmosDB
    const settings = await notificationService.getNotificationSettings(pubkey);    // Check if user has premium subscription
    // const isPremium = await notificationService.hasPremiumSubscription(pubkey);

    if (!settings) {
      res.status(200).json({
        enabled: true, // Default value
        // isPremium
      });
      return;
    }    // Remove internal fields
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
router.delete('/webpush/:pubkey/:deviceKey', async (req: Request, res: Response): Promise<void> => {
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    let valid = false;
    try {
      valid = await nip98.validateToken(req.headers.authorization!, url, 'DELETE');
    } catch (validationError) {
      logger.warn(`NIP-98 validation error: ${(validationError as Error).message}`);
      res.status(401).json({ error: `Authorization validation failed: ${(validationError as Error).message}` });
      return;
    }

    if (!valid) {
      res.status(401).json({ error: 'Invalid or missing authorization token' });
      return;
    }

    const { pubkey, deviceKey } = req.params;

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

export default router;
