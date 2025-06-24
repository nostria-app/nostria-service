import config from "../config";
import { Tier, BillingCycle, Price, Entitlements } from "../config/types";
import { now } from "../helpers/now";

export interface AccountSubscription {
  tier: Tier;
  expiryDate?: number;
  billingCycle?: BillingCycle;
  price?: Price;
  entitlements: Entitlements;
};

export const DEFAULT_SUBSCRIPTION: AccountSubscription = {
  tier: 'free',
  entitlements: config.tiers['free'].entitlements,
};

const billingCycleToDuration = (billingCycle: BillingCycle) => {
  switch (billingCycle) {
    case 'monthly': return 31 * 24 * 60 * 60 * 1000; // 31 day
    case 'quarterly': return 92 * 24 * 60 * 60 * 1000; // 92 days
    case 'yearly': return 365 * 24 * 60 * 60 * 1000; // 365 days
  }
}

export const expiresAt = (billingCycle?: BillingCycle) => {
  if (!billingCycle) return undefined;
  return now() + billingCycleToDuration(billingCycle);
};