import { Tier } from "../config/types";

export interface Account {
  pubkey: string;
  username?: string;
  tier: Tier;
  // TODO: make it a proper object once we move to Cosmos DB
  subscription?: string; // stringifed AccountSubscription
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  lastLoginDate?: Date;
};