const BaseTableStorageService = require('./BaseTableStorageService');
const logger = require('./logger');

class AdminAuditTableService extends BaseTableStorageService {
  constructor() {
    super(process.env.ADMIN_AUDIT_TABLE_NAME || "adminaudit");
  }

  async logAdminAction(adminPubkey, action, details = {}, targetPubkey = null) {
    const timestamp = new Date().toISOString();
    const rowKey = `action-${timestamp}`;

    const entity = {
      action,
      details,
      targetPubkey,
      timestamp
    };

    return this.upsertEntity(adminPubkey, rowKey, entity);
  }

  async getAdminAuditLogs(adminPubkey = null, limit = 100) {
    try {
      let query = '';
      if (adminPubkey) {
        query = `PartitionKey eq '${adminPubkey}'`;
      }

      const entities = await this.queryEntities(query);
      
      // Sort by timestamp in descending order
      const sortedLogs = entities
        .filter(entity => entity.rowKey.startsWith('action-'))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      return sortedLogs.slice(0, limit);
    } catch (error) {
      logger.error(`Error getting admin audit logs: ${error.message}`);
      throw error;
    }
  }
}

module.exports = AdminAuditTableService; 