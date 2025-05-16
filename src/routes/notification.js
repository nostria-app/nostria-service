const express = require('express');
const router = express.Router();
const tableStorage = require('../utils/tableStorage');
const webPush = require('../utils/webPush');
const vasipProtocol = require('../utils/vapidProtocol');
const logger = require('../utils/logger');

/**
 * Send notification to users
 * @route POST /api/notification/send
 * Protected by API key
 */
router.post('/send', async (req, res) => {
  try {
    const { pubkeys, template, args } = req.body;
    
    if (!pubkeys || !Array.isArray(pubkeys) || pubkeys.length === 0) {
      return res.status(400).json({ error: 'Invalid pubkeys array' });
    }
    
    if (!template) {
      return res.status(400).json({ error: 'Template is required' });
    }
    
    // Process notifications for each pubkey
    const results = {
      success: [],
      failed: [],
      filtered: [],
      limited: []
    };
    
    for (const pubkey of pubkeys) {
      try {
        // Get user's subscription
        const subscriptionEntity = await tableStorage.getEntity(pubkey, 'notification-subscription');
        
        if (!subscriptionEntity || !subscriptionEntity.subscription) {
          results.failed.push({ pubkey, reason: 'No subscription found' });
          continue;
        }
        
        // Check if user can receive more notifications (tier limits)
        const canReceive = await webPush.canReceiveNotification(pubkey);
        if (!canReceive) {
          results.limited.push({ pubkey, reason: 'Daily notification limit reached' });
          continue;
        }
        
        // Process the notification content
        const content = webPush.processTemplate(template, args);
        
        // Create notification payload
        const notification = {
          title: 'Nostria Notification',
          content,
          template,
          timestamp: new Date().toISOString()
        };
        
        // Check if notification passes user's custom filters
        const passesFilters = await webPush.passesCustomFilters(pubkey, notification);
        if (!passesFilters) {
          results.filtered.push({ pubkey, reason: 'Filtered by user settings' });
          continue;
        }
        
        // Sign the notification with VAPID
        const signedNotification = await vasipProtocol.signNotification(pubkey, notification);
        
        // Parse subscription from string
        const subscription = JSON.parse(subscriptionEntity.subscription);
        
        // Send Web Push notification
        const pushResult = await webPush.sendNotification(subscription, signedNotification);
        
        if (pushResult && pushResult.error === 'expired_subscription') {
          results.failed.push({ pubkey, reason: 'Expired subscription' });
          continue;
        }
        
        // Log the notification to file and database
        await webPush.logNotificationToFile(pubkey, notification);
        
        results.success.push(pubkey);
      } catch (error) {
        logger.error(`Failed to send notification to ${pubkey}: ${error.message}`);
        results.failed.push({ pubkey, reason: error.message });
      }
    }
    
    // Log summary
    logger.info(`Notification sent to ${results.success.length} users, ` +
      `failed for ${results.failed.length}, ` +
      `filtered for ${results.filtered.length}, ` +
      `limited for ${results.limited.length}`);
    
    res.status(200).json(results);
  } catch (error) {
    logger.error(`Error sending notifications: ${error.message}`);
    res.status(500).json({ error: 'Failed to process notifications' });
  }
});

/**
 * Get notification status for a user
 * @route GET /api/notification/status/:pubkey
 * Protected by API key
 */
router.get('/status/:pubkey', async (req, res) => {
  try {
    const { pubkey } = req.params;
    
    if (!pubkey) {
      return res.status(400).json({ error: 'Invalid pubkey' });
    }
    
    // Check subscription status
    const subscriptionEntity = await tableStorage.getEntity(pubkey, 'notification-subscription');
    const hasSubscription = !!subscriptionEntity;
    
    // Check premium status
    const isPremium = await tableStorage.hasPremiumSubscription(pubkey);
    
    // Get notification settings
    const settings = await tableStorage.getEntity(pubkey, 'notification-settings');
    
    // Get 24-hour notification count
    const notificationCount = await tableStorage.get24HourNotificationCount(pubkey);
    
    // Get daily limits based on tier
    const dailyLimit = isPremium
      ? parseInt(process.env.PREMIUM_TIER_DAILY_LIMIT || 50)
      : parseInt(process.env.FREE_TIER_DAILY_LIMIT || 5);
    
    const status = {
      pubkey,
      hasSubscription,
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
    logger.error(`Error getting notification status: ${error.message}`);
    res.status(500).json({ error: 'Failed to get notification status' });
  }
});

module.exports = router;
