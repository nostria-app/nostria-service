const BaseTableStorageService = require('./BaseTableStorageService');
const logger = require('./logger');

class SubscriptionHistoryTableService extends BaseTableStorageService {
  constructor() {
    super(process.env.SUBSCRIPTION_HISTORY_TABLE_NAME || "subscriptionhistory");
  }

  async recordSubscriptionHistory(pubkey, changeData) {
    const timestamp = new Date().toISOString();
    const rowKey = `change-${timestamp}`;

    const entity = {
      ...changeData,
      timestamp
    };

    return this.upsertEntity(pubkey, rowKey, entity);
  }

  async getSubscriptionHistory(pubkey, limit = 25) {
    try {
      const entities = await this.queryEntities(`PartitionKey eq '${pubkey}'`);
      
      // Sort by timestamp in descending order
      const sortedHistory = entities
        .filter(entity => entity.rowKey.startsWith('change-'))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      return sortedHistory.slice(0, limit);
    } catch (error) {
      logger.error(`Error getting subscription history for ${pubkey}: ${error.message}`);
      throw error;
    }
  }
}

module.exports = {
  SubscriptionHistoryTableService,
  subscriptionHistoryService: new SubscriptionHistoryTableService(),
}