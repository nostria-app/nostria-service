import webpush from 'web-push';
import fs from 'fs';
import path from 'path';
import logger from './logger';
import notificationService from '../database/notificationService';

interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface NotificationPayload {
  title?: string;
  body?: string;
  content?: string;
  template?: string;
  icon?: string;
  url?: string;
  timestamp?: string;
  data?: any;
  notification?: {
    title: string;
    body: string;
    icon: string;
    data?: any;
  };
}

interface WebPushResult {
  statusCode?: number;
  error?: string;
}

interface NotificationSettings {
  enabled?: boolean;
  filters?: {
    excludeKeywords?: string[];
  };
}

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
  private initializeVapidKeys(): void {
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
   * @param subscription - Push subscription object
   * @param payload - Notification payload
   * @returns Web Push send result
   */
  async sendNotification(subscription: PushSubscription, payload: NotificationPayload): Promise<WebPushResult> {
    try {
      const result = await webpush.sendNotification(
        subscription,
        JSON.stringify(payload)
      );

      console.log('Push notification sent successfully', result);
      logger.debug('Push notification sent successfully', result);
      
      return result as WebPushResult;
    } catch (error: any) {
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
   * @param template - Notification template
   * @param args - Template arguments
   * @returns Processed notification content
   */
  processTemplate(template: string, args?: Record<string, any>): string {
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
   * @param pubkey - User's public key
   * @param notification - Notification data
   */
  async logNotificationToFile(pubkey: string, notification: NotificationPayload): Promise<void> {
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
    await notificationService.logNotification(pubkey, notification);
  }

  /**
   * Check if user can receive notifications based on their tier
   * @param pubkey - User's public key
   * @returns True if user can receive more notifications
   */  async canReceiveNotification(pubkey: string): Promise<boolean> {
    try {
      const isPremium = await notificationService.hasPremiumSubscription(pubkey);
      const notificationCount = await notificationService.get24HourNotificationCount(pubkey);
      
      const limit = isPremium 
        ? parseInt(process.env.PREMIUM_TIER_DAILY_LIMIT || '50') 
        : parseInt(process.env.FREE_TIER_DAILY_LIMIT || '5');
      
      return notificationCount < limit;
    } catch (error) {
      logger.error(`Error checking notification limits for user ${pubkey}: ${(error as Error).message}`);
      return false; // Default to not allowing on error
    }
  }

  /**
   * Get user notification settings and filters
   * @param pubkey - User's public key
   * @returns User's notification settings
   */  async getUserNotificationSettings(pubkey: string): Promise<NotificationSettings> {
    try {
      const settings = await notificationService.getEntity(pubkey, "notification-settings");
      return settings as NotificationSettings || { enabled: true }; // Default settings if none exist
    } catch (error) {
      logger.error(`Error getting notification settings for user ${pubkey}: ${(error as Error).message}`);
      return { enabled: true }; // Default settings on error
    }
  }

  /**
   * Check if notification passes user's custom filters
   * @param pubkey - User's public key
   * @param notification - Notification data
   * @returns True if notification passes filters
   */  async passesCustomFilters(pubkey: string, notification: NotificationPayload): Promise<boolean> {
    try {
      const isPremium = await notificationService.hasPremiumSubscription(pubkey);
      
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
        const content = (notification.content || '').toLowerCase();
        for (const keyword of settings.filters.excludeKeywords) {
          if (content.includes(keyword.toLowerCase())) {
            logger.debug(`Notification filtered out by keyword '${keyword}' for user ${pubkey}`);
            return false;
          }
        }
      }
      
      return true;
    } catch (error) {
      logger.error(`Error checking custom filters for user ${pubkey}: ${(error as Error).message}`);
      return true; // Default to allowing on error
    }
  }
}

export default new WebPushService();
