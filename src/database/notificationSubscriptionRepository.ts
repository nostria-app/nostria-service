import { NotificationSubscription } from "../models/notificationSubscription";
import CosmosDbBaseRepository from "./CosmosDbBaseRepository";
import logger from "../utils/logger";
import { now } from "../helpers/now";

class NotificationSubscriptionRepository extends CosmosDbBaseRepository<NotificationSubscription> {
  constructor() {
    super('notification-subscription');
  }

  async createSubscription(pubkey: string, subscription: any): Promise<NotificationSubscription> {
    try {
      const deviceKey = subscription.keys.p256dh;
      const id = `notification-subscription-${pubkey}-${deviceKey}`; // Unique ID combining pubkey and device key
      const ts = now();

      const subscriptionEntity: NotificationSubscription = {
        id: id,
        type: 'notification-subscription',
        pubkey,
        subscription,
        deviceKey,
        created: ts,
        modified: ts
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
      const id = `notification-subscription-${pubkey}-${deviceKey}`;
      return await this.getById(id, pubkey);
    } catch (error) {
      logger.error('Failed to get subscription by device key:', error);
      throw new Error(`Failed to get subscription by device key: ${(error as Error).message}`);
    }
  }

  async deleteSubscription(pubkey: string, deviceKey: string): Promise<void> {
    try {
      const id = `notification-subscription-${pubkey}-${deviceKey}`;
      await this.delete(id, pubkey);
    } catch (error) {
      logger.error('Failed to delete subscription:', error);
      throw new Error(`Failed to delete subscription: ${(error as Error).message}`);
    }
  }

  async getAllUserPubkeys(): Promise<string[]> {
    try {
      logger.info('[NotificationSubscriptionRepository] Querying for all user pubkeys with type: notification-subscription');
      const query = {
        query: 'SELECT DISTINCT c.pubkey FROM c WHERE c.type = @type',
        parameters: [
          { name: '@type', value: 'notification-subscription' }
        ]
      };

      const results = await this.query(query);
      logger.info(`[NotificationSubscriptionRepository] Query returned ${results.length} distinct pubkeys`);
      
      if (results.length > 0) {
        logger.debug(`[NotificationSubscriptionRepository] First few pubkeys: ${results.slice(0, 3).map(r => r.pubkey).join(', ')}`);
      }
      
      return results.map(r => r.pubkey);
    } catch (error) {
      logger.error('[NotificationSubscriptionRepository] Failed to get all user pubkeys:', error);
      throw new Error(`Failed to get all user pubkeys: ${(error as Error).message}`);
    }
  }

  async getAllSubscriptions(limit: number = 100): Promise<NotificationSubscription[]> {
    try {
      const query = {
        query: 'SELECT * FROM c WHERE c.type = @type ORDER BY c.created DESC OFFSET 0 LIMIT @limit',
        parameters: [
          { name: '@type', value: 'notification-subscription' },
          { name: '@limit', value: limit }
        ]
      };

      return await this.query(query);
    } catch (error) {
      logger.error('Failed to get all subscriptions:', error);
      throw new Error(`Failed to get all subscriptions: ${(error as Error).message}`);
    }
  }
}

export default new NotificationSubscriptionRepository();
