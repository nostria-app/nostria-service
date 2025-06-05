const express = require('express');
const router = express.Router();
const { nip98Auth, optionalNip98Auth } = require('../middleware/auth');
const { accountsService } = require('../utils/AccountsTableService');
const { userActivityService } = require('../utils/UserActivityTableService');
const logger = require('../utils/logger');

/**
 * Register a web push subscription for a user's device
 * @route POST /api/subscription/webpush/:pubkey
 */
router.post('/webpush/:pubkey', nip98Auth, async (req, res) => {
  try {
    const { pubkey } = req.params;
    const { endpoint, keys, deviceName } = req.body;

    // Validate authenticated user matches pubkey
    if (req.authenticatedPubkey !== pubkey) {
      return res.status(403).json({ error: 'Unauthorized: Cannot register subscription for another user' });
    }

    // Validate required fields
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).json({ 
        error: 'Missing required fields: endpoint, keys.p256dh, keys.auth' 
      });
    }

    const timestamp = new Date().toISOString();
    const deviceKey = Buffer.from(endpoint).toString('base64').substring(0, 16);

    // Store subscription in accounts table
    const subscriptionEntity = {
      partitionKey: pubkey,
      rowKey: `webpush-${deviceKey}`,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      deviceName: deviceName || 'Unknown Device',
      registeredAt: timestamp,
      lastUsed: timestamp
    };

    await accountsService.upsertEntity(subscriptionEntity);

    // Log activity
    await userActivityService.logUserActivity(
      pubkey,
      'webpush_subscription_registered',
      {
        deviceKey,
        deviceName: deviceName || 'Unknown Device'
      },
      req.ip
    );

    logger.info(`Web push subscription registered for pubkey: ${pubkey.substring(0, 16)}...`);

    res.status(201).json({
      success: true,
      deviceKey,
      message: 'Web push subscription registered successfully'
    });

  } catch (error) {
    logger.error('Error registering web push subscription:', error);
    res.status(500).json({ error: 'Failed to register subscription' });
  }
});

/**
 * Get all registered devices for a user
 * @route GET /api/subscription/devices/:pubkey
 */
router.get('/devices/:pubkey', nip98Auth, async (req, res) => {
  try {
    const { pubkey } = req.params;

    // Validate authenticated user matches pubkey
    if (req.authenticatedPubkey !== pubkey) {
      return res.status(403).json({ error: 'Unauthorized: Cannot view devices for another user' });
    }
    
    // Query all webpush subscriptions for this user
    const subscriptions = await accountsService.listEntities({
      queryOptions: {
        filter: `PartitionKey eq '${pubkey}' and RowKey ge 'webpush-' and RowKey lt 'webpush.'`
      }
    });

    const devices = subscriptions.map(entity => ({
      deviceKey: entity.rowKey.replace('webpush-', ''),
      deviceName: entity.deviceName,
      registeredAt: entity.registeredAt,
      lastUsed: entity.lastUsed
    }));

    res.json({
      success: true,
      devices,
      count: devices.length
    });

  } catch (error) {
    logger.error('Error getting user devices:', error);
    res.status(500).json({ error: 'Failed to get devices' });
  }
});

/**
 * Get a user's notification settings
 * @route GET /api/subscription/settings/:pubkey
 */
router.get('/settings/:pubkey', nip98Auth, async (req, res) => {
  try {
    const { pubkey } = req.params;

    // Validate authenticated user matches pubkey
    if (req.authenticatedPubkey !== pubkey) {
      return res.status(403).json({ error: 'Unauthorized: Cannot view settings for another user' });
    }
    
    // Get notification settings
    const settingsEntity = await accountsService.getEntity(pubkey, 'notification-settings')
      .catch(() => null);

    const defaultSettings = {
      enabled: true,
      eventTypes: ['mention', 'reaction', 'repost', 'follow'],
      frequency: 'immediate',
      quietHours: {
        enabled: false,
        start: '22:00',
        end: '08:00'
      }
    };

    const settings = settingsEntity ? {
      enabled: settingsEntity.enabled ?? true,
      eventTypes: JSON.parse(settingsEntity.eventTypes || '["mention", "reaction", "repost", "follow"]'),
      frequency: settingsEntity.frequency || 'immediate',
      quietHours: JSON.parse(settingsEntity.quietHours || '{"enabled":false,"start":"22:00","end":"08:00"}')
    } : defaultSettings;

    res.json({
      success: true,
      settings
    });

  } catch (error) {
    logger.error('Error getting notification settings:', error);
    res.status(500).json({ error: 'Failed to get notification settings' });
  }
});

/**
 * Update a user's notification settings
 * @route POST /api/subscription/settings/:pubkey
 */
router.post('/settings/:pubkey', nip98Auth, async (req, res) => {
  try {
    const { pubkey } = req.params;
    const { enabled, eventTypes, frequency, quietHours } = req.body;

    // Validate authenticated user matches pubkey
    if (req.authenticatedPubkey !== pubkey) {
      return res.status(403).json({ error: 'Unauthorized: Cannot update settings for another user' });
    }
    
    // Validate settings
    const validEventTypes = ['mention', 'reaction', 'repost', 'follow', 'dm'];
    const validFrequencies = ['immediate', 'hourly', 'daily'];

    if (eventTypes && !Array.isArray(eventTypes)) {
      return res.status(400).json({ error: 'eventTypes must be an array' });
    }

    if (eventTypes && eventTypes.some(type => !validEventTypes.includes(type))) {
      return res.status(400).json({ 
        error: `Invalid event types. Valid types: ${validEventTypes.join(', ')}` 
      });
    }

    if (frequency && !validFrequencies.includes(frequency)) {
      return res.status(400).json({ 
        error: `Invalid frequency. Valid frequencies: ${validFrequencies.join(', ')}` 
      });
    }

    // Update settings
    const settingsEntity = {
      partitionKey: pubkey,
      rowKey: 'notification-settings',
      enabled: enabled ?? true,
      eventTypes: JSON.stringify(eventTypes || ['mention', 'reaction', 'repost', 'follow']),
      frequency: frequency || 'immediate',
      quietHours: JSON.stringify(quietHours || { enabled: false, start: '22:00', end: '08:00' }),
      updatedAt: new Date().toISOString()
    };

    await accountsService.upsertEntity(settingsEntity);

    // Log activity
    await userActivityService.logUserActivity(
      pubkey,
      'notification_settings_updated',
      {
        enabled,
        eventTypes,
        frequency
      },
      req.ip
    );

    logger.info(`Notification settings updated for pubkey: ${pubkey.substring(0, 16)}...`);

    res.json({
      success: true,
      message: 'Notification settings updated successfully'
    });

  } catch (error) {
    logger.error('Error updating notification settings:', error);
    res.status(500).json({ error: 'Failed to update notification settings' });
  }
});

/**
 * Delete a specific device subscription for a user
 * @route DELETE /api/subscription/webpush/:pubkey/:deviceKey
 */
router.delete('/webpush/:pubkey/:deviceKey', nip98Auth, async (req, res) => {
  try {
    const { pubkey, deviceKey } = req.params;

    // Validate authenticated user matches pubkey
    if (req.authenticatedPubkey !== pubkey) {
      return res.status(403).json({ error: 'Unauthorized: Cannot delete subscription for another user' });
    }
    
    // Delete the subscription
    await accountsService.deleteEntity(pubkey, `webpush-${deviceKey}`);

    // Log activity
    await userActivityService.logUserActivity(
      pubkey,
      'webpush_subscription_deleted',
      {
        deviceKey
      },
      req.ip
    );

    logger.info(`Web push subscription deleted for pubkey: ${pubkey.substring(0, 16)}... device: ${deviceKey}`);

    res.json({
      success: true,
      message: 'Device subscription deleted successfully'
    });

  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ error: 'Device subscription not found' });
    }
    logger.error('Error deleting device subscription:', error);
    res.status(500).json({ error: 'Failed to delete device subscription' });
  }
});

/**
 * Get subscription tiers and pricing (public endpoint)
 * @route GET /api/subscription/pricing
 */
router.get('/pricing', (req, res) => {
  try {
    const pricing = {
      free: {
        tier: 'free',
        price: 0,
        dailyLimit: parseInt(process.env.FREE_TIER_DAILY_LIMIT) || 5,
        features: ['Basic notifications', 'Email support']
      },
      premium: {
        tier: 'premium',
        dailyLimit: parseInt(process.env.PREMIUM_TIER_DAILY_LIMIT) || 50,
        features: ['Increased notification limit', 'Priority support', 'Custom templates'],
        pricing: {
          monthly: {
            price: parseInt(process.env.PREMIUM_MONTHLY_PRICE) || 999,
            priceDisplay: '$9.99/month'
          },
          quarterly: {
            price: parseInt(process.env.PREMIUM_QUARTERLY_PRICE) || 2497,
            priceDisplay: '$24.97/quarter',
            savings: 'Save 17%'
          },
          yearly: {
            price: parseInt(process.env.PREMIUM_YEARLY_PRICE) || 9999,
            priceDisplay: '$99.99/year',
            savings: 'Save 17%'
          }
        }
      },
      premium_plus: {
        tier: 'premium_plus',
        dailyLimit: parseInt(process.env.PREMIUM_PLUS_TIER_DAILY_LIMIT) || 500,
        features: ['Unlimited notifications', 'Premium support', 'Custom integrations', 'Analytics'],
        pricing: {
          monthly: {
            price: parseInt(process.env.PREMIUM_PLUS_MONTHLY_PRICE) || 1999,
            priceDisplay: '$19.99/month'
          },
          quarterly: {
            price: parseInt(process.env.PREMIUM_PLUS_QUARTERLY_PRICE) || 4997,
            priceDisplay: '$49.97/quarter',
            savings: 'Save 17%'
          },
          yearly: {
            price: parseInt(process.env.PREMIUM_PLUS_YEARLY_PRICE) || 19999,
            priceDisplay: '$199.99/year',
            savings: 'Save 17%'
          }
        }
      }
    };

    res.json({
      success: true,
      pricing
    });
  } catch (error) {
    logger.error(`Pricing endpoint error: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
