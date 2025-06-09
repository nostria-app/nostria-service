const { TableClient, TableServiceClient, odata } = require("@azure/data-tables");
const { DefaultAzureCredential } = require("@azure/identity");
const logger = require('./logger');

/**
 * Service for interacting with Azure Table Storage
 */
class TableStorageService {
  constructor() {
    this.notificationsTableName = process.env.TABLE_NAME || "notifications";
    this.settingsTableName = "settings";
    this.initializeClient();
  }

  /**
   * Initialize Azure Table Storage client
   */
  initializeClient() {
    try {
      if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
        // Use connection string if available (development)
        this.serviceClient = TableServiceClient.fromConnectionString(
          process.env.AZURE_STORAGE_CONNECTION_STRING
        );
        this.notificationsTableClient = TableClient.fromConnectionString(
          process.env.AZURE_STORAGE_CONNECTION_STRING,
          this.notificationsTableName
        );
        this.settingsTableClient = TableClient.fromConnectionString(
          process.env.AZURE_STORAGE_CONNECTION_STRING,
          this.settingsTableName
        );
      } else {
        // Use managed identity (preferred for production)
        const credential = new DefaultAzureCredential();
        const accountName = process.env.AZURE_STORAGE_ACCOUNT;

        if (!accountName) {
          throw new Error("AZURE_STORAGE_ACCOUNT environment variable is required when using managed identity");
        }

        this.serviceClient = new TableServiceClient(
          `https://${accountName}.table.core.windows.net`,
          credential
        );

        this.notificationsTableClient = new TableClient(
          `https://${accountName}.table.core.windows.net`,
          this.notificationsTableName,
          credential
        );

        this.settingsTableClient = new TableClient(
          `https://${accountName}.table.core.windows.net`,
          this.settingsTableName,
          credential
        );
      }

      // For backward compatibility, keep tableClient pointing to notifications table
      this.tableClient = this.notificationsTableClient;

      this.ensureTablesExist();

      logger.info(`Table Storage clients initialized for tables: ${this.notificationsTableName}, ${this.settingsTableName}`);
    } catch (error) {
      logger.error(`Failed to initialize Table Storage client: ${error.message}`);
      throw error;
    }
  }

  /**
   * Ensure the tables exist, create if they don't
   */
  async ensureTablesExist() {
    try {
      // Create notifications table
      await this.serviceClient.createTable(this.notificationsTableName);
      logger.info(`Table '${this.notificationsTableName}' created or already exists`);
      
      // Create settings table
      await this.serviceClient.createTable(this.settingsTableName);
      logger.info(`Table '${this.settingsTableName}' created or already exists`);
    } catch (error) {
      // If table already exists, that's fine
      if (error.statusCode !== 409) {
        logger.error(`Error ensuring tables exist: ${error.message}`);
        throw error;
      }
    }
  }

  /**
   * Ensure the table exists, create if it doesn't
   * @deprecated Use ensureTablesExist() instead
   */
  async ensureTableExists() {
    return this.ensureTablesExist();
  }

  /**
   * Get entity from the table
   * @param {string} partitionKey - User's pubkey
   * @param {string} rowKey - Entity type
   * @returns {Promise<object|null>} - The retrieved entity or null if not found
   */
  async getEntity(partitionKey, rowKey) {
    try {
      const entity = await this.tableClient.getEntity(partitionKey, rowKey);
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
   * Query entities from the table
   * @param {string} query - OData filter query
   * @returns {Promise<Array>} - Array of entities
   */
  async queryEntities(query) {
    try {
      const entities = [];
      const queryOptions = { filter: query };

      const iterator = this.tableClient.listEntities(queryOptions);

      for await (const entity of iterator) {
        entities.push(entity);
      }

      return entities;
    } catch (error) {
      logger.error(`Error querying entities: ${error.message}`);
      throw error;
    }
  }
  /**
   * Get all unique user public keys (partition keys) from the notifications table
   * @returns {Promise<Array>} - Array of unique pubkeys
   */
  async getAllUserPubkeys() {
    try {
      const entities = await this.queryEntities('PartitionKey ne \'\'');
      const uniquePubkeys = [...new Set(entities.map(entity => entity.partitionKey))];
      logger.debug(`Found ${uniquePubkeys.length} unique users in the system`);
      return uniquePubkeys;
    } catch (error) {
      logger.error(`Error getting all user pubkeys: ${error.message}`);
      throw error;
    }
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
   * Check if a user has an active premium subscription
   * @param {string} pubkey - User's pubkey
   * @returns {Promise<boolean>} - True if user has premium subscription
   */
  async hasPremiumSubscription(pubkey) {
    try {
      const subscription = await this.getEntity(pubkey, "subscription");

      if (!subscription) {
        return false;
      }

      const isPremium = subscription.isPremium === true;
      const isActive = subscription.expiryDate ? new Date(subscription.expiryDate) > new Date() : false;

      return isPremium && isActive;
    } catch (error) {
      logger.error(`Error checking premium subscription for user ${pubkey}: ${error.message}`);
      return false; // Default to non-premium on error
    }
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
  
  /**
   * Store entity in the table
   * @param {string} partitionKey - User's pubkey
   * @param {string} rowKey - Entity type (subscription, notification-subscription, etc.)
   * @param {object} data - Entity data
   * @returns {Promise<object>} - The stored entity
   */
  async upsertEntity(partitionKey, rowKey, data) {
    try {
      const entity = {
        partitionKey,
        rowKey,
        ...data,
        created: new Date().toISOString(),
      };

      console.log('SAVING:', entity);

      await this.tableClient.upsertEntity(entity);
      logger.debug(`Entity upserted: [${partitionKey}, ${rowKey}]`);
      return entity;
    } catch (error) {
      logger.error(`Error upserting entity [${partitionKey}, ${rowKey}]: ${error.message}`);
      throw error;
    }
  }

  /**
   * Store notification settings in the settings table
   * @param {string} pubkey - User's pubkey (partition key)
   * @param {object} settings - Settings data
   * @returns {Promise<object>} - The stored entity
   */
  async upsertNotificationSettings(pubkey, settings) {
    try {
      const entity = {
        partitionKey: pubkey,
        rowKey: "notifications",
        ...settings,
        created: new Date().toISOString()
      };

      console.log('SAVING SETTINGS:', entity);

      await this.settingsTableClient.upsertEntity(entity);
      logger.debug(`Notification settings upserted for user: ${pubkey}`);
      return entity;
    } catch (error) {
      logger.error(`Error upserting notification settings for user ${pubkey}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get notification settings from the settings table
   * @param {string} pubkey - User's pubkey (partition key)
   * @returns {Promise<object|null>} - The retrieved settings or null if not found
   */
  async getNotificationSettings(pubkey) {
    try {
      const entity = await this.settingsTableClient.getEntity(pubkey, "notifications");
      return entity;
    } catch (error) {
      if (error.statusCode === 404) {
        logger.debug(`Notification settings not found for user: ${pubkey}`);
        return null;
      }

      logger.error(`Error getting notification settings for user ${pubkey}: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new TableStorageService();
