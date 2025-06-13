import { TableClient, TableServiceClient, TableEntityQueryOptions, TableEntityResult, TableEntity } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import logger from "../utils/logger";

type ValueType = string | Date | boolean | number

export const escapeODataValue = (value: ValueType): string => {
  if (typeof value === "string") {
    return `'${value.replace(/'/g, "''")}'`;
  } else if (value instanceof Date) {
    return `datetime'${value.toISOString()}'`;
  } else if (typeof value === "boolean") {
    return value ? "true" : "false";
  } else if (typeof value === "number") {
    return value.toString();
  } else {
    throw new Error("Unsupported filter value type");
  }
}

export class BaseTableStorageService<T extends object> {
  protected tableName: string;
  protected serviceClient!: TableServiceClient;
  protected tableClient!: TableClient;

  constructor(tableName: string) {
    this.tableName = tableName;
    this.initializeClient();
  }

  protected initializeClient(): void {
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
    } catch (error: any) {
      logger.error(`Failed to initialize Table Storage client: ${error.message}`);
      throw error;
    }
  }

  protected async ensureTableExists(): Promise<void> {
    try {
      await this.serviceClient.createTable(this.tableName);
      logger.info(`Table '${this.tableName}' created or already exists`);
    } catch (error: any) {
      // If table already exists, that's fine
      if (error.statusCode !== 409) {
        logger.error(`Error ensuring table '${this.tableName}' exists: ${error.message}`);
        throw error;
      }
    }
  }

  protected async upsertEntity(partitionKey: string, rowKey: string, data: T): Promise<T> {
    const entity: TableEntity<T> = {
      partitionKey,
      rowKey,
      ...data
    };

    try {
      await this.tableClient.upsertEntity<T>(entity, "Replace");
      return data;
    } catch (error: any) {
      logger.error(`Error upserting entity in ${this.tableName}: ${error.message}`);
      throw error;
    }
  }

  protected async getEntity(partitionKey: string, rowKey: string): Promise<T | null> {
    try {
      const entity = await this.tableClient.getEntity<T>(partitionKey, rowKey);
      return this.toObject(entity);
    } catch (error: any) {
      if (error.statusCode === 404) {
        return null;
      }
      logger.error(`Error getting entity from ${this.tableName}: ${error.message}`);
      throw error;
    }
  }

  protected async queryEntities(query: string): Promise<T[]> {
    try {
      const iterator = this.tableClient.listEntities<T>({
        queryOptions: { filter: query } as TableEntityQueryOptions
      });

      const entities: T[] = [];
      for await (const entity of iterator) {
        entities.push(this.toObject(entity));
      }
      return entities;
    } catch (error: any) {
      logger.error(`Error querying entities from ${this.tableName}: ${error.message}`);
      throw error;
    }
  }

  protected async deleteEntity(partitionKey: string, rowKey: string): Promise<void> {
    try {
      await this.tableClient.deleteEntity(partitionKey, rowKey);
    } catch (error: any) {
      logger.error(`Error deleting entity from ${this.tableName}: ${error.message}`);
      throw error;
    }
  }

  protected toObject(entity: TableEntityResult<T>): T {
    const { partitionKey, rowKey, etag, timestamp, ...data} = entity;
    return data as T;
  }
}

export default BaseTableStorageService; 