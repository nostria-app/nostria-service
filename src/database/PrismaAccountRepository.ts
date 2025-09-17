import { Account } from "../models/account";
import { PrismaBaseRepository } from "./PrismaBaseRepository";
import logger from "../utils/logger";
import { now } from "../helpers/now";
import { AccountSubscription } from "../models/accountSubscription";

class PrismaAccountRepository extends PrismaBaseRepository {
  constructor() {
    super('account');
  }

  private transformPrismaAccountToAccount(prismaAccount: any): Account {
    return {
      id: prismaAccount.id,
      type: 'account',
      pubkey: prismaAccount.pubkey,
      username: prismaAccount.username,
      tier: prismaAccount.tier,
      subscription: prismaAccount.subscription as AccountSubscription,
      expires: prismaAccount.expires ? Number(prismaAccount.expires) : undefined,
      created: Number(prismaAccount.created),
      modified: Number(prismaAccount.modified),
      lastLoginDate: prismaAccount.lastLoginDate ? Number(prismaAccount.lastLoginDate) : undefined,
    };
  }

  async create(account: Account): Promise<Account> {
    try {
      // Prepare account data with BigInt timestamps
      const accountData = {
        id: account.pubkey, // Use pubkey as primary key
        pubkey: account.pubkey,
        username: account.username,
        tier: account.tier,
        expires: account.expires ? BigInt(account.expires) : null,
        created: BigInt(account.created || now()),
        modified: BigInt(account.modified || now()),
        lastLoginDate: account.lastLoginDate ? BigInt(account.lastLoginDate) : null,
        subscription: account.subscription as any, // JSON field
      };

      const result = await this.prisma.account.create({
        data: accountData
      });

      logger.info(`Created account: ${account.pubkey}`);
      return this.transformPrismaAccountToAccount(result);
    } catch (error) {
      this.handlePrismaError(error, 'create');
    }
  }

  async isUsernameTaken(username: string, excludePubkey?: string): Promise<boolean> {
    try {
      const account = await this.prisma.account.findFirst({
        where: {
          username: username,
          pubkey: excludePubkey ? { not: excludePubkey } : undefined
        }
      });

      return account !== null;
    } catch (error) {
      logger.error('Failed to check username uniqueness:', error);
      throw new Error(`Failed to check username uniqueness: ${(error as Error).message}`);
    }
  }

  async getByPubkey(pubkey: string): Promise<Account | null> {
    try {
      const result = await this.prisma.account.findUnique({
        where: { pubkey }
      });

      return result ? this.transformPrismaAccountToAccount(result) : null;
    } catch (error) {
      logger.error('Failed to get account by pubkey:', error);
      throw new Error(`Failed to get account: ${(error as Error).message}`);
    }
  }

  async getByUsername(username: string): Promise<Account | null> {
    try {
      const result = await this.prisma.account.findUnique({
        where: { username }
      });

      return result ? this.transformPrismaAccountToAccount(result) : null;
    } catch (error) {
      logger.error('Failed to get account by username:', error);
      throw new Error(`Failed to get account: ${(error as Error).message}`);
    }
  }

  async update(account: Account): Promise<Account> {
    try {
      // Update modified timestamp
      const updatedAccount = this.updateModifiedTimestamp(account);
      
      // Prepare account data with BigInt timestamps
      const accountData = {
        username: updatedAccount.username,
        tier: updatedAccount.tier,
        expires: updatedAccount.expires ? BigInt(updatedAccount.expires) : null,
        modified: BigInt(updatedAccount.modified),
        lastLoginDate: updatedAccount.lastLoginDate ? BigInt(updatedAccount.lastLoginDate) : null,
        subscription: updatedAccount.subscription as any, // JSON field
      };

      const result = await this.prisma.account.update({
        where: { pubkey: account.pubkey },
        data: accountData
      });

      logger.info(`Updated account: ${account.pubkey}`);
      return this.transformPrismaAccountToAccount(result);
    } catch (error) {
      this.handlePrismaError(error, 'update');
    }
  }

  async updateLoginDate(pubkey: string): Promise<void> {
    try {
      await this.prisma.account.update({
        where: { pubkey },
        data: { 
          lastLoginDate: BigInt(now()),
          modified: BigInt(now())
        }
      });

      logger.info(`Updated login date for account: ${pubkey}`);
    } catch (error) {
      logger.error('Failed to update login date:', error);
      throw new Error(`Failed to update login date: ${(error as Error).message}`);
    }
  }

  async getAllAccounts(limit: number = 100): Promise<Account[]> {
    try {
      const results = await this.prisma.account.findMany({
        orderBy: { created: 'desc' },
        take: limit
      });

      return results.map(result => this.transformPrismaAccountToAccount(result));
    } catch (error) {
      logger.error('Failed to get all accounts:', error);
      throw new Error(`Failed to get accounts: ${(error as Error).message}`);
    }
  }

  async deleteAccount(pubkey: string): Promise<void> {
    try {
      await this.prisma.account.delete({
        where: { pubkey }
      });

      logger.info(`Deleted account: ${pubkey}`);
    } catch (error) {
      this.handlePrismaError(error, 'delete');
    }
  }

  async hasPremiumSubscription(pubkey: string): Promise<boolean> {
    try {
      const account = await this.getByPubkey(pubkey);
      if (!account) {
        return false;
      }

      // Check if user has premium or premium_plus tier and subscription is not expired
      const isPremiumTier = account.tier === 'premium' || account.tier === 'premium_plus';
      const isNotExpired = !account.expires || account.expires > now();

      return isPremiumTier && isNotExpired;
    } catch (error) {
      logger.error('Failed to check premium subscription:', error);
      return false; // Default to false on error
    }
  }
}

export default PrismaAccountRepository;