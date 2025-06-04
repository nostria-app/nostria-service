const BaseTableStorageService = require('./BaseTableStorageService');
const logger = require('./logger');

class PaymentsTableService extends BaseTableStorageService {
  constructor() {
    super(process.env.PAYMENTS_TABLE_NAME || "payments");
  }

  async recordPayment(pubkey, paymentData) {
    const timestamp = new Date().toISOString();
    const rowKey = `payment-${timestamp}`;

    const entity = {
      ...paymentData,
      timestamp,
      status: 'completed'
    };

    return this.upsertEntity(pubkey, rowKey, entity);
  }

  async getPaymentHistory(pubkey, limit = 50) {
    try {
      const entities = await this.queryEntities(`PartitionKey eq '${pubkey}'`);
      
      // Sort by timestamp in descending order
      const sortedPayments = entities
        .filter(entity => entity.rowKey.startsWith('payment-'))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      return sortedPayments.slice(0, limit);
    } catch (error) {
      logger.error(`Error getting payment history for ${pubkey}: ${error.message}`);
      throw error;
    }
  }
}

module.exports = {
  PaymentsTableService,
  paymentsService: new PaymentsTableService(),
}
