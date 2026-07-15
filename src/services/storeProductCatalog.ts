import { BillingCycle, Tier } from '../config/types';
import config from '../config';

export type StoreName = 'app-store' | 'play-store';

export interface StoreProductDefinition {
  productId: string;
  tier: Tier;
  billingCycle: BillingCycle;
  /** Fallback price when store does not report one */
  priceCents: number;
  /** One-time non-subscription SKUs (e.g. username) */
  kind: 'subscription' | 'one_time';
}

/**
 * Product IDs must match App Store Connect / Play Console and the
 * Angular InAppPurchaseService catalog in the nostria client.
 */
export const STORE_PRODUCTS: StoreProductDefinition[] = [
  {
    productId: 'nostria_premium_monthly',
    tier: 'premium',
    billingCycle: 'monthly',
    priceCents: 999,
    kind: 'subscription',
  },
  {
    productId: 'nostria_premium_quarterly',
    tier: 'premium',
    billingCycle: 'quarterly',
    priceCents: 3000,
    kind: 'subscription',
  },
  {
    productId: 'nostria_premium_yearly',
    tier: 'premium',
    billingCycle: 'yearly',
    priceCents: 9600,
    kind: 'subscription',
  },
  {
    productId: 'nostria_premium_plus_monthly',
    tier: 'premium_plus',
    billingCycle: 'monthly',
    priceCents: 4500,
    kind: 'subscription',
  },
  {
    productId: 'nostria_premium_plus_quarterly',
    tier: 'premium_plus',
    billingCycle: 'quarterly',
    priceCents: 13500,
    kind: 'subscription',
  },
  {
    productId: 'nostria_premium_plus_yearly',
    tier: 'premium_plus',
    billingCycle: 'yearly',
    priceCents: 43200,
    kind: 'subscription',
  },
  // App Store one-time username product (1 year of verified username / premium access)
  {
    productId: 'username',
    tier: 'premium',
    billingCycle: 'yearly',
    priceCents: 999,
    kind: 'one_time',
  },
];

export function getStoreProduct(productId: string): StoreProductDefinition | undefined {
  return STORE_PRODUCTS.find((p) => p.productId === productId);
}

export function resolvePriceCents(
  product: StoreProductDefinition
): number {
  const fromConfig =
    config.tiers[product.tier]?.pricing?.[product.billingCycle]?.priceCents;
  // Prefer App Store listed price for monthly premium first-release SKU
  if (product.productId === 'nostria_premium_monthly') {
    return product.priceCents;
  }
  return fromConfig ?? product.priceCents;
}
