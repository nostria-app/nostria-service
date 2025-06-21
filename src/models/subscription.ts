import { Tier, BillingCycle, Price, Entitlements, tiers } from "../services/account/tiers";

export interface Subscription {
  tier: Tier;
  expiryDate?: Date;
  billingCycle?: BillingCycle;
  price?: Price;
  entitlements: Entitlements;
};

export const DEFAULT_SUBSCRIPTION: Subscription = {
  tier: 'free',
  entitlements: tiers['free'].entitlements,
};
