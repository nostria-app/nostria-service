const { TableClient, TableServiceClient } = require("@azure/data-tables");
const { DefaultAzureCredential } = require("@azure/identity");
const logger = require('./logger');

class BaseTableStorageService {
  constructor(tableName) {
    this.tableName = tableName;
    this.initializeClient();
  }

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
        );
      } else {
        // Use managed identity (preferred for production)
        const credential = new DefaultAzureCredential();
        const accountName = process.env.AZURE_STORAGE_ACCOUNT;

        if (!accountName) {
          throw new Error("AZURE_STORAGE_ACCOUNT environment variable is required when using managed identity");
        }

        const accountUrl = `https://${accountName}.table.core.windows.net`;
        this.serviceClient = new TableServiceClient(accountUrl, credential);
        this.tableClient = new TableClient(accountUrl, this.tableName, credential);
      }

      this.ensureTableExists();
      logger.info(`Table Storage client initialized for table: ${this.tableName}`);
    } catch (error) {
      logger.error(`Failed to initialize Table Storage client: ${error.message}`);
      throw error;
    }
  }

  async ensureTableExists() {
    try {
      await this.serviceClient.createTable(this.tableName);
      logger.info(`Table '${this.tableName}' created or already exists`);
    } catch (error) {
      // If table already exists, that's fine
      if (error.statusCode !== 409) {
        logger.error(`Error ensuring table '${this.tableName}' exists: ${error.message}`);
        throw error;
      }
    }
  }

  async upsertEntity(partitionKey, rowKey, data) {
    const entity = {
      partitionKey,
      rowKey,
      ...data
    };

    try {
      await this.tableClient.upsertEntity(entity, "Replace");
      return entity;
    } catch (error) {
      logger.error(`Error upserting entity in ${this.tableName}: ${error.message}`);
      throw error;
    }
  }

  async getEntity(partitionKey, rowKey) {
    try {
      const entity = await this.tableClient.getEntity(partitionKey, rowKey);
      return entity;
    } catch (error) {
      if (error.statusCode === 404) {
        return null;
      }
      logger.error(`Error getting entity from ${this.tableName}: ${error.message}`);
      throw error;
    }
  }

  async queryEntities(query) {
    try {
      const iterator = this.tableClient.listEntities({
        queryOptions: { filter: query }
      });

      const entities = [];
      for await (const entity of iterator) {
        entities.push(entity);
      }
      return entities;
    } catch (error) {
      logger.error(`Error querying entities from ${this.tableName}: ${error.message}`);
      throw error;
    }
  }

  async deleteEntity(partitionKey, rowKey) {
    try {
      await this.tableClient.deleteEntity(partitionKey, rowKey);
    } catch (error) {
      logger.error(`Error deleting entity from ${this.tableName}: ${error.message}`);
      throw error;
    }
  }
}

module.exports = BaseTableStorageService; 