import config from "../config";
import { Tier, BillingCycle, Price, Entitlements } from "../config/types";

export interface AccountSubscription {
  tier: Tier;
  expiryDate?: Date;
  billingCycle?: BillingCycle;
  price?: Price;
  entitlements: Entitlements;
};

export const DEFAULT_SUBSCRIPTION: AccountSubscription = {
  tier: 'free',
  entitlements: config.tiers['free'].entitlements,
};
