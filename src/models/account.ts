export interface Account {
  pubkey: string;
  username?: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginDate?: Date;
};