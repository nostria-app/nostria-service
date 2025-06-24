import { NotificationLog } from "../models/notificationLog";
import CosmosDbBaseRepository from "./CosmosDbBaseRepository";
import logger from "../utils/logger";

class NotificationLogRepository extends CosmosDbBaseRepository<NotificationLog> {
  constructor() {
    super('notification-log');
  }

  async logNotification(pubkey: string, notificationData: any): Promise<NotificationLog> {
    try {
      const now = new Date();
      const id = `${pubkey}-${now.getTime()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const logEntity: NotificationLog = {
        id,
        type: 'notification-log',
        pubkey,
        title: notificationData.title,
        body: notificationData.body,
        content: notificationData.content,
        template: notificationData.template,
        timestamp: notificationData.timestamp ? new Date(notificationData.timestamp) : now,
        createdAt: now
      };
      
      return await super.create(logEntity);
    } catch (error) {
      logger.error('Failed to log notification:', error);
      throw new Error(`Failed to log notification: ${(error as Error).message}`);
    }
  }
  async get24HourNotificationCount(pubkey: string): Promise<number> {
    try {
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
      
      const query = {
        query: 'SELECT * FROM c WHERE c.type = @type AND c.pubkey = @pubkey AND c.timestamp >= @since',
        parameters: [
          { name: '@type', value: 'notification-log' },
          { name: '@pubkey', value: pubkey },
          { name: '@since', value: twentyFourHoursAgo.toISOString() }
        ]
      };

      const results = await this.query(query, pubkey);
      return results.length;
    } catch (error) {
      logger.error('Failed to get 24-hour notification count:', error);
      throw new Error(`Failed to get 24-hour notification count: ${(error as Error).message}`);
    }
  }

  async getUserNotificationHistory(pubkey: string, limit: number = 50): Promise<NotificationLog[]> {
    try {
      const query = {
        query: 'SELECT * FROM c WHERE c.type = @type AND c.pubkey = @pubkey ORDER BY c.timestamp DESC OFFSET 0 LIMIT @limit',
        parameters: [
          { name: '@type', value: 'notification-log' },
          { name: '@pubkey', value: pubkey },
          { name: '@limit', value: limit }
        ]
      };

      return await this.query(query, pubkey);
    } catch (error) {
      logger.error('Failed to get user notification history:', error);
      throw new Error(`Failed to get user notification history: ${(error as Error).message}`);
    }
  }
}

export default new NotificationLogRepository();
