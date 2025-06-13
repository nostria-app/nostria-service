import BaseTableStorageService from "./BaseTableStorageService";

export interface Account {
  pubkey: string;
  email?: string;
  username?: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginDate?: Date;
}

type CreateAccountDto = Pick<Account, 'pubkey' | 'email'>

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

      const entities = await this.queryEntities(filter);
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
    return this.getEntity('account', pubkey)
  }
}

export default new AccountService();