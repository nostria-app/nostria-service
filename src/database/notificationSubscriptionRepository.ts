import { NotificationSubscription } from "../models/notificationSubscription";
import CosmosDbBaseRepository from "./CosmosDbBaseRepository";
import logger from "../utils/logger";

class NotificationSubscriptionRepository extends CosmosDbBaseRepository<NotificationSubscription> {
  constructor() {
    super('notification-subscription');
  }

  async createSubscription(pubkey: string, subscription: any): Promise<NotificationSubscription> {
    try {
      const deviceKey = subscription.keys.p256dh;
      const now = new Date();
      
      const subscriptionEntity: NotificationSubscription = {
        id: `${pubkey}-${deviceKey}`, // Unique ID combining pubkey and device key
        type: 'notification-subscription',
        pubkey,
        subscription,
        deviceKey,
        createdAt: now,
        updatedAt: now
      };
      
      return await super.upsert(subscriptionEntity);
    } catch (error) {
      logger.error('Failed to create notification subscription:', error);
      throw new Error(`Failed to create notification subscription: ${(error as Error).message}`);
    }
  }

  async getUserSubscriptions(pubkey: string): Promise<NotificationSubscription[]> {
    try {
      const query = {
        query: 'SELECT * FROM c WHERE c.type = @type AND c.pubkey = @pubkey',
        parameters: [
          { name: '@type', value: 'notification-subscription' },
          { name: '@pubkey', value: pubkey }
        ]
      };

      return await this.query(query, pubkey);
    } catch (error) {
      logger.error('Failed to get user subscriptions:', error);
      throw new Error(`Failed to get user subscriptions: ${(error as Error).message}`);
    }
  }

  async getSubscriptionByDeviceKey(pubkey: string, deviceKey: string): Promise<NotificationSubscription | null> {
    try {
      const id = `${pubkey}-${deviceKey}`;
      return await this.getById(id, pubkey);
    } catch (error) {
      logger.error('Failed to get subscription by device key:', error);
      throw new Error(`Failed to get subscription by device key: ${(error as Error).message}`);
    }
  }

  async deleteSubscription(pubkey: string, deviceKey: string): Promise<void> {
    try {
      const id = `${pubkey}-${deviceKey}`;
      await this.delete(id, pubkey);
    } catch (error) {
      logger.error('Failed to delete subscription:', error);
      throw new Error(`Failed to delete subscription: ${(error as Error).message}`);
    }
  }

  async getAllUserPubkeys(): Promise<string[]> {
    try {
      const query = {
        query: 'SELECT DISTINCT c.pubkey FROM c WHERE c.type = @type',
        parameters: [
          { name: '@type', value: 'notification-subscription' }
        ]
      };

      const results = await this.query(query);
      return results.map(r => r.pubkey);
    } catch (error) {
      logger.error('Failed to get all user pubkeys:', error);
      throw new Error(`Failed to get all user pubkeys: ${(error as Error).message}`);
    }
  }
}

export default new NotificationSubscriptionRepository();
