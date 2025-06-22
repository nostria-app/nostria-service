import { Tier } from "../config/types";
import { AccountSubscription } from "./accountSubscription";

export interface Account {
  pubkey: string;
  username?: string;
  tier: Tier;
  subscription: AccountSubscription;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  lastLoginDate?: Date;
};