import { Feature, FeatureDetail } from "./types";

export const features: Record<Feature, FeatureDetail> = {
  'BASIC_WEBPUSH': { label: 'Basic web push notifications' },
  'COMMUNITY_SUPPORT': { label: 'Community support' },
  'USERNAME': { label: 'Username in URL' },
  'NEWSLETTER': { label: 'Newsletter' },
  'STORAGE_1GB': { label: '1GB cloud storage' },
  'STORAGE_5GB': { label: '5GB cloud storage' },
  'STORAGE_50GB': { label: '50GB cloud storage' },
  'DUAL_POST_X_10': { label: 'Dual post to X (max 10 posts/day)' },
  'ANALYTICS': { label: 'Analytics' },
  'CLOUD_BACKUP_COMING_SOON': { label: 'Cloud backup (coming soon)' },
  'MEMOS': { label: 'Memos' },
  'YOUTUBE': { label: 'YouTube' },
  'EXTRA_BACKUP_FEATURES': { label: 'Extra backup features' },
};