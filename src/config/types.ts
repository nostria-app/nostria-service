export type Feature =
  | 'BASIC_WEBPUSH'
  | 'COMMUNITY_SUPPORT'
  | 'USERNAME'
  | 'NEWSLETTER'
  | 'STORAGE_1GB'
  | 'STORAGE_5GB'
  | 'STORAGE_50GB'
  | 'DUAL_POST_X_10'
  | 'ANALYTICS'
  | 'CLOUD_BACKUP_COMING_SOON'
  | 'MEMOS'
  | 'YOUTUBE'
  | 'EXTRA_BACKUP_FEATURES';

export type FeatureDetail = {
  label: string
};
export type BillingCycle = 'monthly' | 'quarterly' | 'yearly';

export type Price = {
  priceCents: number;
  currency: string;
};

export type Tier = 'free' | 'basic' | 'premium' | 'premium_plus';

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
  nostrZap?: {
    relays: string[];
    notificationPrivateKey?: string; // Private key for "Nostria Premium" account to post notifications
  };
  nwc?: {
    connectionString?: string;
    timeoutMs: number;
  };
}
