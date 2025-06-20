import { Feature, FeatureDetail } from "./types";

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