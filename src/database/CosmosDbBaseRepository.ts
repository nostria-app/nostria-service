import { CosmosClient, Container, Database, ItemResponse } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import logger from '../utils/logger';

export interface CosmosDbEntity {
  id: string;
  type: string;
  pubkey: string; // Use pubkey as the partition key for all entities
  modified?: number; // Timestamp from CosmosDB _ts field
  [key: string]: any;
}

export class CosmosDbBaseRepository<T extends CosmosDbEntity> {
  private client!: CosmosClient;
  private database!: Database;
  private container!: Container;
  private isInitialized = false;
  public entityType: string;
  protected uniqueIdentifiers: boolean;

  /**
   * Base repository for CosmosDB operations.
   * @param entityType - The type of entity this repository manages (e.g., 'user', 'payment').
   * @param uniqueIdentifiers - If true, uses unique identifiers (non-deterministic) for entities, and all queries will use 'type' as a filter.
   */
  constructor(entityType: string, uniqueIdentifiers = false) {
    this.entityType = entityType;
    this.uniqueIdentifiers = uniqueIdentifiers;
    // Don't initialize immediately to avoid test failures
    // Initialize lazily when first method is called
  }

  private initializeClient(): void {
    try {
      if (process.env.AZURE_COSMOSDB_CONNECTION_STRING) {
        // Use connection string if available (development)
        this.client = new CosmosClient(process.env.AZURE_COSMOSDB_CONNECTION_STRING);
      } else if (process.env.AZURE_COSMOSDB_ENDPOINT) {
        // Use managed identity (preferred for production)
        const credential = new DefaultAzureCredential();
        this.client = new CosmosClient({
          endpoint: process.env.AZURE_COSMOSDB_ENDPOINT,
          aadCredentials: credential
        });
      } else {
        throw new Error('Either AZURE_COSMOSDB_CONNECTION_STRING or AZURE_COSMOSDB_ENDPOINT must be provided');
      }

      const databaseName = process.env.AZURE_COSMOSDB_DATABASE_NAME || 'NostriaDB';
      const containerName = process.env.AZURE_COSMOSDB_CONTAINER_NAME || 'Documents';

      this.database = this.client.database(databaseName);
      this.container = this.database.container(containerName);

      logger.info('CosmosDB client initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize CosmosDB client:', error);
      throw error;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      // Initialize client on first use
      this.initializeClient();

      try {
        // Ensure database exists
        await this.database.read();

        // Ensure container exists with appropriate partition key
        await this.container.read();

        this.isInitialized = true;
        logger.info('CosmosDB database and container verified');
      } catch (error: any) {
        if (error.code === 404) {
          logger.info('Creating CosmosDB database and/or container...');

          // DATABASE AND CONTAINER IS CREATED WITH INFRASTRUCTURE AS CODE!
          // Create database if it doesn't exist
          // await this.client.databases.createIfNotExists({
          //   id: this.database.id
          // });

          // // Create container if it doesn't exist
          // // Use pubkey as partition key for all documents
          // await this.database.containers.createIfNotExists({
          //   id: this.container.id,
          //   partitionKey: '/pubkey' // Partition by user's public key
          // });

          this.isInitialized = true;
          logger.info('CosmosDB database and container created successfully');
        } else {
          logger.error('Failed to verify/create CosmosDB resources:', error);
          throw error;
        }
      }
    }
  }

  /**
   * Transform CosmosDB record by mapping _ts to modified and removing metadata fields
   */
  private transformRecord(record: any): T {
    const { _rid, _self, _etag, _attachments, _ts, ...cleanRecord } = record;

    if (_ts) {
      cleanRecord.modified = _ts * 1000; // CosmosDB _ts is in seconds, convert to milliseconds
    }

    return cleanRecord as T;
  }

  protected async create(entity: T): Promise<T> {
    try {
      await this.ensureInitialized();

      const entityWithType: T = {
        ...entity,
        type: this.entityType
      };

      const response: ItemResponse<T> = await this.container.items.create(entityWithType);

      logger.info(`Created ${this.entityType}: ${entity.id}`);
      return this.transformRecord(response.resource!);
    } catch (error) {
      logger.error(`Failed to create ${this.entityType}:`, error);
      throw new Error(`Failed to create ${this.entityType}`);
    }
  }

  protected async update(entity: T): Promise<T> {
    try {
      await this.ensureInitialized();

      const entityWithType: T = {
        ...entity,
        type: this.entityType
      };

      const response: ItemResponse<T> = await this.container
        .item(entity.id, entity.pubkey)
        .replace(entityWithType);

      logger.info(`Updated ${this.entityType}: ${entity.id}`);
      return this.transformRecord(response.resource!);
    } catch (error) {
      logger.error(`Failed to update ${this.entityType}:`, error);
      throw new Error(`Failed to update ${this.entityType}`);
    }
  }

  protected async upsert(entity: T): Promise<T> {
    try {
      await this.ensureInitialized();

      const entityWithType: T = {
        ...entity,
        type: this.entityType
      };

      const response = await this.container.items.upsert(entityWithType);

      logger.info(`Upserted ${this.entityType}: ${entity.id}`);
      return this.transformRecord(response.resource);
    } catch (error) {
      logger.error(`Failed to upsert ${this.entityType}:`, error);
      throw new Error(`Failed to upsert ${this.entityType}`);
    }
  }

  protected async getById(id: string, partitionKey?: string): Promise<T | null> {
    try {
      await this.ensureInitialized();

      // If no partition key provided, use the ID as partition key (for accounts where id = pubkey)
      const pkValue = partitionKey || id;

      console.log(`Fetching ${this.entityType} by id: ${id}, partitionKey: ${pkValue}`);

      const response: ItemResponse<T> = await this.container.item(id, pkValue).read();

      if (response.resource && response.resource.type === this.entityType) {
        return this.transformRecord(response.resource);
      }

      return null;
    } catch (error: any) {
      if (error.code === 404) {
        return null;
      }

      logger.error(`Failed to get ${this.entityType}:`, error);
      throw new Error(`Failed to retrieve ${this.entityType}`);
    }
  }

  protected async delete(id: string, partitionKey?: string): Promise<void> {
    try {
      await this.ensureInitialized();

      // If no partition key provided, use the ID as partition key (for accounts where id = pubkey)
      const pkValue = partitionKey || id;
      await this.container.item(id, pkValue).delete();
      logger.info(`Deleted ${this.entityType}: ${id}`);
    } catch (error: any) {
      if (error.code !== 404) {
        logger.error(`Failed to delete ${this.entityType}:`, error);
        throw new Error(`Failed to delete ${this.entityType}`);
      }
    }
  }

  protected async query(querySpec: any, partitionKey?: string): Promise<T[]> {
    try {
      await this.ensureInitialized();

      const options = partitionKey ? { partitionKey } : {};

      const { resources } = await this.container.items
        .query<T>(querySpec, options)
        .fetchAll();

      // Filter by type and transform records
      return resources
        .filter(r => r.type === this.entityType)
        .map(r => this.transformRecord(r));
    } catch (error) {
      logger.error(`Failed to query ${this.entityType}:`, error);
      throw new Error(`Failed to query ${this.entityType}`);
    }
  }

  /**
   * Query without type, this is used when the SQL performs an SELECT of individual fields.
   */
  protected async queryWithType<T>(querySpec: any, partitionKey?: string): Promise<T[]> {
    try {
      await this.ensureInitialized();

      const options = partitionKey ? { partitionKey } : {};

      const { resources } = await this.container.items
        .query<T>(querySpec, options)
        .fetchAll();

      return resources;
    } catch (error) {
      logger.error(`Failed to query ${this.entityType}:`, error);
      throw new Error(`Failed to query ${this.entityType}`);
    }
  }
}

export default CosmosDbBaseRepository;
