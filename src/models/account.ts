import { Tier } from "../config/types";
import { AccountSubscription } from "./accountSubscription";

export interface Account {
  id: string; // For CosmosDB, this will be the pubkey
  type: 'account' | string; // Document type for CosmosDB querying
  pubkey: string;
  username?: string;
  tier: Tier;
  subscription: AccountSubscription;
  expires?: number;
  created: number;
  modified: number;
  lastLoginDate?: number;
};