export type Feature = 'BASIC_WEBPUSH' | 'COMMUNITY_SUPPORT' | 'USERNAME' | 'ADVANCED_FILTERING' | 'PRIORITY_SUPPORT' | 'CUSTOM_TEMPLATES' | 'API_ACCESS' | 'WEBHOOK' | 'ANALYTICS';

export type FeatureDetail = {
  label: string
};
export type BillingCycle = 'monthly' | 'quarterly' | 'yearly';

export type Price = {
  priceCents: number;
  currency: string;
};

export type Tier = 'free' | 'premium' | 'premium_plus';

export type Pricing = Record<BillingCycle, Price>

export interface Entitlements {
  notificationsPerDay: number,
  features: Feature[]
}

export interface TierDetails {
  tier: Tier;
  name: string;
  pricing?: Pricing;
  entitlements: Entitlements;
};

export type Config = {
  env: 'production' | 'development';
  tiers: Record<Tier, TierDetails>;
  admin: {
    pubkeys: string[];
  };
}
