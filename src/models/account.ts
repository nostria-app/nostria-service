import { Tier } from "../config/types";
import { AccountSubscription } from "./accountSubscription";

export interface Account {
  id: string; // For CosmosDB, this will be the pubkey
  type: 'account'; // Document type for CosmosDB querying
  pubkey: string;
  username?: string;
  tier: Tier;
  subscription: AccountSubscription;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  lastLoginDate?: Date;
};