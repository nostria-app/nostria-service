import { Account } from "../models/account";
import BaseRepository, { escapeODataValue } from "./BaseRepository";

class AccountRepository extends BaseRepository<Account> {
  constructor() {
    super("accounts");
  }

  async create(account: Account): Promise<Account> {
    await this.tableClient.upsertEntity({
      partitionKey: 'account',
      rowKey: account.pubkey,
      ...account,
      subscription: account.subscription ? JSON.stringify(account.subscription) : undefined,
    }, 'Replace')

    return account;
  }

  async isUsernameTaken(username: string, excludePubkey?: string): Promise<boolean> {
    try {
      // Query for any account with this username, excluding the current account if specified
      const filter = excludePubkey
        ? `username eq ${escapeODataValue(username)} and rowKey ne ${escapeODataValue(excludePubkey)}`
        : `username eq ${escapeODataValue(username)}`;

      const entities = await this.queryEntities(filter);
      return entities.length > 0;
    } catch (error) {
      throw new Error(`Failed to check username uniqueness: ${(error as Error).message}`);
    }
  }

  async update(account: Account): Promise<Account> {
    // If username is being set or changed, check for uniqueness
    if (account.username) {
      const isTaken = await this.isUsernameTaken(account.username, account.pubkey);
      if (isTaken) {
        throw new Error('Username is already taken');
      }
    }

    await this.tableClient.upsertEntity({
      partitionKey: 'account',
      rowKey: account.pubkey,
      ...account,
      subscription: account.subscription ? JSON.stringify(account.subscription) : undefined,
    }, 'Replace');

    return account;
  }

  async getByPubKey(pubkey: string): Promise<Account | null> {
    const account = await this.getEntity('account', pubkey);
    if (account) {
      account.subscription = account.subscription ? JSON.parse(account.subscription as any as string) : undefined;
    }
    return account;
  }

  async getByUsername(username: string): Promise<Account | null> {
    try {
      // Ineffective query.
      // TODO: either needs a second row `{ rowKey: username, pubkey }` and 
      // then a second query or move to Cosmos DB with secondary index on `username`
      const entities = await this.queryEntities(`username eq ${escapeODataValue(username)}`);
      if (entities.length === 0) return null;
      entities[0].subscription = entities[0].subscription ? JSON.parse(entities[0].subscription as any as string) : undefined;
      return entities[0];
    } catch (error) {
      throw new Error(`Failed to get account by username: ${(error as Error).message}`);
    }
  }
}

export default new AccountRepository();