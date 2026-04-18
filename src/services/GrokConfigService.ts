import { Prisma } from '@prisma/client';

import PrismaClientSingleton from '../database/prismaClient';
import { now } from '../helpers/now';
import { DEFAULT_GROK_CONFIG, GrokConfig, GrokImageModelConfig, GrokPublicConfig, GrokResponseModelConfig } from '../models/grokConfig';
import logger from '../utils/logger';

const GROK_CONFIG_ID = 'default';

class GrokConfigService {
  private readonly prisma = PrismaClientSingleton.getInstance();

  async getConfig(): Promise<GrokConfig> {
    try {
      const ts = now();
      const record = await this.prisma.grokConfig.upsert({
        where: { id: GROK_CONFIG_ID },
        update: {},
        create: {
          id: GROK_CONFIG_ID,
          settings: DEFAULT_GROK_CONFIG as unknown as object,
          created: BigInt(ts),
          modified: BigInt(ts),
        },
      });

      return this.normalizeConfig(record.settings);
    } catch (error) {
      if (this.isMissingGrokConfigTableError(error)) {
        logger.warn('grok_config table is missing; using in-memory default Grok config until the database migration is applied');
        return this.normalizeConfig(DEFAULT_GROK_CONFIG);
      }

      throw error;
    }
  }

  async getPublicConfig(): Promise<GrokPublicConfig> {
    return this.getConfig();
  }

  async updateConfig(updates: Partial<GrokConfig>): Promise<GrokConfig> {
    const current = await this.getConfig();
    const next = this.normalizeConfig({
      ...current,
      ...updates,
      guardrails: {
        ...current.guardrails,
        ...(updates.guardrails || {}),
      },
      defaults: {
        ...current.defaults,
        ...(updates.defaults || {}),
      },
      topUp: {
        ...current.topUp,
        ...(updates.topUp || {}),
      },
      quotas: {
        basic: {
          ...current.quotas.basic,
          ...(updates.quotas?.basic || {}),
        },
        premium: {
          ...current.quotas.premium,
          ...(updates.quotas?.premium || {}),
        },
        premiumPlus: {
          ...current.quotas.premiumPlus,
          ...(updates.quotas?.premiumPlus || {}),
        },
      },
      pricing: {
        responses: {
          ...current.pricing.responses,
          ...(updates.pricing?.responses || {}),
        },
        images: {
          ...current.pricing.images,
          ...(updates.pricing?.images || {}),
        },
      },
    });

    try {
      await this.prisma.grokConfig.update({
        where: { id: GROK_CONFIG_ID },
        data: {
          settings: next as unknown as object,
          modified: BigInt(now()),
        },
      });
    } catch (error) {
      if (this.isMissingGrokConfigTableError(error)) {
        throw new Error('The grok_config table does not exist yet. Run the database migration before saving Grok settings.');
      }

      throw error;
    }

    return next;
  }

  private isMissingGrokConfigTableError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === 'P2021'
      && String(error.message).includes('grok_config');
  }

  private normalizeConfig(value: unknown): GrokConfig {
    const source = this.asRecord(value);
    const defaultResponsePricing = this.normalizeResponsePricing(source['pricing'], DEFAULT_GROK_CONFIG.pricing.responses);
    const defaultImagePricing = this.normalizeImagePricing(source['pricing'], DEFAULT_GROK_CONFIG.pricing.images);
    const quotas = this.asRecord(source['quotas']);
    const topUp = this.asRecord(source['topUp']);
    const guardrails = this.asRecord(source['guardrails']);
    const defaults = this.asRecord(source['defaults']);

    const config: GrokConfig = {
      enabled: this.asBoolean(source['enabled'], DEFAULT_GROK_CONFIG.enabled),
      allowResponses: this.asBoolean(source['allowResponses'], DEFAULT_GROK_CONFIG.allowResponses),
      allowImages: this.asBoolean(source['allowImages'], DEFAULT_GROK_CONFIG.allowImages),
      allowServerSideTools: this.asBoolean(source['allowServerSideTools'], DEFAULT_GROK_CONFIG.allowServerSideTools),
      guardrails: {
        responseSafetyMarginPercent: Math.min(
          500,
          this.asNonNegativeInt(guardrails['responseSafetyMarginPercent'], DEFAULT_GROK_CONFIG.guardrails.responseSafetyMarginPercent),
        ),
      },
      defaults: {
        responseModel: this.asString(defaults['responseModel'], DEFAULT_GROK_CONFIG.defaults.responseModel),
        imageModel: this.asString(defaults['imageModel'], DEFAULT_GROK_CONFIG.defaults.imageModel),
      },
      topUp: {
        minimumCents: this.asPositiveInt(topUp['minimumCents'], DEFAULT_GROK_CONFIG.topUp.minimumCents),
        maximumCents: this.asPositiveInt(topUp['maximumCents'], DEFAULT_GROK_CONFIG.topUp.maximumCents),
        defaultOptionsCents: this.normalizeTopUpOptions(topUp['defaultOptionsCents'], DEFAULT_GROK_CONFIG.topUp.defaultOptionsCents),
        nanosUsdPerCent: this.asPositiveInt(topUp['nanosUsdPerCent'], DEFAULT_GROK_CONFIG.topUp.nanosUsdPerCent),
      },
      quotas: {
        basic: {
          includedImagesPerMonth: this.asPositiveInt(this.asRecord(quotas['basic'])['includedImagesPerMonth'], DEFAULT_GROK_CONFIG.quotas.basic.includedImagesPerMonth),
        },
        premium: {
          includedImagesPerMonth: this.asPositiveInt(this.asRecord(quotas['premium'])['includedImagesPerMonth'], DEFAULT_GROK_CONFIG.quotas.premium.includedImagesPerMonth),
        },
        premiumPlus: {
          includedImagesPerMonth: this.asPositiveInt(this.asRecord(quotas['premiumPlus'])['includedImagesPerMonth'], DEFAULT_GROK_CONFIG.quotas.premiumPlus.includedImagesPerMonth),
          dailyImageLimit: this.asPositiveInt(this.asRecord(quotas['premiumPlus'])['dailyImageLimit'], DEFAULT_GROK_CONFIG.quotas.premiumPlus.dailyImageLimit),
        },
      },
      pricing: {
        responses: defaultResponsePricing,
        images: defaultImagePricing,
      },
    };

    if (!config.pricing.responses[config.defaults.responseModel]?.enabled) {
      config.defaults.responseModel = DEFAULT_GROK_CONFIG.defaults.responseModel;
    }

    if (!config.pricing.images[config.defaults.imageModel]?.enabled) {
      config.defaults.imageModel = DEFAULT_GROK_CONFIG.defaults.imageModel;
    }

    if (config.topUp.maximumCents < config.topUp.minimumCents) {
      config.topUp.maximumCents = config.topUp.minimumCents;
    }

    config.topUp.defaultOptionsCents = config.topUp.defaultOptionsCents
      .filter(amount => amount >= config.topUp.minimumCents && amount <= config.topUp.maximumCents);

    if (config.topUp.defaultOptionsCents.length === 0) {
      config.topUp.defaultOptionsCents = DEFAULT_GROK_CONFIG.topUp.defaultOptionsCents.filter(
        amount => amount >= config.topUp.minimumCents && amount <= config.topUp.maximumCents,
      );
    }

    return config;
  }

  private normalizeResponsePricing(pricingValue: unknown, fallback: Record<string, GrokResponseModelConfig>): Record<string, GrokResponseModelConfig> {
    const pricing = this.asRecord(this.asRecord(pricingValue)['responses']);
    return Object.fromEntries(Object.entries(fallback).map(([model, defaults]) => {
      const source = this.asRecord(pricing[model]);
      return [model, {
        enabled: this.asBoolean(source['enabled'], defaults.enabled),
        inputTokenNanosUsd: this.asPositiveInt(source['inputTokenNanosUsd'], defaults.inputTokenNanosUsd),
        outputTokenNanosUsd: this.asPositiveInt(source['outputTokenNanosUsd'], defaults.outputTokenNanosUsd),
      } satisfies GrokResponseModelConfig];
    }));
  }

  private normalizeImagePricing(pricingValue: unknown, fallback: Record<string, GrokImageModelConfig>): Record<string, GrokImageModelConfig> {
    const pricing = this.asRecord(this.asRecord(pricingValue)['images']);
    return Object.fromEntries(Object.entries(fallback).map(([model, defaults]) => {
      const source = this.asRecord(pricing[model]);
      return [model, {
        enabled: this.asBoolean(source['enabled'], defaults.enabled),
        imageNanosUsd: this.asPositiveInt(source['imageNanosUsd'], defaults.imageNanosUsd),
        includedQuotaEligible: this.asBoolean(source['includedQuotaEligible'], defaults.includedQuotaEligible),
      } satisfies GrokImageModelConfig];
    }));
  }

  private normalizeTopUpOptions(value: unknown, fallback: number[]): number[] {
    if (!Array.isArray(value)) {
      return [...fallback];
    }

    const numbers = value
      .map(entry => this.asPositiveInt(entry, 0))
      .filter(entry => entry > 0);

    return Array.from(new Set(numbers)).sort((left, right) => left - right);
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private asBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
  }

  private asString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
  }

  private asPositiveInt(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.round(parsed);
  }

  private asNonNegativeInt(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
    if (!Number.isFinite(parsed) || parsed < 0) {
      return fallback;
    }
    return Math.round(parsed);
  }
}

export default GrokConfigService;