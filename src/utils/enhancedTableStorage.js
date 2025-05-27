const { TableClient, TableServiceClient, odata } = require("@azure/data-tables");
const { DefaultAzureCredential } = require("@azure/identity");
const logger = require('./logger');

/**
 * Enhanced service for interacting with Azure Table Storage
 * Manages multiple tables for accounts, subscriptions, payments, and admin audit
 */
class EnhancedTableStorageService {
  constructor() {
    this.tableName = process.env.TABLE_NAME || "accounts";
    this.subscriptionsTableName = process.env.SUBSCRIPTIONS_TABLE_NAME || "subscriptions";
    this.paymentsTableName = process.env.PAYMENTS_TABLE_NAME || "payments";
    this.adminAuditTableName = process.env.ADMIN_AUDIT_TABLE_NAME || "adminaudit";
    this.subscriptionHistoryTableName = process.env.SUBSCRIPTION_HISTORY_TABLE_NAME || "subscriptionhistory";
    this.userActivityTableName = process.env.USER_ACTIVITY_TABLE_NAME || "useractivity";
    this.initializeClient();
  }

  /**
   * Initialize Azure Table Storage clients for all tables
   */
  initializeClient() {
    try {
      if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
        // Use connection string if available (development)
        this.serviceClient = TableServiceClient.fromConnectionString(
          process.env.AZURE_STORAGE_CONNECTION_STRING
        );
        this.tableClient = TableClient.fromConnectionString(
          process.env.AZURE_STORAGE_CONNECTION_STRING,
          this.tableName
        );        this.subscriptionsClient = TableClient.fromConnectionString(
          process.env.AZURE_STORAGE_CONNECTION_STRING,
          this.subscriptionsTableName
        );
        this.paymentsClient = TableClient.fromConnectionString(
          process.env.AZURE_STORAGE_CONNECTION_STRING,
          this.paymentsTableName
        );
        this.adminAuditClient = TableClient.fromConnectionString(
          process.env.AZURE_STORAGE_CONNECTION_STRING,
          this.adminAuditTableName
        );        this.subscriptionHistoryClient = TableClient.fromConnectionString(
          process.env.AZURE_STORAGE_CONNECTION_STRING,
          this.subscriptionHistoryTableName
        );
        this.userActivityClient = TableClient.fromConnectionString(
          process.env.AZURE_STORAGE_CONNECTION_STRING,
          this.userActivityTableName
        );
      } else {
        // Use managed identity (preferred for production)
        const credential = new DefaultAzureCredential();
        const accountName = process.env.AZURE_STORAGE_ACCOUNT;

        if (!accountName) {
          throw new Error("AZURE_STORAGE_ACCOUNT environment variable is required when using managed identity");
        }        const accountUrl = `https://${accountName}.table.core.windows.net`;
        this.serviceClient = new TableServiceClient(accountUrl, credential);
        this.tableClient = new TableClient(accountUrl, this.tableName, credential);        this.subscriptionsClient = new TableClient(accountUrl, this.subscriptionsTableName, credential);
        this.paymentsClient = new TableClient(accountUrl, this.paymentsTableName, credential);
        this.adminAuditClient = new TableClient(accountUrl, this.adminAuditTableName, credential);
        this.subscriptionHistoryClient = new TableClient(accountUrl, this.subscriptionHistoryTableName, credential);
        this.userActivityClient = new TableClient(accountUrl, this.userActivityTableName, credential);
      }

      this.ensureAllTablesExist();

      logger.info(`Table Storage clients initialized for tables: ${this.tableName}, ${this.subscriptionsTableName}, ${this.paymentsTableName}, ${this.adminAuditTableName}, ${this.subscriptionHistoryTableName}, ${this.userActivityTableName}`);
    } catch (error) {
      logger.error(`Failed to initialize Table Storage clients: ${error.message}`);
      throw error;
    }
  }

  /**
   * Ensure all tables exist, create if they don't
   */
  async ensureAllTablesExist() {
    const tables = [
      this.tableName,
      this.subscriptionsTableName,
      this.paymentsTableName,
      this.adminAuditTableName,
      this.subscriptionHistoryTableName,
      this.userActivityTableName
    ];

    for (const tableName of tables) {
      try {
        await this.serviceClient.createTable(tableName);
        logger.info(`Table '${tableName}' created or already exists`);
      } catch (error) {
        // If table already exists, that's fine
        if (error.statusCode !== 409) {
          logger.error(`Error ensuring table '${tableName}' exists: ${error.message}`);
          throw error;
        }
      }
    }
  }

  // ========================================
  // ACCOUNTS TABLE OPERATIONS
  // ========================================

  /**
   * Store entity in the accounts table
   * @param {string} partitionKey - User's pubkey
   * @param {string} rowKey - Entity type
   * @param {object} data - Entity data
   * @returns {Promise<object>} - The stored entity
   */
  async upsertEntity(partitionKey, rowKey, data) {
    return this._upsertEntity(this.tableClient, partitionKey, rowKey, data);
  }

  /**
   * Get entity from the accounts table
   * @param {string} partitionKey - User's pubkey
   * @param {string} rowKey - Entity type
   * @returns {Promise<object|null>} - The retrieved entity or null if not found
   */
  async getEntity(partitionKey, rowKey) {
    return this._getEntity(this.tableClient, partitionKey, rowKey);
  }

  /**
   * Query entities from the accounts table
   * @param {string} query - OData filter query
   * @returns {Promise<Array>} - Array of entities
   */
  async queryEntities(query) {
    return this._queryEntities(this.tableClient, query);
  }

  /**
   * Get all entities for a specific user (partition)
   * @param {string} partitionKey - User's pubkey
   * @returns {Promise<Array>} - Array of entities
   */
  async getUserEntities(partitionKey) {
    return this.queryEntities(`PartitionKey eq '${partitionKey}'`);
  }

  /**
   * Get all subscription entities for a user
   * @param {string} pubkey - User's public key
   * @returns {Promise<Array>} - Array of subscription entities
   */
  async getUserSubscriptions(pubkey) {
    try {
      const entities = await this.getUserEntities(pubkey);
      // Filter to only include entities that have subscription data
      return entities.filter(entity => entity.subscription);
    } catch (error) {
      logger.error(`Error getting user subscriptions for ${pubkey}: ${error.message}`);
      return [];
    }
  }

  /**
   * Get notification count for user within the past 24 hours
   * @param {string} pubkey - User's pubkey
   * @returns {Promise<number>} - Count of notifications
   */
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

  /**
   * Log a notification that was sent
   * @param {string} pubkey - User's pubkey
   * @param {object} notification - Notification data
   * @returns {Promise<object>} - The stored entity
   */
  async logNotification(pubkey, notification) {
    const timestamp = new Date().toISOString();
    const rowKey = `notification-${timestamp}`;

    return this.upsertEntity(pubkey, rowKey, {
      content: notification.content,
      template: notification.template,
      sentAt: timestamp
    });
  }

  // ========================================
  // SUBSCRIPTIONS TABLE OPERATIONS
  // ========================================

  /**
   * Create or update a subscription
   * @param {string} pubkey - User's public key
   * @param {object} subscriptionData - Subscription details
   * @returns {Promise<object>} - The stored subscription
   */
  async upsertSubscription(pubkey, subscriptionData) {
    const entity = {
      partitionKey: pubkey,
      rowKey: 'current',
      ...subscriptionData,
      updatedAt: new Date().toISOString()
    };

    return this._upsertEntity(this.subscriptionsClient, pubkey, 'current', entity);
  }

  /**
   * Get current subscription for a user
   * @param {string} pubkey - User's public key
   * @returns {Promise<object|null>} - Current subscription or null
   */
  async getCurrentSubscription(pubkey) {
    return this._getEntity(this.subscriptionsClient, pubkey, 'current');
  }

  /**
   * Check if a user has an active premium subscription
   * @param {string} pubkey - User's pubkey
   * @returns {Promise<object>} - Subscription status object
   */
  async getSubscriptionStatus(pubkey) {
    try {
      const subscription = await this.getCurrentSubscription(pubkey);

      if (!subscription) {
        return {
          hasSubscription: false,
          isPremium: false,
          isPremiumPlus: false,
          isActive: false,
          tier: 'free',
          expiryDate: null
        };
      }

      const now = new Date();
      const expiryDate = subscription.expiryDate ? new Date(subscription.expiryDate) : null;
      const isActive = expiryDate ? expiryDate > now : false;

      return {
        hasSubscription: true,
        isPremium: subscription.tier === 'premium' && isActive,
        isPremiumPlus: subscription.tier === 'premium_plus' && isActive,
        isActive,
        tier: isActive ? subscription.tier : 'free',
        expiryDate: subscription.expiryDate,
        billingCycle: subscription.billingCycle,
        autoRenew: subscription.autoRenew || false
      };
    } catch (error) {
      logger.error(`Error checking subscription status for user ${pubkey}: ${error.message}`);
      return {
        hasSubscription: false,
        isPremium: false,
        isPremiumPlus: false,
        isActive: false,
        tier: 'free',
        expiryDate: null
      };
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async hasPremiumSubscription(pubkey) {
    const status = await this.getSubscriptionStatus(pubkey);
    return status.isPremium || status.isPremiumPlus;
  }

  // ========================================
  // PAYMENTS TABLE OPERATIONS
  // ========================================

  /**
   * Record a payment
   * @param {string} pubkey - User's public key
   * @param {object} paymentData - Payment details
   * @returns {Promise<object>} - The stored payment record
   */
  async recordPayment(pubkey, paymentData) {
    const paymentId = `payment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const entity = {
      partitionKey: pubkey,
      rowKey: paymentId,
      ...paymentData,
      createdAt: new Date().toISOString()
    };

    return this._upsertEntity(this.paymentsClient, pubkey, paymentId, entity);
  }

  /**
   * Get payment history for a user
   * @param {string} pubkey - User's public key
   * @param {number} limit - Maximum number of payments to return
   * @returns {Promise<Array>} - Array of payment records
   */
  async getPaymentHistory(pubkey, limit = 50) {
    try {
      const query = `PartitionKey eq '${pubkey}'`;
      const entities = await this._queryEntities(this.paymentsClient, query);
      
      // Sort by creation date descending and limit results
      return entities
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);
    } catch (error) {
      logger.error(`Error getting payment history for user ${pubkey}: ${error.message}`);
      return [];
    }
  }

  // ========================================
  // ADMIN AUDIT TABLE OPERATIONS
  // ========================================

  /**
   * Log an admin action for audit purposes
   * @param {string} adminPubkey - Admin's public key
   * @param {string} action - Action performed
   * @param {object} details - Additional details about the action
   * @param {string} targetPubkey - Target user's pubkey (if applicable)
   * @returns {Promise<object>} - The stored audit log
   */
  async logAdminAction(adminPubkey, action, details = {}, targetPubkey = null) {
    const auditId = `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const entity = {
      partitionKey: adminPubkey,
      rowKey: auditId,
      action,
      details: JSON.stringify(details),
      targetPubkey,
      timestamp: new Date().toISOString(),
      ipAddress: details.ipAddress || 'unknown'
    };

    logger.info(`Admin action logged: ${adminPubkey} performed ${action}${targetPubkey ? ` on ${targetPubkey}` : ''}`);
    return this._upsertEntity(this.adminAuditClient, adminPubkey, auditId, entity);
  }

  /**
   * Get admin audit logs
   * @param {string} adminPubkey - Admin's public key (optional, if null gets all)
   * @param {number} limit - Maximum number of logs to return
   * @returns {Promise<Array>} - Array of audit logs
   */
  async getAdminAuditLogs(adminPubkey = null, limit = 100) {
    try {
      let query = '';
      if (adminPubkey) {
        query = `PartitionKey eq '${adminPubkey}'`;
      }

      const entities = await this._queryEntities(this.adminAuditClient, query);
      
      // Sort by timestamp descending and limit results
      return entities
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit)
        .map(entity => ({
          ...entity,
          details: entity.details ? JSON.parse(entity.details) : {}
        }));
    } catch (error) {
      logger.error(`Error getting admin audit logs: ${error.message}`);
      return [];
    }
  }

  // ========================================
  // SUBSCRIPTION HISTORY TABLE OPERATIONS
  // ========================================

  /**
   * Record a subscription change for audit purposes
   * @param {string} pubkey - User's public key
   * @param {object} changeData - Details of the subscription change
   * @returns {Promise<object>} - The stored history record
   */
  async recordSubscriptionHistory(pubkey, changeData) {
    const historyId = `history-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const entity = {
      partitionKey: pubkey,
      rowKey: historyId,
      ...changeData,
      timestamp: new Date().toISOString()
    };

    return this._upsertEntity(this.subscriptionHistoryClient, pubkey, historyId, entity);
  }

  /**
   * Get subscription history for a user
   * @param {string} pubkey - User's public key
   * @param {number} limit - Maximum number of history records to return
   * @returns {Promise<Array>} - Array of subscription history records
   */
  async getSubscriptionHistory(pubkey, limit = 25) {
    try {
      const query = `PartitionKey eq '${pubkey}'`;
      const entities = await this._queryEntities(this.subscriptionHistoryClient, query);
      
      // Sort by timestamp descending and limit results
      return entities
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);
    } catch (error) {
      logger.error(`Error getting subscription history for user ${pubkey}: ${error.message}`);
      return [];
    }
  }

  // ========================================
  // USER ACTIVITY TABLE OPERATIONS
  // ========================================

  /**
   * Log user activity for analytics and audit purposes
   * @param {string} pubkey - User's public key
   * @param {string} activity - Type of activity
   * @param {object} details - Additional details about the activity
   * @returns {Promise<object>} - The stored activity log
   */
  async logUserActivity(pubkey, activity, details = {}) {
    const activityId = `activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const entity = {
      partitionKey: pubkey,
      rowKey: activityId,
      activity,
      details: JSON.stringify(details),
      timestamp: new Date().toISOString(),
      ipAddress: details.ipAddress || 'unknown',
      userAgent: details.userAgent || 'unknown'
    };

    return this._upsertEntity(this.userActivityClient, pubkey, activityId, entity);
  }

  /**
   * Get user activity logs
   * @param {string} pubkey - User's public key
   * @param {number} limit - Maximum number of activity logs to return
   * @param {string} activityType - Filter by specific activity type (optional)
   * @returns {Promise<Array>} - Array of activity logs
   */
  async getUserActivity(pubkey, limit = 50, activityType = null) {
    try {
      let query = `PartitionKey eq '${pubkey}'`;
      if (activityType) {
        query += ` and activity eq '${activityType}'`;
      }

      const entities = await this._queryEntities(this.userActivityClient, query);
      
      // Sort by timestamp descending and limit results
      return entities
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit)
        .map(entity => ({
          ...entity,
          details: entity.details ? JSON.parse(entity.details) : {}
        }));
    } catch (error) {
      logger.error(`Error getting user activity for ${pubkey}: ${error.message}`);
      return [];
    }
  }

  /**
   * Get activity analytics for a user (summary data)
   * @param {string} pubkey - User's public key
   * @param {number} days - Number of days to look back (default 30)
   * @returns {Promise<object>} - Activity analytics object
   */
  async getUserActivityAnalytics(pubkey, days = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      
      const query = `PartitionKey eq '${pubkey}' and timestamp ge '${cutoffDate.toISOString()}'`;
      const entities = await this._queryEntities(this.userActivityClient, query);
      
      // Aggregate activity data
      const analytics = {
        totalActivities: entities.length,
        activitiesByType: {},
        activitiesByDay: {},
        lastActivity: null
      };

      if (entities.length > 0) {
        // Sort by timestamp to get the latest activity
        entities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        analytics.lastActivity = entities[0].timestamp;

        // Count activities by type
        entities.forEach(entity => {
          const activityType = entity.activity;
          analytics.activitiesByType[activityType] = (analytics.activitiesByType[activityType] || 0) + 1;

          // Count activities by day
          const day = entity.timestamp.split('T')[0];
          analytics.activitiesByDay[day] = (analytics.activitiesByDay[day] || 0) + 1;
        });
      }

      return analytics;
    } catch (error) {
      logger.error(`Error getting user activity analytics for ${pubkey}: ${error.message}`);
      return {
        totalActivities: 0,
        activitiesByType: {},
        activitiesByDay: {},
        lastActivity: null
      };
    }
  }

  // ========================================
  // ENHANCED SUBSCRIPTION METHODS
  // ========================================

  /**
   * Create or update a subscription with history tracking
   * @param {string} pubkey - User's public key
   * @param {object} subscriptionData - Subscription details
   * @param {string} changeReason - Reason for the subscription change
   * @returns {Promise<object>} - The stored subscription
   */
  async upsertSubscriptionWithHistory(pubkey, subscriptionData, changeReason = 'update') {
    // Get current subscription for comparison
    const currentSubscription = await this.getCurrentSubscription(pubkey);
    
    // Update the subscription
    const newSubscription = await this.upsertSubscription(pubkey, subscriptionData);

    // Record the change in history
    const historyData = {
      changeReason,
      previousTier: currentSubscription?.tier || 'none',
      newTier: subscriptionData.tier,
      previousExpiryDate: currentSubscription?.expiryDate || null,
      newExpiryDate: subscriptionData.expiryDate || null,
      billingCycle: subscriptionData.billingCycle,
      changedBy: pubkey
    };

    await this.recordSubscriptionHistory(pubkey, historyData);

    return newSubscription;
  }

  // ========================================
  // PRIVATE HELPER METHODS
  // ========================================

  /**
   * Generic upsert method for any table client
   */
  async _upsertEntity(client, partitionKey, rowKey, data) {
    try {
      const entity = {
        partitionKey,
        rowKey,
        ...data,
        timestamp: new Date(),
      };

      await client.upsertEntity(entity);
      logger.debug(`Entity upserted: [${partitionKey}, ${rowKey}]`);
      return entity;
    } catch (error) {
      logger.error(`Error upserting entity [${partitionKey}, ${rowKey}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generic get method for any table client
   */
  async _getEntity(client, partitionKey, rowKey) {
    try {
      const entity = await client.getEntity(partitionKey, rowKey);
      return entity;
    } catch (error) {
      if (error.statusCode === 404) {
        logger.debug(`Entity not found: [${partitionKey}, ${rowKey}]`);
        return null;
      }

      logger.error(`Error getting entity [${partitionKey}, ${rowKey}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generic query method for any table client
   */
  async _queryEntities(client, query) {
    try {
      const entities = [];
      const queryOptions = query ? { filter: query } : {};

      const iterator = client.listEntities(queryOptions);

      for await (const entity of iterator) {
        entities.push(entity);
      }

      return entities;
    } catch (error) {
      logger.error(`Error querying entities: ${error.message}`);
      throw error;
    }  }
}

// Create singleton instance
const serviceInstance = new EnhancedTableStorageService();

/**
 * Initialize all table clients and return them as an object
 * This function provides access to individual table clients for testing and validation
 * @returns {Promise<object>} - Object containing all initialized table clients
 */
async function initializeTableClients() {
  try {
    // Wait for initialization to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const clients = {
      accounts: serviceInstance.tableClient,
      subscriptions: serviceInstance.subscriptionsClient,
      payments: serviceInstance.paymentsClient,
      adminaudit: serviceInstance.adminAuditClient,
      subscriptionhistory: serviceInstance.subscriptionHistoryClient,
      useractivity: serviceInstance.userActivityClient
    };

    logger.info(`Table Storage clients initialized for tables: ${Object.keys(clients).join(', ')}`);
    return clients;
  } catch (error) {
    logger.error('Failed to initialize table clients:', error);
    throw error;
  }
}

module.exports = serviceInstance;
module.exports.initializeTableClients = initializeTableClients;
