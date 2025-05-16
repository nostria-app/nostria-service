const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const tableStorage = require('./tableStorage');

/**
 * Web Push Notification Service
 */
class WebPushService {
  constructor() {
    this.initializeVapidKeys();
  }

  /**
   * Initialize VAPID keys for Web Push
   */
  initializeVapidKeys() {
    // Set VAPID details
    const vapidPublicKey = process.env.PUBLIC_VAPID_KEY;
    const vapidPrivateKey = process.env.PRIVATE_VAPID_KEY;
    const vapidSubject = process.env.VAPID_SUBJECT;

    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      logger.error('VAPID keys or subject not set in environment variables');
      throw new Error('VAPID keys must be set in environment variables');
    }

    webpush.setVapidDetails(
      vapidSubject,
      vapidPublicKey,
      vapidPrivateKey
    );

    logger.info('VAPID keys initialized for Web Push notifications');
  }

  /**
   * Send notification to a specific subscription
   * @param {object} subscription - Push subscription object
   * @param {object} payload - Notification payload
   * @returns {Promise} - Web Push send result
   */
  async sendNotification(subscription, payload) {
    try {
      const result = await webpush.sendNotification(
        subscription,
        JSON.stringify(payload)
      );
      logger.debug('Push notification sent successfully');
      return result;
    } catch (error) {
      logger.error(`Failed to send push notification: ${error.message}`);
      
      // If subscription is expired or invalid
      if (error.statusCode === 404 || error.statusCode === 410) {
        logger.warn(`Subscription is no longer valid: ${error.statusCode}`);
        // Return specific error for handling expired subscriptions
        return { error: 'expired_subscription', statusCode: error.statusCode };
      }
      
      throw error;
    }
  }

  /**
   * Process template with arguments
   * @param {string} template - Notification template
   * @param {object} args - Template arguments
   * @returns {string} - Processed notification content
   */
  processTemplate(template, args) {
    let content = template;
    
    if (args) {
      Object.keys(args).forEach(key => {
        const placeholder = `{{${key}}}`;
        content = content.replace(new RegExp(placeholder, 'g'), args[key]);
      });
    }
    
    return content;
  }

  /**
   * Log notification to file system
   * @param {string} pubkey - User's public key
   * @param {object} notification - Notification data
   */
  async logNotificationToFile(pubkey, notification) {
    const logDir = path.join(__dirname, '../../data/notifications');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const logFile = path.join(logDir, `${pubkey.substring(0, 8)}_${timestamp}.json`);
    
    const logData = {
      pubkey,
      timestamp,
      notification
    };
    
    fs.writeFile(logFile, JSON.stringify(logData, null, 2), err => {
      if (err) {
        logger.error(`Failed to write notification log: ${err.message}`);
      }
    });
    
    // Also log to database
    await tableStorage.logNotification(pubkey, notification);
  }

  /**
   * Check if user can receive notifications based on their tier
   * @param {string} pubkey - User's public key
   * @returns {Promise<boolean>} - True if user can receive more notifications
   */
  async canReceiveNotification(pubkey) {
    try {
      const isPremium = await tableStorage.hasPremiumSubscription(pubkey);
      const notificationCount = await tableStorage.get24HourNotificationCount(pubkey);
      
      const limit = isPremium 
        ? parseInt(process.env.PREMIUM_TIER_DAILY_LIMIT || 50) 
        : parseInt(process.env.FREE_TIER_DAILY_LIMIT || 5);
      
      return notificationCount < limit;
    } catch (error) {
      logger.error(`Error checking notification limits for user ${pubkey}: ${error.message}`);
      return false; // Default to not allowing on error
    }
  }

  /**
   * Get user notification settings and filters
   * @param {string} pubkey - User's public key
   * @returns {Promise<object>} - User's notification settings
   */
  async getUserNotificationSettings(pubkey) {
    try {
      const settings = await tableStorage.getEntity(pubkey, "notification-settings");
      return settings || { enabled: true }; // Default settings if none exist
    } catch (error) {
      logger.error(`Error getting notification settings for user ${pubkey}: ${error.message}`);
      return { enabled: true }; // Default settings on error
    }
  }

  /**
   * Check if notification passes user's custom filters
   * @param {string} pubkey - User's public key
   * @param {object} notification - Notification data
   * @returns {Promise<boolean>} - True if notification passes filters
   */
  async passesCustomFilters(pubkey, notification) {
    try {
      const isPremium = await tableStorage.hasPremiumSubscription(pubkey);
      
      // If not premium, they can't have custom filters
      if (!isPremium) {
        return true;
      }
      
      const settings = await this.getUserNotificationSettings(pubkey);
      
      // If no settings or no filters, notification passes
      if (!settings || !settings.filters) {
        return true;
      }
      
      // Apply filters logic here
      // This is a simplified example - expand based on your filtering needs
      if (settings.filters.excludeKeywords && settings.filters.excludeKeywords.length > 0) {
        const content = notification.content.toLowerCase();
        for (const keyword of settings.filters.excludeKeywords) {
          if (content.includes(keyword.toLowerCase())) {
            logger.debug(`Notification filtered out by keyword '${keyword}' for user ${pubkey}`);
            return false;
          }
        }
      }
      
      return true;
    } catch (error) {
      logger.error(`Error checking custom filters for user ${pubkey}: ${error.message}`);
      return true; // Default to allowing on error
    }
  }
}

module.exports = new WebPushService();
