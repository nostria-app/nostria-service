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
          username: {
            equals: username,
            mode: 'insensitive'
          },
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
      const result = await this.prisma.account.findFirst({
        where: {
          username: {
            equals: username,
            mode: 'insensitive'
          }
        }
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

  async getAccountStats(): Promise<any> {
    try {
      const ts = now();
      const sevenDaysAgo = ts - (7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = ts - (30 * 24 * 60 * 60 * 1000);
      const accounts = await this.prisma.account.findMany({
        select: {
          tier: true,
          expires: true,
          created: true,
          lastLoginDate: true,
          username: true,
          subscription: true,
        },
      });

      const stats = {
        total: accounts.length,
        free: 0,
        paid: 0,
        activeSubscriptions: 0,
        expiredSubscriptions: 0,
        withUsername: 0,
        newLast7Days: 0,
        newLast30Days: 0,
        activeLast7Days: 0,
        activeLast30Days: 0,
        tierCounts: {} as Record<string, number>,
        activeTierCounts: {} as Record<string, number>,
        expiredTierCounts: {} as Record<string, number>,
        billingCycleCounts: {} as Record<string, number>,
      };

      for (const account of accounts) {
        const tier = account.tier || 'unknown';
        const expires = account.expires ? Number(account.expires) : undefined;
        const created = Number(account.created);
        const lastLoginDate = account.lastLoginDate ? Number(account.lastLoginDate) : undefined;
        const billingCycle = typeof account.subscription === 'object' && account.subscription && 'billingCycle' in account.subscription
          ? String((account.subscription as { billingCycle?: unknown }).billingCycle || 'unknown')
          : 'unknown';
        const isPaidTier = tier !== 'free';
        const isActiveSubscription = isPaidTier && (!expires || expires > ts);
        const isExpiredSubscription = isPaidTier && Boolean(expires && expires <= ts);

        stats.tierCounts[tier] = (stats.tierCounts[tier] || 0) + 1;
        stats.billingCycleCounts[billingCycle] = (stats.billingCycleCounts[billingCycle] || 0) + 1;

        if (account.username) {
          stats.withUsername += 1;
        }

        if (created >= sevenDaysAgo) {
          stats.newLast7Days += 1;
        }

        if (created >= thirtyDaysAgo) {
          stats.newLast30Days += 1;
        }

        if (lastLoginDate && lastLoginDate >= sevenDaysAgo) {
          stats.activeLast7Days += 1;
        }

        if (lastLoginDate && lastLoginDate >= thirtyDaysAgo) {
          stats.activeLast30Days += 1;
        }

        if (!isPaidTier) {
          stats.free += 1;
          continue;
        }

        stats.paid += 1;

        if (isActiveSubscription) {
          stats.activeSubscriptions += 1;
          stats.activeTierCounts[tier] = (stats.activeTierCounts[tier] || 0) + 1;
        }

        if (isExpiredSubscription) {
          stats.expiredSubscriptions += 1;
          stats.expiredTierCounts[tier] = (stats.expiredTierCounts[tier] || 0) + 1;
        }
      }

      return stats;
    } catch (error) {
      logger.error('Failed to get account stats:', error);
      throw new Error(`Failed to get account stats: ${(error as Error).message}`);
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

      // Check if user has a paid tier and the subscription is not expired
      const isPremiumTier =
        account.tier === 'basic' ||
        account.tier === 'premium' ||
        account.tier === 'premium_plus';
      const isNotExpired = !account.expires || account.expires > now();

      return isPremiumTier && isNotExpired;
    } catch (error) {
      logger.error('Failed to check premium subscription:', error);
      return false; // Default to false on error
    }
  }
}

export default PrismaAccountRepository;
