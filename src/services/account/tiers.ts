type FeatureDetail = {
  label: string
};

export type Feature = 'BASIC_WEBPUSH' | 'COMMUNITY_SUPPORT' | 'ADVANCED_FILTERING' | 'PRIORITY_SUPPORT' | 'CUSTOM_TEMPLATES' | 'API_ACCESS' | 'WEBHOOK' | 'ANALYTICS';

export const features: Record<Feature, FeatureDetail> = {
  'BASIC_WEBPUSH': { label: 'Basic web push notifications' },
  'COMMUNITY_SUPPORT': { label: 'Community support' },
  'ADVANCED_FILTERING': { label: 'Advanced notification filtering' },
  'PRIORITY_SUPPORT': { label: 'Priority support' },
  'CUSTOM_TEMPLATES': { label: 'Custom notification templates' },
  'API_ACCESS': { label: 'API access' },
  'WEBHOOK': { label: 'Webhook integrations' },
  'ANALYTICS': { label: 'Advanced analytics' },
};

export type BillingCycle = 'monthly' | 'quarterly' | 'yearly';

export type Price = {
  priceCents: number;
  currency: string;
};

export type Tier = 'free' | 'premium' | 'premium_plus';

type Pricing = Record<BillingCycle, Price>


export interface Entitlements {
  notificationsPerDay: number,
  features: Feature[]
}


interface TierDetails {
  tier: Tier;
  name: string;
  pricing?: Pricing;
  entitlements: Entitlements;
};

const BasicFeatures: Feature[] = [
  'BASIC_WEBPUSH',
  'COMMUNITY_SUPPORT',
];

const PremiumFeatures: Feature[] = [
  ...BasicFeatures,
  'ADVANCED_FILTERING',
  'PRIORITY_SUPPORT',
  'CUSTOM_TEMPLATES'
];

const PremiumPlusFeatures: Feature[] = [
  ...PremiumFeatures,
  'API_ACCESS',
  'WEBHOOK',
  'ANALYTICS'
];

export const tiers: Record<Tier, TierDetails> = {
  free: {
    tier: 'free',
    name: 'Free',
    entitlements: {
      notificationsPerDay: 5,
      features: BasicFeatures,
    }
  },
  premium: {
    tier: 'premium',
    name: 'Premium',
    pricing: {
      monthly: {
        priceCents: 1000,
        currency: 'USD',
      },
      quarterly: {
        priceCents: 2500,
        currency: 'USD',
      },
      yearly: {
        priceCents: 9000,
        currency: 'USD',
      },
    },
    entitlements: {
      notificationsPerDay: 50,
      features: PremiumFeatures,
    }
  },
  premium_plus: {
    tier: 'premium_plus',
    name: 'Premium+',
    pricing: {
      monthly: {
        priceCents: 2000,
        currency: 'USD',
      },
      quarterly: {
        priceCents: 5000,
        currency: 'USD',
      },
      yearly: {
        priceCents: 18000,
        currency: 'USD',
      },
    },
    entitlements: {
      notificationsPerDay: 500,
      features: PremiumPlusFeatures,
    }
  }
};