const BaseTableStorageService = require('./BaseTableStorageService');
const logger = require('./logger');

class AccountsTableService extends BaseTableStorageService {
  constructor() {
    super(process.env.TABLE_NAME || "accounts");
  }

  async getUserEntities(pubkey) {
    return this.queryEntities(`PartitionKey eq '${pubkey}'`);
  }

  async getUserSubscriptions(pubkey) {
    try {
      const entities = await this.getUserEntities(pubkey);
      return entities.filter(entity => entity.subscription);
    } catch (error) {
      logger.error(`Error getting user subscriptions for ${pubkey}: ${error.message}`);
      return [];
    }
  }

  async get24HourNotificationCount(pubkey) {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const entities = await this.queryEntities(
        `PartitionKey eq '${pubkey}' and rowKey ge 'notification-${yesterday.toISOString()}'`
      );

      return entities.filter(entity => entity.rowKey.startsWith('notification-')).length;
    } catch (error) {
      logger.error(`Error getting 24-hour notification count for user ${pubkey}: ${error.message}`);
      throw error;
    }
  }

  async logNotification(pubkey, notification) {
    const timestamp = new Date().toISOString();
    const rowKey = `notification-${timestamp}`;

    return this.upsertEntity(pubkey, rowKey, {
      content: notification.content,
      template: notification.template,
      sentAt: timestamp
    });
  }
}

// Export both the class and a singleton instance
module.exports = {
  AccountsTableService,
  accountsService: new AccountsTableService()
}; 