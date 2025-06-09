const express = require('express');
const router = express.Router();
const tableStorage = require('../utils/tableStorage');
const webPush = require('../utils/webPush');
const logger = require('../utils/logger');
const { nip98 } = require('nostr-tools');

/** Forwards the incoming notification to all instances for this user. Used for testing or syncing data across devices. */
router.post('/send/:pubkey', async (req, res) => {
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  let valid = false;
  try {
    valid = await nip98.validateToken(req.headers.authorization, url, 'POST');
  } catch (validationError) {
    logger.warn(`NIP-98 validation error: ${validationError.message}`);
    return res.status(401).json({ error: `Authorization validation failed: ${validationError.message}` });
  }

  if (!valid) {
    return res.status(401).json({ error: 'Invalid or missing authorization token' });
  }

  const { pubkey } = req.params;
  const notification = req.body;

  const records = await tableStorage.getUserEntities(pubkey);

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
      logger.error(`Failed to send notification to ${record.partitionKey}: ${notificationResult.statusMessage}`);
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
router.post('/webpush/:pubkey', async (req, res) => {
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    let valid = false;
    try {
      valid = await nip98.validateToken(req.headers.authorization, url, 'POST');
    } catch (validationError) {
      logger.warn(`NIP-98 validation error: ${validationError.message}`);
      return res.status(401).json({ error: `Authorization validation failed: ${validationError.message}` });
    }

    if (!valid) {
      return res.status(401).json({ error: 'Invalid or missing authorization token' });
    }

    const { pubkey } = req.params;
    const subscription = req.body;

    if (!pubkey || !subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh) {
      return res.status(400).json({ error: 'Invalid subscription data. Missing endpoint or p256dh key.' });
    }

    // Use p256dh as the rowKey to allow multiple devices per user
    const rowKey = subscription.keys.p256dh;

    // Store the subscription in Azure Table Storage
    await tableStorage.upsertEntity(pubkey, rowKey, {
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
      logger.warn(`Failed to send test notification to new device: ${notificationError.message}`);
    }

    res.status(201).json({
      success: true,
      message: 'Subscription saved successfully'
    });
  } catch (error) {
    logger.error(`Error saving subscription: ${error.message}`);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

/**
 * Save user notification settings
 * @route POST /api/subscription/settings/:pubkey
 */
router.post('/settings/:pubkey', async (req, res) => {
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    let valid = false;
    try {
      valid = await nip98.validateToken(req.headers.authorization, url, 'POST');
    } catch (validationError) {
      logger.warn(`NIP-98 validation error: ${validationError.message}`);
      return res.status(401).json({ error: `Authorization validation failed: ${validationError.message}` });
    }

    if (!valid) {
      return res.status(401).json({ error: 'Invalid or missing authorization token' });
    }

    const { pubkey } = req.params;
    let settings = req.body;

    if (!pubkey) {
      return res.status(400).json({ error: 'Invalid pubkey' });
    }

    // Check if user has premium subscription for custom filters
    // TODO: Enable this when premium subscriptions are implemented
    // const isPremium = await tableStorage.hasPremiumSubscription(pubkey);

    // // Non-premium users can only update basic settings
    // if (!isPremium && settings.filters) {
    //   return res.status(403).json({
    //     error: 'Custom filters are only available for premium subscribers'
    //   });
    // }    console.log('PUBKEY:', pubkey);

    // settings = [];

    // Store the settings in the settings table
    await tableStorage.upsertNotificationSettings(pubkey, {
      settings: JSON.stringify(settings),
    });

    logger.info(`Notification settings updated for user ${pubkey}`);

    res.status(200).json({
      success: true,
      message: 'Notification settings updated successfully',
      // isPremium
    });
  } catch (error) {
    logger.error(`Error updating notification settings: ${error.message}`);
    res.status(500).json({ error: 'Failed to update notification settings' });
  }
});

/**
 * Get all devices (subscriptions) for a user
 * @route GET /api/subscription/devices/:pubkey
 */
router.get('/devices/:pubkey', async (req, res) => {
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    let valid = false;
    try {
      valid = await nip98.validateToken(req.headers.authorization, url, 'GET');
    } catch (validationError) {
      logger.warn(`NIP-98 validation error: ${validationError.message}`);
      return res.status(401).json({ error: `Authorization validation failed: ${validationError.message}` });
    }

    if (!valid) {
      return res.status(401).json({ error: 'Invalid or missing authorization token' });
    }

    const { pubkey } = req.params;

    if (!pubkey) {
      return res.status(400).json({ error: 'Invalid pubkey' });
    }

    // Get all user subscription entities
    const subscriptionEntities = await tableStorage.getUserSubscriptions(pubkey);

    console.log('Pubkey:', pubkey);
    console.log('SUBSCRIPTION ENTITIES:', subscriptionEntities);

    // Extract relevant info from subscription entities
    const devices = subscriptionEntities
      .map(entity => {
        const subscription = JSON.parse(entity.subscription);
        return {
          deviceId: entity.rowKey,
          endpoint: subscription.endpoint,
          userAgent: subscription.userAgent || null, // Optional field
          // Extract browser/device info if available in the subscription
          lastUpdated: entity.updatedAt,
          createdAt: entity.createdAt
        };
      });

    res.status(200).json({
      pubkey,
      deviceCount: devices.length,
      devices
    });
  } catch (error) {
    logger.error(`Error getting user devices: ${error.message}`);
    res.status(500).json({ error: 'Failed to get user devices' });
  }
});

/**
 * Get user notification settings
 * @route GET /api/subscription/settings/:pubkey
 */
router.get('/settings/:pubkey', async (req, res) => {
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    let valid = false;
    try {
      valid = await nip98.validateToken(req.headers.authorization, url, 'GET');
    } catch (validationError) {
      logger.warn(`NIP-98 validation error: ${validationError.message}`);
      return res.status(401).json({ error: `Authorization validation failed: ${validationError.message}` });
    }

    if (!valid) {
      return res.status(401).json({ error: 'Invalid or missing authorization token' });
    }

    const { pubkey } = req.params;

    if (!pubkey) {
      return res.status(400).json({ error: 'Invalid pubkey' });
    }    // Get user settings from the settings table
    const settings = await tableStorage.getNotificationSettings(pubkey);

    // Check if user has premium subscription
    // const isPremium = await tableStorage.hasPremiumSubscription(pubkey);

    if (!settings) {
      return res.status(200).json({
        enabled: true, // Default value
        // isPremium
      });
    }

    // Remove internal fields
    const { partitionKey, rowKey, timestamp, ...userSettings } = settings;

    res.status(200).json({
      ...userSettings,
      // isPremium
    });
  } catch (error) {
    logger.error(`Error getting notification settings: ${error.message}`);
    res.status(500).json({ error: 'Failed to get notification settings' });
  }
});

/**
 * Delete user's subscription for a specific device
 * @route DELETE /api/subscription/webpush/:pubkey/:deviceKey
 */
router.delete('/webpush/:pubkey/:deviceKey', async (req, res) => {
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    let valid = false;
    try {
      valid = await nip98.validateToken(req.headers.authorization, url, 'DELETE');
    } catch (validationError) {
      logger.warn(`NIP-98 validation error: ${validationError.message}`);
      return res.status(401).json({ error: `Authorization validation failed: ${validationError.message}` });
    }

    if (!valid) {
      return res.status(401).json({ error: 'Invalid or missing authorization token' });
    }

    const { pubkey, deviceKey } = req.params;

    if (!pubkey || !deviceKey) {
      return res.status(400).json({ error: 'Invalid pubkey or deviceKey' });
    }

    const entity = await tableStorage.getEntity(pubkey, deviceKey);

    if (!entity) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    // Delete the subscription from Azure Table Storage
    await tableStorage.tableClient.deleteEntity(pubkey, deviceKey);

    logger.info(`Web Push subscription deleted for user ${pubkey}, device key: ${deviceKey.substring(0, 16)}...`);

    res.status(200).json({
      success: true,
      message: 'Subscription deleted successfully'
    });
  } catch (error) {
    logger.error(`Error deleting subscription: ${error.message}`);
    res.status(500).json({ error: 'Failed to delete subscription' });
  }
});

module.exports = router;
