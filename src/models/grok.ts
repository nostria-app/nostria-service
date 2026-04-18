import { Tier } from '../config/types';

export type GrokOperationType = 'response' | 'image';
export type GrokTransactionType = 'topup' | 'usage' | 'adjustment';

export interface GrokBalance {
  pubkey: string;
  balanceNanosUsd: number;
  totalSpentNanosUsd: number;
  totalToppedUpNanosUsd: number;
  created: number;
  modified: number;
}

export interface GrokUsageRecord {
  id: string;
  pubkey: string;
  requestId: string;
  providerRequestId?: string;
  operationType: GrokOperationType;
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  imageCount: number;
  costNanosUsd: number;
  created: number;
  modified: number;
}

export interface GrokBalanceStatus {
  tier: Tier;
  enabled: boolean;
  allowResponses: boolean;
  allowImages: boolean;
  defaultResponseModel: string;
  defaultImageModel: string;
  minimumTopUpCents: number;
  maximumTopUpCents: number;
  defaultTopUpOptionsCents: number[];
  balanceNanosUsd: number;
  totalSpentNanosUsd: number;
  totalToppedUpNanosUsd: number;
  includedImagesPerMonth: number;
  includedImagesRemaining: number;
  imagesUsedThisMonth: number;
  imagesUsedToday: number;
  dailyImageLimit?: number;
  canGenerateImagesToday: boolean;
}

export interface GrokResponseCharge {
  requestId: string;
  providerRequestId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costNanosUsd: number;
  balanceNanosUsd: number;
}

export interface GrokImageCharge {
  requestId: string;
  providerRequestId?: string;
  model: string;
  imageCount: number;
  usedIncludedQuota: number;
  billedImages: number;
  costNanosUsd: number;
  balanceNanosUsd: number;
  includedImagesRemaining: number;
}