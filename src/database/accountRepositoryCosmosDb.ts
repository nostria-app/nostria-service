import { Account } from "../models/account";
import CosmosDbBaseRepository from "./CosmosDbBaseRepository";
import logger from "../utils/logger";
import { now } from "../helpers/now";

class AccountRepository extends CosmosDbBaseRepository<Account> {
  constructor() {
    super('account');
  }
  async create(account: Account): Promise<Account> {
    // Set the id to pubkey and use pubkey as partition key for efficient queries
    const accountEntity: Account = {
      ...account,
      type: this.entityType
    };

    return await super.upsert(accountEntity);
  }

  async isUsernameTaken(username: string, excludePubkey?: string): Promise<boolean> {
    try {
      // Query for any account with this username, excluding the current account if specified
      const query = {
        query: excludePubkey
          ? 'SELECT * FROM c WHERE c.type = @type AND c.username = @username AND c.pubkey != @excludePubkey'
          : 'SELECT * FROM c WHERE c.type = @type AND c.username = @username',
        parameters: [
          { name: '@type', value: 'account' },
          { name: '@username', value: username },
          ...(excludePubkey ? [{ name: '@excludePubkey', value: excludePubkey }] : [])
        ]
      };

      const entities = await this.query(query);
      return entities.length > 0;
    } catch (error) {
      logger.error('Failed to check username uniqueness:', error);
      throw new Error(`Failed to check username uniqueness: ${(error as Error).message}`);
    }
  }

  async getByPubkey(pubkey: string): Promise<Account | null> {
    try {
      return await this.getById(pubkey);
    } catch (error) {
      logger.error('Failed to get account by pubkey:', error);
      throw new Error(`Failed to get account: ${(error as Error).message}`);
    }
  }

  async getByUsername(username: string): Promise<Account | null> {
    try {
      const query = {
        query: 'SELECT * FROM c WHERE c.type = @type AND c.username = @username',
        parameters: [
          { name: '@type', value: 'account' },
          { name: '@username', value: username }
        ]
      };

      const entities = await this.query(query);
      return entities.length > 0 ? entities[0] : null;
    } catch (error) {
      logger.error('Failed to get account by username:', error);
      throw new Error(`Failed to get account: ${(error as Error).message}`);
    }
  }
  async update(account: Account): Promise<Account> {
    try {
      // Ensure the account has the correct structure for CosmosDB
      const accountEntity: Account = {
        ...account,
        id: account.pubkey,
        type: 'account',
        modified: now()
      };

      return await super.update(accountEntity);
    } catch (error) {
      logger.error('Failed to update account:', error);
      throw new Error(`Failed to update account: ${(error as Error).message}`);
    }
  }

  async updateLoginDate(pubkey: string): Promise<void> {
    try {
      const account = await this.getByPubkey(pubkey);
      if (account) {
        account.lastLoginDate = now();
        await this.update(account);
      }
    } catch (error) {
      logger.error('Failed to update login date:', error);
      throw new Error(`Failed to update login date: ${(error as Error).message}`);
    }
  }

  async getAllAccounts(limit: number = 100): Promise<Account[]> {
    try {
      const query = {
        query: 'SELECT * FROM c WHERE c.type = @type ORDER BY c.created DESC',
        parameters: [
          { name: '@type', value: 'account' }
        ]
      };

      return await this.query(query);
    } catch (error) {
      logger.error('Failed to get all accounts:', error);
      throw new Error(`Failed to get accounts: ${(error as Error).message}`);
    }
  }

  async deleteAccount(pubkey: string): Promise<void> {
    try {
      await super.delete(pubkey, pubkey);
    } catch (error) {
      logger.error('Failed to delete account:', error);
      throw new Error(`Failed to delete account: ${(error as Error).message}`);
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

// Export singleton instance
const accountRepository = new AccountRepository();
export default accountRepository;
