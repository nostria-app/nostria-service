import express, { Request, Response } from 'express';
import tableStorage from '../utils/tableStorage';
import webPush from '../utils/webPush';
import logger from '../utils/logger';

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
 * Send notification to users
 * @route POST /api/notification/send
 * Protected by API key
 */
router.post('/send', async (req: Request, res: Response): Promise<void> => {
  try {
    const { pubkeys, template, args, title, body, icon, url }: NotificationRequest = req.body;
    
    // Support both template-based and direct notification formats
    let notificationPayload: NotificationPayload;
    let targetPubkeys = pubkeys;
    
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
        targetPubkeys = await tableStorage.getAllUserPubkeys();
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
        const subscriptionEntities = await tableStorage.getUserSubscriptions(pubkey);
        
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
 * Get notification status for a user
 * @route GET /api/notification/status/:pubkey
 * Protected by API key
 */
router.get('/status/:pubkey', async (req: Request, res: Response): Promise<void> => {
  try {
    const { pubkey } = req.params;
    
    if (!pubkey) {
      res.status(400).json({ error: 'Invalid pubkey' });
      return;
    }

    // Check subscription status - get all user's devices
    const subscriptionEntities = await tableStorage.getUserSubscriptions(pubkey);
    const hasSubscription = subscriptionEntities.length > 0;
    const deviceCount = subscriptionEntities.length;
    
    // Check premium status
    const isPremium = await tableStorage.hasPremiumSubscription(pubkey);
      
    // Get notification settings from the settings table
    const settings = await tableStorage.getNotificationSettings(pubkey);
    
    // Get 24-hour notification count
    const notificationCount = await tableStorage.get24HourNotificationCount(pubkey);
    
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
