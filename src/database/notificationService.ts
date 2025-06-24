import notificationSubscriptionRepository from './notificationSubscriptionRepository';
import notificationSettingsRepository from './notificationSettingsRepository';
import notificationLogRepository from './notificationLogRepository';
import accountRepository from './accountRepositoryCosmosDb';
import { NotificationSubscription } from '../models/notificationSubscription';
import { NotificationSettings } from '../models/notificationSettings';
import { NotificationLog } from '../models/notificationLog';

/**
 * Unified service for notification-related database operations
 * Replaces the old tableStorage utility for CosmosDB
 */
class NotificationService {

  // Subscription methods
  async upsertEntity(pubkey: string, deviceKey: string, data: { subscription: string }): Promise<NotificationSubscription> {
    const subscription = JSON.parse(data.subscription);
    return await notificationSubscriptionRepository.createSubscription(pubkey, subscription);
  }

  async getUserEntities(pubkey: string): Promise<Array<{ partitionKey: string; subscription: string; rowKey: string; timestamp?: number; created?: number }>> {
    const subscriptions = await notificationSubscriptionRepository.getUserSubscriptions(pubkey);

    // Map to the old tableStorage format for compatibility
    return subscriptions.map(sub => ({
      partitionKey: sub.pubkey,
      subscription: JSON.stringify(sub.subscription),
      rowKey: sub.deviceKey,
      timestamp: sub.updated,
      created: sub.created
    }));
  }

  async getUserSubscriptions(pubkey: string): Promise<Array<{ subscription: string; rowKey: string; timestamp?: number; created?: number }>> {
    const subscriptions = await notificationSubscriptionRepository.getUserSubscriptions(pubkey);

    // Map to the old format for compatibility
    return subscriptions.map(sub => ({
      subscription: JSON.stringify(sub.subscription),
      rowKey: sub.deviceKey,
      timestamp: sub.updated,
      created: sub.created
    }));
  }

  async getEntity(pubkey: string, deviceKey: string): Promise<{ subscription: string } | null> {
    if (deviceKey === "notification-settings") {
      // Handle settings request
      const settings = await notificationSettingsRepository.getSettings(pubkey);
      return settings ? { subscription: JSON.stringify(settings) } : null;
    }

    const subscription = await notificationSubscriptionRepository.getSubscriptionByDeviceKey(pubkey, deviceKey);
    return subscription ? { subscription: JSON.stringify(subscription.subscription) } : null;
  }

  async deleteEntity(pubkey: string, deviceKey: string): Promise<void> {
    await notificationSubscriptionRepository.deleteSubscription(pubkey, deviceKey);
  }

  async getAllUserPubkeys(): Promise<string[]> {
    return await notificationSubscriptionRepository.getAllUserPubkeys();
  }

  // Settings methods
  async upsertNotificationSettings(pubkey: string, settingsData: any): Promise<NotificationSettings> {
    return await notificationSettingsRepository.upsertSettings(pubkey, settingsData);
  }

  async getNotificationSettings(pubkey: string): Promise<any> {
    const settings = await notificationSettingsRepository.getSettings(pubkey);
    if (!settings) {
      return null;
    }

    // Return in the old format for compatibility
    const { id, type, created, updated, ...settingsData } = settings;
    return {
      partitionKey: settings.pubkey,
      rowKey: 'notification-settings',
      timestamp: settings.updated,
      ...settingsData
    };
  }

  // Premium and notification count methods
  async hasPremiumSubscription(pubkey: string): Promise<boolean> {
    return await accountRepository.hasPremiumSubscription(pubkey);
  }

  async get24HourNotificationCount(pubkey: string): Promise<number> {
    return await notificationLogRepository.get24HourNotificationCount(pubkey);
  }

  async logNotification(pubkey: string, notificationData: any): Promise<NotificationLog> {
    return await notificationLogRepository.logNotification(pubkey, notificationData);
  }

  // Compatibility method for the table client (used in delete operations)
  get tableClient() {
    return {
      deleteEntity: async (pubkey: string, deviceKey: string) => {
        await this.deleteEntity(pubkey, deviceKey);
      }
    };
  }
}

export default new NotificationService();
