import BaseTableStorageService, { TableEntity } from "./BaseTableStorageService";

export interface Account {
  pubkey: string;
  email: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastLoginDate?: Date;
}

type CreateAccountDto = Pick<Account, 'pubkey' | 'email'>

const toAccount = ({ rowKey, partitionKey, ...data }: TableEntity<Account>): Account => data;

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

  async getAccount(pubkey: string): Promise<Account | null> {
    const entity = await this.getEntity('account', pubkey)
    return entity ? toAccount(entity) : null
  }
}

export default new AccountService();