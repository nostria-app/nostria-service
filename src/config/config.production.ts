import { Config, Feature } from "./types";

const FreeFeatures: Feature[] = [
  'BASIC_WEBPUSH',
  'COMMUNITY_SUPPORT',
];

const BasicFeatures: Feature[] = [
  ...FreeFeatures,
  'USERNAME',
  'STORAGE_1GB',
];

const PremiumFeatures: Feature[] = [
  ...BasicFeatures,
  'STORAGE_5GB',
];

const PremiumPlusFeatures: Feature[] = [
  ...PremiumFeatures,
  'NEWSLETTER',
  'STORAGE_50GB',
  'DUAL_POST_X_10',
  'ANALYTICS',
  'CLOUD_BACKUP_COMING_SOON',
  'MEMOS',
  'YOUTUBE',
  'EXTRA_BACKUP_FEATURES',
];

const config: Config = {
  env: 'production',
    admin: {
      pubkeys: process.env.ADMIN_PUBKEYS ? process.env.ADMIN_PUBKEYS.split(',').map(key => key.trim()) : []
    },
    tiers: {
      free: {
        tier: 'free',
        name: 'Free',
        entitlements: {
          notificationsPerDay: 5,
          features: FreeFeatures,
        }
      },
      basic: {
        tier: 'basic',
        name: 'Basic',
        pricing: {
          monthly: {
            priceCents: 500,
            currency: 'USD',
          },
          quarterly: {
            priceCents: 1500,
            currency: 'USD',
          },
          yearly: {
            priceCents: 4800,
            currency: 'USD',
          },
        },
        entitlements: {
          notificationsPerDay: 50,
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
            priceCents: 3000,
            currency: 'USD',
          },
          yearly: {
            priceCents: 9600,
            currency: 'USD',
          },
        },
        entitlements: {
          notificationsPerDay: 150,
          features: PremiumFeatures,
        }
      },
      premium_plus: {
        tier: 'premium_plus',
        name: 'Premium+',
        pricing: {
          monthly: {
            priceCents: 4500,
            currency: 'USD',
          },
          quarterly: {
            priceCents: 13500,
            currency: 'USD',
          },
          yearly: {
            priceCents: 43200,
            currency: 'USD',
          },
        },
        entitlements: {
          notificationsPerDay: 500,
          features: PremiumPlusFeatures,
        }
      }
    },
    nostrZap: {
      relays: process.env.NOSTR_ZAP_RELAYS 
        ? process.env.NOSTR_ZAP_RELAYS.split(',').map(r => r.trim())
        : [
            'wss://ribo.eu.nostria.app',
            'wss://ribo.af.nostria.app',
            'wss://ribo.us.nostria.app',
            'wss://relay.damus.io',
            'wss://relay.primal.net'
          ],
      notificationPrivateKey: process.env.NOSTR_PREMIUM_NOTIFICATION_PRIVATE_KEY
    },
    nwc: {
      connectionString: process.env.NOSTRIA_NWC_CONNECTION_STRING,
      timeoutMs: process.env.NOSTRIA_NWC_TIMEOUT_MS ? Number(process.env.NOSTRIA_NWC_TIMEOUT_MS) : 30000
    }
  };

  export default config;
