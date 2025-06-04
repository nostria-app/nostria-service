const BaseTableStorageService = require('./BaseTableStorageService');
const logger = require('./logger');

class UserActivityTableService extends BaseTableStorageService {
  constructor() {
    super(process.env.USER_ACTIVITY_TABLE_NAME || "useractivity");
  }

  async logUserActivity(pubkey, activity, details = {}) {
    const timestamp = new Date().toISOString();
    const rowKey = `activity-${timestamp}`;

    const entity = {
      activity,
      details,
      timestamp
    };

    return this.upsertEntity(pubkey, rowKey, entity);
  }

  async getUserActivity(pubkey, limit = 50, activityType = null) {
    try {
      let query = `PartitionKey eq '${pubkey}'`;
      if (activityType) {
        query += ` and activity eq '${activityType}'`;
      }

      const entities = await this.queryEntities(query);
      
      // Sort by timestamp in descending order
      const sortedActivities = entities
        .filter(entity => entity.rowKey.startsWith('activity-'))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      return sortedActivities.slice(0, limit);
    } catch (error) {
      logger.error(`Error getting user activity for ${pubkey}: ${error.message}`);
      throw error;
    }
  }

  async getUserActivityAnalytics(pubkey, days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const startTimestamp = startDate.toISOString();

      const query = `PartitionKey eq '${pubkey}' and timestamp ge '${startTimestamp}'`;
      const entities = await this.queryEntities(query);

      // Group activities by type and count occurrences
      const activityCounts = entities.reduce((acc, entity) => {
        const activity = entity.activity;
        acc[activity] = (acc[activity] || 0) + 1;
        return acc;
      }, {});

      // Calculate daily activity
      const dailyActivity = entities.reduce((acc, entity) => {
        const date = entity.timestamp.split('T')[0];
        acc[date] = (acc[date] || 0) + 1;
        return acc;
      }, {});

      return {
        totalActivities: entities.length,
        activityCounts,
        dailyActivity
      };
    } catch (error) {
      logger.error(`Error getting user activity analytics for ${pubkey}: ${error.message}`);
      throw error;
    }
  }
}

module.exports = {
  UserActivityTableService,
  userActivityService: new UserActivityTableService(),
}