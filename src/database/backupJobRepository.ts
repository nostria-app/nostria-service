import { CosmosClient, Container, Database, ItemResponse } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import logger from '../utils/logger';
import { BackupJob, BackupJobStatus } from '../models/backupJob';

export class BackupJobRepository {
  private client!: CosmosClient;
  private database!: Database;
  private container!: Container;
  private isInitialized = false;

  constructor() {
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
          
          // Create database if it doesn't exist
          await this.client.databases.createIfNotExists({
            id: this.database.id
          });

          // Create container if it doesn't exist
          await this.database.containers.createIfNotExists({
            id: this.container.id,
            partitionKey: '/pubkey' // Partition by user's public key
          });

          this.isInitialized = true;
          logger.info('CosmosDB database and container created successfully');
        } else {
          logger.error('Failed to verify/create CosmosDB resources:', error);
          throw error;
        }
      }
    }
  }
  async createBackupJob(backupJob: BackupJob): Promise<BackupJob> {
    try {
      await this.ensureInitialized();
      
      // Ensure the backup job has the correct type
      const backupJobWithType: BackupJob = {
        ...backupJob,
        type: 'backup-job'
      };
      
      const response: ItemResponse<BackupJob> = await this.container.items.create(backupJobWithType);
      
      logger.info(`Created backup job: ${backupJob.id} for user: ${backupJob.pubkey}`);
      return response.resource!;
    } catch (error) {
      logger.error('Failed to create backup job:', error);
      throw new Error('Failed to create backup job');
    }
  }

  async getBackupJob(id: string, pubkey: string): Promise<BackupJob | null> {
    try {
      await this.ensureInitialized();
      
      const response: ItemResponse<BackupJob> = await this.container.item(id, pubkey).read();
      
      if (response.resource) {
        return response.resource;
      }
      
      return null;
    } catch (error: any) {
      if (error.code === 404) {
        return null;
      }
      
      logger.error('Failed to get backup job:', error);
      throw new Error('Failed to retrieve backup job');
    }
  }
  async getUserBackupJobs(pubkey: string, limit: number = 50): Promise<BackupJob[]> {
    try {
      await this.ensureInitialized();
      
      const query = {
        query: 'SELECT * FROM c WHERE c.type = @type AND c.pubkey = @pubkey ORDER BY c.requestedAt DESC',
        parameters: [
          { name: '@type', value: 'backup-job' },
          { name: '@pubkey', value: pubkey }
        ]
      };

      const { resources } = await this.container.items
        .query<BackupJob>(query, { maxItemCount: limit })
        .fetchAll();
        
      return resources;
    } catch (error) {
      logger.error('Failed to get user backup jobs:', error);
      throw new Error('Failed to retrieve backup jobs');
    }
  }

  async updateBackupJobStatus(
    id: string, 
    pubkey: string, 
    status: BackupJobStatus, 
    updates: Partial<BackupJob> = {}
  ): Promise<BackupJob> {
    try {
      await this.ensureInitialized();
      
      const existingJob = await this.getBackupJob(id, pubkey);
      if (!existingJob) {
        throw new Error('Backup job not found');
      }

      const updatedJob: BackupJob = {
        ...existingJob,
        ...updates,
        status,
        // Always update the appropriate timestamp based on status
        ...(status === BackupJobStatus.IN_PROGRESS && { startedAt: new Date() }),
        ...(status === BackupJobStatus.COMPLETED && { completedAt: new Date() }),
        ...(status === BackupJobStatus.FAILED && { completedAt: new Date() })
      };

      const response: ItemResponse<BackupJob> = await this.container
        .item(id, pubkey)
        .replace(updatedJob);

      logger.info(`Updated backup job ${id} status to ${status}`);
      return response.resource!;
    } catch (error) {
      logger.error('Failed to update backup job status:', error);
      throw new Error('Failed to update backup job');
    }
  }

  async deleteBackupJob(id: string, pubkey: string): Promise<void> {
    try {
      await this.ensureInitialized();
      
      await this.container.item(id, pubkey).delete();
      logger.info(`Deleted backup job: ${id}`);
    } catch (error: any) {
      if (error.code !== 404) {
        logger.error('Failed to delete backup job:', error);
        throw new Error('Failed to delete backup job');
      }
    }
  }
  async getPendingBackupJobs(limit: number = 100): Promise<BackupJob[]> {
    try {
      await this.ensureInitialized();
      
      const query = {
        query: `SELECT * FROM c 
                WHERE c.type = @type 
                AND c.status = @status 
                AND (IS_NULL(c.scheduledAt) OR c.scheduledAt <= @now)
                ORDER BY c.requestedAt ASC`,
        parameters: [
          { name: '@type', value: 'backup-job' },
          { name: '@status', value: BackupJobStatus.PENDING },
          { name: '@now', value: new Date().toISOString() }
        ]
      };

      const { resources } = await this.container.items
        .query<BackupJob>(query, { maxItemCount: limit })
        .fetchAll();
        
      return resources;
    } catch (error) {
      logger.error('Failed to get pending backup jobs:', error);
      throw new Error('Failed to retrieve pending backup jobs');
    }
  }
}

// Export singleton instance
const backupJobRepository = new BackupJobRepository();
export default backupJobRepository;
