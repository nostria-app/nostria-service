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

export const billingCycleToDuration = (billingCycle: BillingCycle): number => {
  switch (billingCycle) {
    case 'monthly': return 31 * 24 * 60 * 60 * 1000; // 31 day
    case 'quarterly': return 92 * 24 * 60 * 60 * 1000; // 92 days
    case 'yearly': return 365 * 24 * 60 * 60 * 1000; // 365 days
  }
}

export const expiresAt = (billingCycle?: BillingCycle): number | undefined => {
  if (!billingCycle) return undefined;
  return now() + billingCycleToDuration(billingCycle);
};

/**
 * Calculate the new expiry date when renewing/extending a subscription.
 * If the current subscription hasn't expired, extends from the current expiry.
 * If it has expired, starts fresh from now.
 */
export const extendExpiry = (currentExpiry: number | undefined, billingCycle: BillingCycle): number => {
  const duration = billingCycleToDuration(billingCycle);
  const currentTime = now();
  
  if (currentExpiry && currentExpiry > currentTime) {
    // Subscription is still active, extend from current expiry
    return currentExpiry + duration;
  }
  
  // Subscription expired or no current expiry, start fresh from now
  return currentTime + duration;
};