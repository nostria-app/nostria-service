import { NotificationSubscription } from "../models/notificationSubscription";
import { PrismaBaseRepository } from "./PrismaBaseRepository";
import logger from "../utils/logger";
import { now } from "../helpers/now";

class PrismaNotificationSubscriptionRepository extends PrismaBaseRepository {
  constructor() {
    super('notification-subscription');
  }

  private transformPrismaNotificationSubscriptionToNotificationSubscription(prismaNotificationSubscription: any): NotificationSubscription {
    return {
      id: prismaNotificationSubscription.id,
      type: 'notification-subscription',
      pubkey: prismaNotificationSubscription.pubkey,
      subscription: prismaNotificationSubscription.subscription,
      deviceKey: prismaNotificationSubscription.deviceKey,
      created: Number(prismaNotificationSubscription.created),
      modified: Number(prismaNotificationSubscription.modified),
    };
  }

  async createSubscription(pubkey: string, subscription: any): Promise<NotificationSubscription> {
    try {
      const deviceKey = subscription.keys.p256dh;
      const id = `notification-subscription-${pubkey}-${deviceKey}`; // Unique ID combining pubkey and device key
      const ts = now();

      const subscriptionData = {
        id: id,
        pubkey,
        subscription: subscription as any,
        deviceKey,
        created: BigInt(ts),
        modified: BigInt(ts)
      };

      const result = await this.prisma.notificationSubscription.create({
        data: subscriptionData
      });

      logger.info(`Created notification subscription: ${id}`);
      return this.transformPrismaNotificationSubscriptionToNotificationSubscription(result);
    } catch (error) {
      this.handlePrismaError(error, 'create');
    }
  }

  async getSubscription(id: string, pubkey: string): Promise<NotificationSubscription | null> {
    try {
      const result = await this.prisma.notificationSubscription.findFirst({
        where: { 
          id: id,
          pubkey: pubkey 
        }
      });

      return result ? this.transformPrismaNotificationSubscriptionToNotificationSubscription(result) : null;
    } catch (error) {
      logger.error('Failed to get notification subscription by id:', error);
      throw new Error(`Failed to get notification subscription: ${(error as Error).message}`);
    }
  }

  async getSubscriptionsByPubkey(pubkey: string): Promise<NotificationSubscription[]> {
    try {
      const results = await this.prisma.notificationSubscription.findMany({
        where: { pubkey },
        orderBy: { created: 'desc' }
      });

      return results.map(result => this.transformPrismaNotificationSubscriptionToNotificationSubscription(result));
    } catch (error) {
      logger.error('Failed to get notification subscriptions by pubkey:', error);
      throw new Error(`Failed to get notification subscriptions: ${(error as Error).message}`);
    }
  }

  async getSubscriptionByDeviceKey(pubkey: string, deviceKey: string): Promise<NotificationSubscription | null> {
    try {
      const result = await this.prisma.notificationSubscription.findFirst({
        where: { 
          pubkey: pubkey,
          deviceKey: deviceKey 
        }
      });

      return result ? this.transformPrismaNotificationSubscriptionToNotificationSubscription(result) : null;
    } catch (error) {
      logger.error('Failed to get notification subscription by device key:', error);
      throw new Error(`Failed to get notification subscription: ${(error as Error).message}`);
    }
  }

  async updateSubscription(subscription: NotificationSubscription): Promise<NotificationSubscription> {
    try {
      const subscriptionData = {
        subscription: subscription.subscription as any,
        deviceKey: subscription.deviceKey,
        modified: BigInt(subscription.modified || now())
      };

      const result = await this.prisma.notificationSubscription.update({
        where: { id: subscription.id },
        data: subscriptionData
      });

      logger.info(`Updated notification subscription: ${subscription.id}`);
      return this.transformPrismaNotificationSubscriptionToNotificationSubscription(result);
    } catch (error) {
      this.handlePrismaError(error, 'update');
    }
  }

  async deleteSubscription(id: string, pubkey: string): Promise<void> {
    try {
      await this.prisma.notificationSubscription.delete({
        where: { id }
      });

      logger.info(`Deleted notification subscription: ${id}`);
    } catch (error) {
      this.handlePrismaError(error, 'delete');
    }
  }

  async deleteSubscriptionsByPubkey(pubkey: string): Promise<void> {
    try {
      await this.prisma.notificationSubscription.deleteMany({
        where: { pubkey }
      });

      logger.info(`Deleted all notification subscriptions for pubkey: ${pubkey}`);
    } catch (error) {
      this.handlePrismaError(error, 'delete');
    }
  }

  // Additional helper methods to match the original interface
  async getAllSubscriptions(limit: number = 100): Promise<NotificationSubscription[]> {
    try {
      const results = await this.prisma.notificationSubscription.findMany({
        orderBy: { created: 'desc' },
        take: limit
      });

      return results.map(result => this.transformPrismaNotificationSubscriptionToNotificationSubscription(result));
    } catch (error) {
      logger.error('Failed to get all notification subscriptions:', error);
      throw new Error(`Failed to get notification subscriptions: ${(error as Error).message}`);
    }
  }
}

export default PrismaNotificationSubscriptionRepository;