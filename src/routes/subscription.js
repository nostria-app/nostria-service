const express = require('express');
const router = express.Router();
const tableStorage = require('../utils/tableStorage');
const webPush = require('../utils/webPush');
const vasipProtocol = require('../utils/vapidProtocol');
const logger = require('../utils/logger');

/**
 * Save Web Push subscription for a user
 * @route POST /api/subscription/webpush/:pubkey
 */
router.post('/webpush/:pubkey', async (req, res) => {
  try {
    const { pubkey } = req.params;
    const subscription = req.body;
    
    if (!pubkey || !subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Invalid subscription data' });
    }
    
    // Store the subscription in Azure Table Storage
    await tableStorage.upsertEntity(pubkey, 'notification-subscription', {
      subscription: JSON.stringify(subscription),
      endpoint: subscription.endpoint,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    
    logger.info(`Web Push subscription saved for user ${pubkey}`);
    
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
    const { pubkey } = req.params;
    const settings = req.body;
    
    if (!pubkey) {
      return res.status(400).json({ error: 'Invalid pubkey' });
    }
    
    // Check if user has premium subscription for custom filters
    const isPremium = await tableStorage.hasPremiumSubscription(pubkey);
    
    // Non-premium users can only update basic settings
    if (!isPremium && settings.filters) {
      return res.status(403).json({ 
        error: 'Custom filters are only available for premium subscribers'
      });
    }
    
    // Store the settings
    await tableStorage.upsertEntity(pubkey, 'notification-settings', {
      ...settings,
      updatedAt: new Date().toISOString()
    });
    
    logger.info(`Notification settings updated for user ${pubkey}`);
    
    res.status(200).json({
      success: true,
      message: 'Notification settings updated successfully',
      isPremium
    });
  } catch (error) {
    logger.error(`Error updating notification settings: ${error.message}`);
    res.status(500).json({ error: 'Failed to update notification settings' });
  }
});

/**
 * Get user notification settings
 * @route GET /api/subscription/settings/:pubkey
 */
router.get('/settings/:pubkey', async (req, res) => {
  try {
    const { pubkey } = req.params;
    
    if (!pubkey) {
      return res.status(400).json({ error: 'Invalid pubkey' });
    }
    
    // Get user settings
    const settings = await tableStorage.getEntity(pubkey, 'notification-settings');
    
    // Check if user has premium subscription
    const isPremium = await tableStorage.hasPremiumSubscription(pubkey);
    
    if (!settings) {
      return res.status(200).json({
        enabled: true, // Default value
        isPremium
      });
    }
    
    // Remove internal fields
    const { partitionKey, rowKey, timestamp, ...userSettings } = settings;
    
    res.status(200).json({
      ...userSettings,
      isPremium
    });
  } catch (error) {
    logger.error(`Error getting notification settings: ${error.message}`);
    res.status(500).json({ error: 'Failed to get notification settings' });
  }
});

/**
 * Delete user's subscription
 * @route DELETE /api/subscription/webpush/:pubkey
 */
router.delete('/webpush/:pubkey', async (req, res) => {
  try {
    const { pubkey } = req.params;
    
    if (!pubkey) {
      return res.status(400).json({ error: 'Invalid pubkey' });
    }
    
    const entity = await tableStorage.getEntity(pubkey, 'notification-subscription');
    
    if (!entity) {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    
    // Delete the subscription from Azure Table Storage
    await tableStorage.tableClient.deleteEntity(pubkey, 'notification-subscription');
    
    logger.info(`Web Push subscription deleted for user ${pubkey}`);
    
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
