import { TableClient, TableServiceClient, odata } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import logger from './logger';

interface TableEntity {
  partitionKey: string;
  rowKey: string;
  [key: string]: any;
}

interface SubscriptionEntity extends TableEntity {
  subscription: string;
  created?: string;
  timestamp?: string;
}

interface NotificationSettings extends TableEntity {
  settings?: string;
  created?: string;
}

interface NotificationData {
  content?: string;
  template?: string;
  title?: string;
  body?: string;
  icon?: string;
  timestamp?: string;
}

/**
 * Service for interacting with Azure Table Storage
 */
class TableStorageService {
  private notificationsTableName: string;
  private settingsTableName: string;
  private serviceClient!: TableServiceClient;
  private notificationsTableClient!: TableClient;
  private settingsTableClient!: TableClient;
  public tableClient!: TableClient; // For backward compatibility

  constructor() {
    this.notificationsTableName = "notifications";
    this.settingsTableName = "settings";
    this.initializeClient();
  }

  /**
   * Initialize Azure Table Storage client
   */
  private initializeClient(): void {
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
      logger.error(`Failed to initialize Table Storage client: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Ensure the tables exist, create if they don't
   */
  private async ensureTablesExist(): Promise<void> {
    try {
      // Create notifications table
      await this.serviceClient.createTable(this.notificationsTableName);
      logger.info(`Table '${this.notificationsTableName}' created or already exists`);
      
      // Create settings table
      await this.serviceClient.createTable(this.settingsTableName);
      logger.info(`Table '${this.settingsTableName}' created or already exists`);
    } catch (error: any) {
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
  async ensureTableExists(): Promise<void> {
    return this.ensureTablesExist();
  }

  /**
   * Get entity from the table
   * @param partitionKey - User's pubkey
   * @param rowKey - Entity type
   * @returns The retrieved entity or null if not found
   */
  async getEntity(partitionKey: string, rowKey: string): Promise<TableEntity | null> {
    try {
      const entity = await this.tableClient.getEntity(partitionKey, rowKey);
      return entity as TableEntity;
    } catch (error: any) {
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
   * @param query - OData filter query
   * @returns Array of entities
   */
  async queryEntities(query: string): Promise<TableEntity[]> {
    try {
      const entities: TableEntity[] = [];
      const queryOptions = { 
        queryOptions: { 
          filter: query 
        } 
      };

      logger.debug(`Executing query: ${query}`);
      
      const iterator = this.tableClient.listEntities(queryOptions);

      for await (const entity of iterator) {
        entities.push(entity as TableEntity);
      }

      logger.debug(`Query returned ${entities.length} entities`);
      return entities;
    } catch (error) {
      logger.error(`Error querying entities with query "${query}": ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Get all unique user public keys (partition keys) from the notifications table
   * @returns Array of unique pubkeys
   */
  async getAllUserPubkeys(): Promise<string[]> {
    try {
      const entities = await this.queryEntities('PartitionKey ne \'\'');
      const uniquePubkeys = [...new Set(entities.map(entity => entity.partitionKey))];
      logger.debug(`Found ${uniquePubkeys.length} unique users in the system`);
      return uniquePubkeys;
    } catch (error) {
      logger.error(`Error getting all user pubkeys: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Get all entities for a specific user (partition)
   * @param partitionKey - User's pubkey
   * @returns Array of entities
   */
  async getUserEntities(partitionKey: string): Promise<TableEntity[]> {
    try {
      const entities: TableEntity[] = [];
      
      // Use the listEntities method with specific partition key filtering
      const queryOptions = {
        queryOptions: {
          filter: odata`PartitionKey eq ${partitionKey}`
        }
      };

      logger.debug(`Querying entities for partition key: ${partitionKey}`);
      
      const iterator = this.tableClient.listEntities(queryOptions);

      for await (const entity of iterator) {
        const typedEntity = entity as TableEntity;
        // Double-check that the partition key matches (security measure)
        if (typedEntity.partitionKey === partitionKey) {
          entities.push(typedEntity);
        } else {
          logger.warn(`Security warning: Entity with wrong partition key returned! Expected: ${partitionKey}, Got: ${typedEntity.partitionKey}`);
        }
      }

      logger.debug(`Found ${entities.length} entities for partition key: ${partitionKey}`);
      return entities;
    } catch (error) {
      logger.error(`Error getting user entities for partition key ${partitionKey}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Check if a user has an active premium subscription
   * @param pubkey - User's pubkey
   * @returns True if user has premium subscription
   */
  async hasPremiumSubscription(pubkey: string): Promise<boolean> {
    try {
      const subscription = await this.getEntity(pubkey, "subscription");

      if (!subscription) {
        return false;
      }

      const isPremium = subscription.isPremium === true;
      const isActive = subscription.expiryDate ? new Date(subscription.expiryDate) > new Date() : false;

      return isPremium && isActive;
    } catch (error) {
      logger.error(`Error checking premium subscription for user ${pubkey}: ${(error as Error).message}`);
      return false; // Default to non-premium on error
    }
  }

  /**
   * Get all subscription entities for a user
   * @param pubkey - User's public key
   * @returns Array of subscription entities
   */
  async getUserSubscriptions(pubkey: string): Promise<SubscriptionEntity[]> {
    try {
      logger.debug(`Getting subscriptions for pubkey: ${pubkey}`);
      
      const entities = await this.getUserEntities(pubkey);
      
      // Filter to only include entities that have subscription data
      const subscriptionEntities = entities.filter((entity): entity is SubscriptionEntity => {
        if (entity.subscription) {
          // Additional security check - ensure partition key matches
          if (entity.partitionKey !== pubkey) {
            logger.error(`SECURITY ALERT: Subscription entity with mismatched partition key! Expected: ${pubkey}, Got: ${entity.partitionKey}`);
            return false;
          }
          return true;
        }
        return false;
      });
      
      logger.debug(`Found ${subscriptionEntities.length} subscription entities for pubkey: ${pubkey}`);
      return subscriptionEntities;
    } catch (error) {
      logger.error(`Error getting user subscriptions for ${pubkey}: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Get notification count for user within the past 24 hours
   * @param pubkey - User's pubkey
   * @returns Count of notifications
   */
  async get24HourNotificationCount(pubkey: string): Promise<number> {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayIso = yesterday.toISOString();

      // Use odata helper to properly escape values and prevent OData injection
      const entities = await this.queryEntities(
        odata`PartitionKey eq ${pubkey} and rowKey ge ${'notification-' + yesterdayIso}`
      );

      return entities.filter(entity => entity.rowKey.startsWith('notification-')).length;
    } catch (error) {
      logger.error(`Error getting 24-hour notification count for user ${pubkey}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Log a notification that was sent
   * @param pubkey - User's pubkey
   * @param notification - Notification data
   * @returns The stored entity
   */
  async logNotification(pubkey: string, notification: NotificationData): Promise<TableEntity> {
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
   * @param partitionKey - User's pubkey
   * @param rowKey - Entity type (subscription, notification-subscription, etc.)
   * @param data - Entity data
   * @returns The stored entity
   */
  async upsertEntity(partitionKey: string, rowKey: string, data: Record<string, any>): Promise<TableEntity> {
    try {
      const entity: TableEntity = {
        partitionKey,
        rowKey,
        ...data,
        created: new Date().toISOString(),
      };

      await this.tableClient.upsertEntity(entity);
      logger.debug(`Entity upserted: [${partitionKey}, ${rowKey}]`);
      return entity;
    } catch (error) {
      logger.error(`Error upserting entity [${partitionKey}, ${rowKey}]: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Store notification settings in the settings table
   * @param pubkey - User's pubkey (partition key)
   * @param settings - Settings data
   * @returns The stored entity
   */
  async upsertNotificationSettings(pubkey: string, settings: Record<string, any>): Promise<NotificationSettings> {
    try {
      const entity: NotificationSettings = {
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
      logger.error(`Error upserting notification settings for user ${pubkey}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Get notification settings from the settings table
   * @param pubkey - User's pubkey (partition key)
   * @returns The retrieved settings or null if not found
   */
  async getNotificationSettings(pubkey: string): Promise<NotificationSettings | null> {
    try {
      const entity = await this.settingsTableClient.getEntity(pubkey, "notifications");
      return entity as NotificationSettings;
    } catch (error: any) {
      if (error.statusCode === 404) {
        logger.debug(`Notification settings not found for user: ${pubkey}`);
        return null;
      }

      logger.error(`Error getting notification settings for user ${pubkey}: ${error.message}`);
      throw error;
    }
  }
}

export default new TableStorageService();
