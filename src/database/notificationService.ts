import RepositoryFactory from './RepositoryFactory';
import { NotificationSubscription } from '../models/notificationSubscription';
import { NotificationSettings } from '../models/notificationSettings';
import { NotificationLog } from '../models/notificationLog';

/**
 * Unified service for notification-related database operations
 * Uses PostgreSQL via RepositoryFactory
 */
class NotificationService {
  // Subscription methods
  async upsertEntity(pubkey: string, deviceKey: string, data: { subscription: string }): Promise<NotificationSubscription> {
    const subscription = JSON.parse(data.subscription);
    const repo = RepositoryFactory.getNotificationSubscriptionRepository();
    return await repo.createSubscription(pubkey, subscription);
  }

  async getUserEntities(pubkey: string): Promise<Array<{ partitionKey: string; subscription: string; rowKey: string; timestamp?: number; created?: number }>> {
    const repo = RepositoryFactory.getNotificationSubscriptionRepository();
    const subscriptions = await repo.getSubscriptionsByPubkey(pubkey);

    // Map to the old tableStorage format for compatibility
    return subscriptions.map(sub => ({
      partitionKey: sub.pubkey,
      subscription: JSON.stringify(sub.subscription),
      rowKey: sub.deviceKey,
      timestamp: sub.modified,
      created: sub.created
    }));
  }

  async getUserSubscriptions(pubkey: string): Promise<Array<{ subscription: string; rowKey: string; timestamp?: number; created?: number }>> {
    const repo = RepositoryFactory.getNotificationSubscriptionRepository();
    const subscriptions = await repo.getSubscriptionsByPubkey(pubkey);

    // Map to the old format for compatibility
    return subscriptions.map(sub => ({
      subscription: JSON.stringify(sub.subscription),
      rowKey: sub.deviceKey,
      timestamp: sub.modified,
      created: sub.created
    }));
  }

  async getEntity(pubkey: string, deviceKey: string): Promise<{ subscription: string } | null> {
    if (deviceKey === "notification-settings") {
      // Handle settings request
      const settingsRepo = RepositoryFactory.getNotificationSettingsRepository();
      const settings = await settingsRepo.getSettings(pubkey);
      return settings ? { subscription: JSON.stringify(settings) } : null;
    }

    const repo = RepositoryFactory.getNotificationSubscriptionRepository();
    const subscription = await repo.getSubscriptionByDeviceKey(pubkey, deviceKey);
    return subscription ? { subscription: JSON.stringify(subscription.subscription) } : null;
  }

  async deleteEntity(pubkey: string, deviceKey: string): Promise<void> {
    const repo = RepositoryFactory.getNotificationSubscriptionRepository();
    await repo.deleteSubscription(pubkey, deviceKey);
  }

  async getAllUserPubkeys(): Promise<string[]> {
    const repo = RepositoryFactory.getNotificationSubscriptionRepository();
    const subscriptions = await repo.getAllSubscriptions();
    // Extract unique pubkeys
    const uniquePubkeys = [...new Set(subscriptions.map(sub => sub.pubkey))];
    return uniquePubkeys;
  }

  // Settings methods
  async upsertNotificationSettings(pubkey: string, settingsData: any): Promise<NotificationSettings> {
    const repo = RepositoryFactory.getNotificationSettingsRepository();
    return await repo.upsertSettings(pubkey, settingsData);
  }

  async getNotificationSettings(pubkey: string): Promise<any> {
    const repo = RepositoryFactory.getNotificationSettingsRepository();
    const settings = await repo.getSettings(pubkey);
    if (!settings) {
      return null;
    }

    // Return in the old format for compatibility
    const { id, type, created, modified, ...settingsData } = settings;
    return {
      partitionKey: settings.pubkey,
      rowKey: 'notification-settings',
      timestamp: settings.modified,
      ...settingsData
    };
  }

  // Premium and notification count methods
  async hasPremiumSubscription(pubkey: string): Promise<boolean> {
    const repo = RepositoryFactory.getAccountRepository();
    return await repo.hasPremiumSubscription(pubkey);
  }

  async get24HourNotificationCount(pubkey: string): Promise<number> {
    // Note: This functionality needs to be implemented in a PostgreSQL repository
    // For now, return 0 as a placeholder
    return 0;
  }

  async logNotification(pubkey: string, notificationData: any): Promise<NotificationLog> {
    // Note: This functionality needs to be implemented in a PostgreSQL repository
    // For now, return a placeholder
    return {
      id: '',
      type: 'notification-log',
      pubkey,
      ...notificationData,
      created: Date.now(),
      modified: Date.now()
    };
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
