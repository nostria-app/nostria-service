import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from './prismaClient';
import logger from '../utils/logger';
import { now } from '../helpers/now';

export abstract class PrismaBaseRepository {
  protected prisma: PrismaClient;
  protected entityName: string;

  constructor(entityName: string) {
    this.prisma = prisma;
    this.entityName = entityName;
  }

  /**
   * Convert BigInt timestamps to numbers for API responses and add type field for compatibility
   */
  protected transformToCosmosDbFormat<K>(entity: K, entityType: string): K & { type: string } {
    if (!entity || typeof entity !== 'object') return entity as K & { type: string };
    
    const transformed = { ...entity, type: entityType } as any;
    
    // Convert BigInt timestamps to numbers
    if (transformed.created && typeof transformed.created === 'bigint') {
      transformed.created = Number(transformed.created);
    }
    if (transformed.modified && typeof transformed.modified === 'bigint') {
      transformed.modified = Number(transformed.modified);
    }
    if (transformed.expires && typeof transformed.expires === 'bigint') {
      transformed.expires = Number(transformed.expires);
    }
    if (transformed.lastLoginDate && typeof transformed.lastLoginDate === 'bigint') {
      transformed.lastLoginDate = Number(transformed.lastLoginDate);
    }
    if (transformed.requested && typeof transformed.requested === 'bigint') {
      transformed.requested = Number(transformed.requested);
    }
    if (transformed.scheduled && typeof transformed.scheduled === 'bigint') {
      transformed.scheduled = Number(transformed.scheduled);
    }
    if (transformed.started && typeof transformed.started === 'bigint') {
      transformed.started = Number(transformed.started);
    }
    if (transformed.completed && typeof transformed.completed === 'bigint') {
      transformed.completed = Number(transformed.completed);
    }
    if (transformed.paid && typeof transformed.paid === 'bigint') {
      transformed.paid = Number(transformed.paid);
    }
    
    return transformed;
  }

  /**
   * Convert number timestamps to BigInt for database storage
   */
  protected prepareBigIntTimestamps<K>(entity: K): K {
    if (!entity || typeof entity !== 'object') return entity;
    
    const prepared = { ...entity } as any;
    
    // Convert number timestamps to BigInt
    if (prepared.created && typeof prepared.created === 'number') {
      prepared.created = BigInt(prepared.created);
    }
    if (prepared.modified && typeof prepared.modified === 'number') {
      prepared.modified = BigInt(prepared.modified);
    }
    if (prepared.expires && typeof prepared.expires === 'number') {
      prepared.expires = BigInt(prepared.expires);
    }
    if (prepared.lastLoginDate && typeof prepared.lastLoginDate === 'number') {
      prepared.lastLoginDate = BigInt(prepared.lastLoginDate);
    }
    if (prepared.requested && typeof prepared.requested === 'number') {
      prepared.requested = BigInt(prepared.requested);
    }
    if (prepared.scheduled && typeof prepared.scheduled === 'number') {
      prepared.scheduled = BigInt(prepared.scheduled);
    }
    if (prepared.started && typeof prepared.started === 'number') {
      prepared.started = BigInt(prepared.started);
    }
    if (prepared.completed && typeof prepared.completed === 'number') {
      prepared.completed = BigInt(prepared.completed);
    }
    if (prepared.paid && typeof prepared.paid === 'number') {
      prepared.paid = BigInt(prepared.paid);
    }
    
    return prepared;
  }

  /**
   * Transform array of entities
   */
  protected transformArrayToCosmosDbFormat<K>(entities: K[], entityType: string): (K & { type: string })[] {
    return entities.map(entity => this.transformToCosmosDbFormat(entity, entityType));
  }

  /**
   * Handle Prisma errors and convert them to meaningful messages
   */
  protected handlePrismaError(error: any, operation: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case 'P2002':
          logger.error(`Unique constraint violation in ${this.entityName} ${operation}:`, error);
          throw new Error(`${this.entityName} already exists`);
        case 'P2025':
          logger.error(`Record not found in ${this.entityName} ${operation}:`, error);
          throw new Error(`${this.entityName} not found`);
        default:
          logger.error(`Prisma error in ${this.entityName} ${operation}:`, error);
          throw new Error(`Database error in ${this.entityName} ${operation}`);
      }
    }
    
    logger.error(`Unexpected error in ${this.entityName} ${operation}:`, error);
    throw new Error(`Failed to ${operation} ${this.entityName}`);
  }

  /**
   * Update the modified timestamp
   */
  protected updateModifiedTimestamp<K extends { modified?: number | bigint }>(entity: K): K {
    return {
      ...entity,
      modified: now()
    };
  }
}