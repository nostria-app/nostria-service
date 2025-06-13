import { TableEntityResult } from "@azure/data-tables";
import BaseTableStorageService, { TableEntity } from "./BaseTableStorageService";

export interface Account {
  pubkey: string;
  email?: string;
  username?: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginDate?: Date;
}

type CreateAccountDto = Pick<Account, 'pubkey' | 'email'>

const toAccount = ({ rowKey, partitionKey, ...data }: TableEntityResult<Account>): Account => data;

class AccountService extends BaseTableStorageService<Account> {
  constructor() {
    super("accounts");
  }

  async addAccount({ pubkey, email }: CreateAccountDto): Promise<Account> {
    const now = new Date();

    const account: Account = {
      pubkey,
      email,
      createdAt: now,
      updatedAt: now,
    };

    await this.tableClient.upsertEntity({
      partitionKey: 'account',
      rowKey: pubkey,
      ...account,
    }, 'Replace')

    return account;
  }

  async isUsernameTaken(username: string, excludePubkey?: string): Promise<boolean> {
    try {
      // Query for any account with this username, excluding the current account if specified
      const filter = excludePubkey
        ? `username eq '${username}' and rowKey ne '${excludePubkey}'`
        : `username eq '${username}'`;

      const iterator = this.tableClient.listEntities({ queryOptions: { filter } });
      const entities = [];
      for await (const entity of iterator) {
        entities.push(entity);
      }
      return entities.length > 0;
    } catch (error) {
      throw new Error(`Failed to check username uniqueness: ${(error as Error).message}`);
    }
  }

  async updateAccount(account: Account): Promise<Account> {
    // If username is being set or changed, check for uniqueness
    if (account.username) {
      const isTaken = await this.isUsernameTaken(account.username, account.pubkey);
      if (isTaken) {
        throw new Error('Username is already taken');
      }
    }

    const updated: Account = {
      ...account,
      updatedAt: new Date()
    };

    await this.tableClient.upsertEntity({
      partitionKey: 'account',
      rowKey: account.pubkey,
      ...updated,
    }, 'Replace');

    return updated;
  }

  async getAccount(pubkey: string): Promise<Account | null> {
    const entity = await this.getEntity('account', pubkey)
    return entity ? toAccount(entity) : null
  }
}

export default new AccountService();