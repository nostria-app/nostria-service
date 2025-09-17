import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

class PrismaClientSingleton {
  private static instance: PrismaClient | null = null;

  public static getInstance(): PrismaClient {
    if (!PrismaClientSingleton.instance) {
      PrismaClientSingleton.instance = new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
      });

      // Handle process termination
      process.on('beforeExit', async () => {
        await PrismaClientSingleton.disconnect();
      });

      process.on('SIGINT', async () => {
        await PrismaClientSingleton.disconnect();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        await PrismaClientSingleton.disconnect();
        process.exit(0);
      });

      logger.info('Prisma client initialized');
    }

    return PrismaClientSingleton.instance;
  }

  public static async connect(): Promise<void> {
    try {
      const client = PrismaClientSingleton.getInstance();
      await client.$connect();
      logger.info('Connected to PostgreSQL database');
    } catch (error) {
      logger.error('Failed to connect to PostgreSQL:', error);
      throw error;
    }
  }

  public static async disconnect(): Promise<void> {
    if (PrismaClientSingleton.instance) {
      try {
        await PrismaClientSingleton.instance.$disconnect();
        PrismaClientSingleton.instance = null;
        logger.info('Disconnected from PostgreSQL database');
      } catch (error) {
        logger.error('Error disconnecting from PostgreSQL:', error);
      }
    }
  }

  public static async healthCheck(): Promise<boolean> {
    try {
      const client = PrismaClientSingleton.getInstance();
      await client.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      logger.error('PostgreSQL health check failed:', error);
      return false;
    }
  }
}

export default PrismaClientSingleton;
export const prisma = PrismaClientSingleton.getInstance();