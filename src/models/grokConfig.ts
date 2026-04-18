export interface GrokResponseModelConfig {
  enabled: boolean;
  inputTokenNanosUsd: number;
  outputTokenNanosUsd: number;
}

export interface GrokImageModelConfig {
  enabled: boolean;
  imageNanosUsd: number;
  includedQuotaEligible: boolean;
}

export interface GrokConfig {
  enabled: boolean;
  allowResponses: boolean;
  allowImages: boolean;
  allowServerSideTools: boolean;
  guardrails: {
    responseSafetyMarginPercent: number;
  };
  defaults: {
    responseModel: string;
    imageModel: string;
  };
  topUp: {
    minimumCents: number;
    maximumCents: number;
    defaultOptionsCents: number[];
    nanosUsdPerCent: number;
  };
  quotas: {
    basic: {
      includedImagesPerMonth: number;
    };
    premium: {
      includedImagesPerMonth: number;
    };
    premiumPlus: {
      includedImagesPerMonth: number;
      dailyImageLimit: number;
    };
  };
  pricing: {
    responses: Record<string, GrokResponseModelConfig>;
    images: Record<string, GrokImageModelConfig>;
  };
}

export type GrokPublicConfig = GrokConfig;

export const DEFAULT_GROK_CONFIG: GrokConfig = {
  enabled: true,
  allowResponses: true,
  allowImages: true,
  allowServerSideTools: false,
  guardrails: {
    responseSafetyMarginPercent: 25,
  },
  defaults: {
    responseModel: 'grok-4-1-fast-reasoning',
    imageModel: 'grok-imagine-image',
  },
  topUp: {
    minimumCents: 100,
    maximumCents: 50000,
    defaultOptionsCents: [500, 1000, 2500],
    nanosUsdPerCent: 10000000,
  },
  quotas: {
    basic: {
      includedImagesPerMonth: 5,
    },
    premium: {
      includedImagesPerMonth: 10,
    },
    premiumPlus: {
      includedImagesPerMonth: 30,
      dailyImageLimit: 5,
    },
  },
  pricing: {
    responses: {
      'grok-4.20-0309-reasoning': {
        enabled: true,
        inputTokenNanosUsd: 2000,
        outputTokenNanosUsd: 6000,
      },
      'grok-4.20-0309-non-reasoning': {
        enabled: true,
        inputTokenNanosUsd: 2000,
        outputTokenNanosUsd: 6000,
      },
      'grok-4.20-multi-agent-0309': {
        enabled: true,
        inputTokenNanosUsd: 2000,
        outputTokenNanosUsd: 6000,
      },
      'grok-4-1-fast-reasoning': {
        enabled: true,
        inputTokenNanosUsd: 200,
        outputTokenNanosUsd: 500,
      },
      'grok-4-1-fast-non-reasoning': {
        enabled: true,
        inputTokenNanosUsd: 200,
        outputTokenNanosUsd: 500,
      },
    },
    images: {
      'grok-imagine-image': {
        enabled: true,
        imageNanosUsd: 20000000,
        includedQuotaEligible: true,
      },
      'grok-imagine-image-pro': {
        enabled: true,
        imageNanosUsd: 70000000,
        includedQuotaEligible: false,
      },
    },
  },
};