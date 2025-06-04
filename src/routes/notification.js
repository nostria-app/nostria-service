const express = require('express');
const router = express.Router();
const { apiKeyAuth } = require('../middleware/auth');
const { accountsService } = require('../utils/AccountsTableService');
const { userActivityService } = require('../utils/UserActivityTableService');
const webpush = require('web-push');
const logger = require('../utils/logger');

// Configure VAPID details
if (process.env.PUBLIC_VAPID_KEY && process.env.PRIVATE_VAPID_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@nostria.app',
    process.env.PUBLIC_VAPID_KEY,
    process.env.PRIVATE_VAPID_KEY
  );
} else {
  logger.warn('VAPID keys not configured. Web push notifications will not work.');
}

/**
 * Send a notification to a specific user
 * @route POST /api/notification/send/:pubkey
 */
router.post('/send/:pubkey', apiKeyAuth, async (req, res) => {
  try {
    const { pubkey } = req.params;
    const { title, body, icon, badge, tag, data } = req.body;

    if (!title || !body) {
      return res.status(400).json({ error: 'Title and body are required' });
    }
    
    // Get user's notification settings
    const settingsEntity = await accountsService.getEntity(pubkey, 'notification-settings')
      .catch(() => null);

    const settings = settingsEntity ? {
      enabled: settingsEntity.enabled ?? true,
      eventTypes: JSON.parse(settingsEntity.eventTypes || '[]'),
      frequency: settingsEntity.frequency || 'immediate'
    } : { enabled: true, eventTypes: [], frequency: 'immediate' };

    if (!settings.enabled) {
      return res.status(200).json({ 
        success: true, 
        message: 'Notifications disabled for user',
        sent: 0 
      });
    }

    // Get all user's web push subscriptions
    const subscriptions = await accountsService.listEntities({
      queryOptions: {
        filter: `PartitionKey eq '${pubkey}' and RowKey ge 'webpush-' and RowKey lt 'webpush.'`
      }
    });

    const webPushSubscriptions = subscriptions.map(entity => ({
      endpoint: entity.endpoint,
      keys: {
        p256dh: entity.p256dh,
        auth: entity.auth
      },
      deviceKey: entity.rowKey.replace('webpush-', '')
    }));

    if (webPushSubscriptions.length === 0) {
      return res.status(200).json({ 
        success: true, 
        message: 'No push subscriptions found for user',
        sent: 0 
      });
    }

    // Prepare notification payload
    const payload = JSON.stringify({
      title,
      body,
      icon: icon || '/favicon.ico',
      badge: badge || '/favicon.ico',
      tag: tag || 'nostria-notification',
      data: data || {},
      timestamp: Date.now()
    });

    // Send notifications to all user devices
    const sendPromises = webPushSubscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(subscription, payload);
        logger.info(`Notification sent to device ${subscription.deviceKey} for pubkey ${pubkey.substring(0, 16)}...`);
        return { success: true, deviceKey: subscription.deviceKey };
      } catch (error) {
        logger.error(`Failed to send notification to device ${subscription.deviceKey}:`, error);
        
        // Remove invalid subscriptions
        if (error.statusCode === 410 || error.statusCode === 404) {
          try {
            await accountsService.deleteEntity(pubkey, `webpush-${subscription.deviceKey}`);
            logger.info(`Removed invalid subscription for device ${subscription.deviceKey}`);
          } catch (deleteError) {
            logger.error('Error removing invalid subscription:', deleteError);
          }
        }
        
        return { success: false, deviceKey: subscription.deviceKey, error: error.message };
      }
    });

    const results = await Promise.all(sendPromises);
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    // Log the notification
    const notificationLog = {
      partitionKey: pubkey,
      rowKey: `notification-${Date.now()}`,
      title,
      body,
      sentAt: new Date().toISOString(),
      devicesTargeted: webPushSubscriptions.length,
      devicesSuccessful: successful,
      devicesFailed: failed
    };

    await accountsService.upsertEntity(notificationLog);

    // Log user activity
    await userActivityService.logUserActivity(
      pubkey,
      'NOTIFICATION_SENT',
      {
        title,
        devicesTargeted: webPushSubscriptions.length,
        devicesSuccessful: successful,
        devicesFailed: failed
      }
    );

    res.json({
      success: true,
      message: 'Notification processing completed',
      sent: successful,
      failed: failed,
      total: webPushSubscriptions.length,
      results: results
    });

  } catch (error) {
    logger.error('Error sending notification:', error);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

/**
 * Send bulk notifications to multiple users
 * @route POST /api/notification/bulk
 */
router.post('/bulk', apiKeyAuth, async (req, res) => {
  try {
    const { pubkeys, title, body, icon, badge, tag, data } = req.body;

    if (!Array.isArray(pubkeys) || pubkeys.length === 0) {
      return res.status(400).json({ error: 'pubkeys array is required' });
    }

    if (!title || !body) {
      return res.status(400).json({ error: 'Title and body are required' });
    }

    if (pubkeys.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 users per bulk notification' });
    }

    // Send notification to each user
    const sendPromises = pubkeys.map(async (pubkey) => {
      try {
        const response = await fetch(`${req.protocol}://${req.get('host')}/api/notification/send/${pubkey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': req.headers.authorization
          },
          body: JSON.stringify({ title, body, icon, badge, tag, data })
        });

        const result = await response.json();
        return { pubkey, success: response.ok, result };
      } catch (error) {
        logger.error(`Error in bulk notification for pubkey ${pubkey}:`, error);
        return { pubkey, success: false, error: error.message };
      }
    });

    const results = await Promise.all(sendPromises);
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.json({
      success: true,
      message: 'Bulk notification processing completed',
      successful,
      failed,
      total: pubkeys.length,
      results
    });

  } catch (error) {
    logger.error('Error sending bulk notifications:', error);
    res.status(500).json({ error: 'Failed to send bulk notifications' });
  }
});

/**
 * Get notification statistics for a user
 * @route GET /api/notification/stats/:pubkey
 */
router.get('/stats/:pubkey', apiKeyAuth, async (req, res) => {
  try {
    const { pubkey } = req.params;
    const { days = 7 } = req.query;
    
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Query notification logs
    const notifications = await accountsService.listEntities({
      queryOptions: {
        filter: `PartitionKey eq '${pubkey}' and RowKey ge 'notification-${startDate.getTime()}' and RowKey lt 'notification-${endDate.getTime()}'`
      }
    });

    const notificationStats = notifications.map(entity => ({
      timestamp: entity.sentAt,
      title: entity.title,
      devicesTargeted: entity.devicesTargeted || 0,
      devicesSuccessful: entity.devicesSuccessful || 0,
      devicesFailed: entity.devicesFailed || 0
    }));

    const stats = {
      period: {
        days: parseInt(days),
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      },
      total: {
        notifications: notificationStats.length,
        devicesTargeted: notificationStats.reduce((sum, n) => sum + n.devicesTargeted, 0),
        devicesSuccessful: notificationStats.reduce((sum, n) => sum + n.devicesSuccessful, 0),
        devicesFailed: notificationStats.reduce((sum, n) => sum + n.devicesFailed, 0)
      },
      recent: notificationStats.slice(0, 10)
    };

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    logger.error('Error getting notification stats:', error);
    res.status(500).json({ error: 'Failed to get notification statistics' });
  }
});

module.exports = router;
