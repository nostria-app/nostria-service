import { Config, Feature } from "./types";

const BasicFeatures: Feature[] = [
  'BASIC_WEBPUSH',
  'COMMUNITY_SUPPORT',
];

const PremiumFeatures: Feature[] = [
  ...BasicFeatures,
  'USERNAME',
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

const config: Config = {
  env: 'development',
  tiers: {
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
          priceCents: 1,
          currency: 'USD',
        },
        quarterly: {
          priceCents: 2,
          currency: 'USD',
        },
        yearly: {
          priceCents: 4,
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
          priceCents: 2,
          currency: 'USD',
        },
        quarterly: {
          priceCents: 3,
          currency: 'USD',
        },
        yearly: {
          priceCents: 5,
          currency: 'USD',
        },
      },
      entitlements: {
        notificationsPerDay: 500,
        features: PremiumPlusFeatures,
      }
    }
  }
};

export default config;