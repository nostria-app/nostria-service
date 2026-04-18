import { v4 as uuidv4 } from 'uuid';

import RepositoryFactory from '../database/RepositoryFactory';
import PrismaClientSingleton from '../database/prismaClient';
import { now } from '../helpers/now';
import { GrokConfig, GrokImageModelConfig, GrokResponseModelConfig } from '../models/grokConfig';
import { GrokBalanceStatus, GrokImageCharge, GrokResponseCharge } from '../models/grok';
import { INVOICE_TTL, Payment } from '../models/payment';
import logger from '../utils/logger';
import GrokConfigService from './GrokConfigService';
import lightningService from './LightningService';

type TierQuota = {
  includedImagesPerMonth: number;
  dailyImageLimit?: number;
};

type ResponseUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

type XAIErrorPayload = {
  error?: {
    message?: string;
    type?: string;
  };
  message?: string;
};

export class GrokPremiumRequiredError extends Error {
  constructor() {
    super('Grok requires an active paid Nostria subscription');
    this.name = 'GrokPremiumRequiredError';
  }
}

export class GrokBalanceRequiredError extends Error {
  constructor(message: string = 'Your Grok balance is too low. Increase your credits to continue.') {
    super(message);
    this.name = 'GrokBalanceRequiredError';
  }
}

export class GrokQuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrokQuotaExceededError';
  }
}

export class GrokUnsupportedRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrokUnsupportedRequestError';
  }
}

export class GrokUpstreamError extends Error {
  statusCode: number;
  body?: unknown;

  constructor(statusCode: number, message: string, body?: unknown) {
    super(message);
    this.name = 'GrokUpstreamError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const MAX_ALLOWED_OUTPUT_TOKENS = 8192;

class GrokService {
  private readonly accountRepository = RepositoryFactory.getAccountRepository();
  private readonly paymentRepository = RepositoryFactory.getPaymentRepository();
  private readonly prisma = PrismaClientSingleton.getInstance();
  private readonly configService = new GrokConfigService();
  private readonly baseUrl = process.env.XAI_BASE_URL || 'https://api.x.ai/v1';
  private readonly apiKey = process.env.XAI_API_KEY || '';

  private assertConfigured(config: GrokConfig): void {
    if (!config.enabled) {
      throw new GrokUnsupportedRequestError('Grok is currently disabled on the server');
    }

    if (!this.apiKey) {
      throw new Error('xAI is not configured on the server');
    }
  }

  private async requirePaidSubscription(pubkey: string): Promise<'basic' | 'premium' | 'premium_plus'> {
    const account = await this.accountRepository.getByPubkey(pubkey);
    const ts = now();
    const isActive = !!account && (!account.expires || account.expires > ts);

    if (!account || !isActive) {
      throw new GrokPremiumRequiredError();
    }

    if (account.tier === 'basic' || account.tier === 'premium' || account.tier === 'premium_plus') {
      return account.tier;
    }

    throw new GrokPremiumRequiredError();
  }

  private getQuota(tier: 'basic' | 'premium' | 'premium_plus', config: GrokConfig): TierQuota {
    if (tier === 'basic') {
      return { includedImagesPerMonth: config.quotas.basic.includedImagesPerMonth };
    }

    if (tier === 'premium') {
      return { includedImagesPerMonth: config.quotas.premium.includedImagesPerMonth };
    }

    return {
      includedImagesPerMonth: config.quotas.premiumPlus.includedImagesPerMonth,
      dailyImageLimit: config.quotas.premiumPlus.dailyImageLimit,
    };
  }

  private getMonthRange(ts: number): { start: number; end: number } {
    const date = new Date(ts);
    const start = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
    return { start, end };
  }

  private getDayRange(ts: number): { start: number; end: number } {
    const date = new Date(ts);
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    return { start, end };
  }

  private toNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private extractStrings(value: unknown): string[] {
    if (typeof value === 'string') {
      return [value];
    }

    if (Array.isArray(value)) {
      return value.flatMap(item => this.extractStrings(item));
    }

    if (value && typeof value === 'object') {
      return Object.values(value).flatMap(item => this.extractStrings(item));
    }

    return [];
  }

  private estimateInputTokens(payload: unknown): number {
    const text = this.extractStrings(payload).join(' ');
    if (!text) {
      return 0;
    }

    return Math.max(1, Math.ceil(text.length / 4));
  }

  private getRequestedOutputTokens(payload: Record<string, unknown>): number {
    const candidate = this.toNumber(
      payload.max_output_tokens
      ?? payload.max_completion_tokens
      ?? payload.max_tokens
      ?? DEFAULT_MAX_OUTPUT_TOKENS
    );

    return Math.min(Math.max(1, Math.floor(candidate || DEFAULT_MAX_OUTPUT_TOKENS)), MAX_ALLOWED_OUTPUT_TOKENS);
  }

  private applyResponseSafetyMargin(costNanosUsd: number, config: GrokConfig): number {
    const marginPercent = config.guardrails.responseSafetyMarginPercent;
    if (marginPercent <= 0) {
      return costNanosUsd;
    }

    return Math.ceil(costNanosUsd * (1 + (marginPercent / 100)));
  }

  private getResponsePricing(model: string, config: GrokConfig): GrokResponseModelConfig | null {
    const entry = config.pricing.responses[model];
    return entry?.enabled ? entry : null;
  }

  private getImagePricing(model: string, config: GrokConfig): GrokImageModelConfig | null {
    const entry = config.pricing.images[model];
    return entry?.enabled ? entry : null;
  }

  private assertNoTools(payload: Record<string, unknown>, config: GrokConfig): void {
    if (payload.stream === true) {
      throw new GrokUnsupportedRequestError('Streaming Grok requests are not supported through nostria-service');
    }

    if (!config.allowServerSideTools && Array.isArray(payload.tools) && payload.tools.length > 0) {
      throw new GrokUnsupportedRequestError('Server-side xAI tools are not supported through nostria-service yet');
    }
  }

  private async getOrCreateBalance(pubkey: string): Promise<{ balanceNanosUsd: number; totalSpentNanosUsd: number; totalToppedUpNanosUsd: number }> {
    const ts = now();
    const balance = await this.prisma.grokBalance.upsert({
      where: { pubkey },
      update: {},
      create: {
        pubkey,
        balanceNanosUsd: BigInt(0),
        totalSpentNanosUsd: BigInt(0),
        totalToppedUpNanosUsd: BigInt(0),
        created: BigInt(ts),
        modified: BigInt(ts),
      },
    });

    return {
      balanceNanosUsd: Number(balance.balanceNanosUsd),
      totalSpentNanosUsd: Number(balance.totalSpentNanosUsd),
      totalToppedUpNanosUsd: Number(balance.totalToppedUpNanosUsd),
    };
  }

  private async countImages(pubkey: string, start: number, end: number): Promise<number> {
    const aggregate = await this.prisma.grokUsage.aggregate({
      _sum: { imageCount: true },
      where: {
        pubkey,
        operationType: 'image',
        created: {
          gte: BigInt(start),
          lt: BigInt(end),
        },
      },
    });

    return aggregate._sum.imageCount || 0;
  }

  private async recordUsageAndCharge(params: {
    pubkey: string;
    requestId: string;
    providerRequestId?: string;
    operationType: 'response' | 'image';
    model: string;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    imageCount: number;
    costNanosUsd: number;
    description: string;
  }): Promise<number> {
    const ts = now();

    const result = await this.prisma.$transaction(async tx => {
      const current = await tx.grokBalance.upsert({
        where: { pubkey: params.pubkey },
        update: {},
        create: {
          pubkey: params.pubkey,
          balanceNanosUsd: BigInt(0),
          totalSpentNanosUsd: BigInt(0),
          totalToppedUpNanosUsd: BigInt(0),
          created: BigInt(ts),
          modified: BigInt(ts),
        },
      });

      const updatedBalance = Number(current.balanceNanosUsd) - params.costNanosUsd;

      const balance = await tx.grokBalance.update({
        where: { pubkey: params.pubkey },
        data: {
          balanceNanosUsd: BigInt(updatedBalance),
          totalSpentNanosUsd: BigInt(Number(current.totalSpentNanosUsd) + params.costNanosUsd),
          modified: BigInt(ts),
        },
      });

      await tx.grokUsage.create({
        data: {
          pubkey: params.pubkey,
          requestId: params.requestId,
          providerRequestId: params.providerRequestId,
          operationType: params.operationType,
          model: params.model,
          inputTokens: params.inputTokens,
          outputTokens: params.outputTokens,
          reasoningTokens: params.reasoningTokens,
          imageCount: params.imageCount,
          costNanosUsd: BigInt(params.costNanosUsd),
          created: BigInt(ts),
          modified: BigInt(ts),
        },
      });

      if (params.costNanosUsd > 0) {
        await tx.grokTransaction.create({
          data: {
            pubkey: params.pubkey,
            transactionType: 'usage',
            amountNanosUsd: BigInt(-params.costNanosUsd),
            balanceAfterNanosUsd: balance.balanceNanosUsd,
            requestId: params.requestId,
            description: params.description,
            created: BigInt(ts),
            modified: BigInt(ts),
          },
        });
      }

      return Number(balance.balanceNanosUsd);
    });

    return result;
  }

  private async chargeTopUp(payment: Payment): Promise<number> {
    const creditNanosUsd = payment.creditNanosUsd;

    if (!creditNanosUsd) {
      return 0;
    }

    const ts = now();
    const result = await this.prisma.$transaction(async tx => {
      const latestPayment = await tx.payment.findFirst({
        where: {
          id: payment.id,
          pubkey: payment.pubkey,
        },
      });

      if (!latestPayment || latestPayment.applied) {
        const currentBalance = await tx.grokBalance.findUnique({ where: { pubkey: payment.pubkey } });
        return Number(currentBalance?.balanceNanosUsd || 0n);
      }

      const current = await tx.grokBalance.upsert({
        where: { pubkey: payment.pubkey },
        update: {},
        create: {
          pubkey: payment.pubkey,
          balanceNanosUsd: BigInt(0),
          totalSpentNanosUsd: BigInt(0),
          totalToppedUpNanosUsd: BigInt(0),
          created: BigInt(ts),
          modified: BigInt(ts),
        },
      });

      const newBalance = Number(current.balanceNanosUsd) + creditNanosUsd;

      const balance = await tx.grokBalance.update({
        where: { pubkey: payment.pubkey },
        data: {
          balanceNanosUsd: BigInt(newBalance),
          totalToppedUpNanosUsd: BigInt(Number(current.totalToppedUpNanosUsd) + creditNanosUsd),
          modified: BigInt(ts),
        },
      });

      await tx.grokTransaction.create({
        data: {
          pubkey: payment.pubkey,
          transactionType: 'topup',
          amountNanosUsd: BigInt(creditNanosUsd),
          balanceAfterNanosUsd: balance.balanceNanosUsd,
          paymentId: payment.id,
          description: 'Grok balance top-up',
          created: BigInt(ts),
          modified: BigInt(ts),
        },
      });

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          applied: BigInt(ts),
          modified: BigInt(ts),
        },
      });

      return Number(balance.balanceNanosUsd);
    });

    return result;
  }

  private async callXAI<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    const config = await this.configService.getConfig();
    this.assertConfigured(config);

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    const parsed = responseText ? JSON.parse(responseText) as T | XAIErrorPayload : {};

    if (!response.ok) {
      const message = (parsed as XAIErrorPayload)?.error?.message || (parsed as XAIErrorPayload)?.message || 'xAI request failed';
      throw new GrokUpstreamError(response.status, message, parsed);
    }

    return parsed as T;
  }

  async getStatus(pubkey: string): Promise<GrokBalanceStatus> {
    const tier = await this.requirePaidSubscription(pubkey);
    const config = await this.configService.getConfig();
    const quota = this.getQuota(tier, config);
    const ts = now();
    const { start: monthStart, end: monthEnd } = this.getMonthRange(ts);
    const { start: dayStart, end: dayEnd } = this.getDayRange(ts);
    const [balance, imagesUsedThisMonth, imagesUsedToday] = await Promise.all([
      this.getOrCreateBalance(pubkey),
      this.countImages(pubkey, monthStart, monthEnd),
      this.countImages(pubkey, dayStart, dayEnd),
    ]);

    const includedImagesRemaining = Math.max(0, quota.includedImagesPerMonth - imagesUsedThisMonth);
    const canGenerateImagesToday = quota.dailyImageLimit === undefined || imagesUsedToday < quota.dailyImageLimit;

    return {
      tier,
      enabled: config.enabled,
      allowResponses: config.allowResponses,
      allowImages: config.allowImages,
      defaultResponseModel: config.defaults.responseModel,
      defaultImageModel: config.defaults.imageModel,
      minimumTopUpCents: config.topUp.minimumCents,
      maximumTopUpCents: config.topUp.maximumCents,
      defaultTopUpOptionsCents: config.topUp.defaultOptionsCents,
      balanceNanosUsd: balance.balanceNanosUsd,
      totalSpentNanosUsd: balance.totalSpentNanosUsd,
      totalToppedUpNanosUsd: balance.totalToppedUpNanosUsd,
      includedImagesPerMonth: quota.includedImagesPerMonth,
      includedImagesRemaining,
      imagesUsedThisMonth,
      imagesUsedToday,
      dailyImageLimit: quota.dailyImageLimit,
      canGenerateImagesToday,
    };
  }

  async createTopUpPayment(pubkey: string, amountCents: number): Promise<Payment> {
    const tier = await this.requirePaidSubscription(pubkey);
    const config = await this.configService.getConfig();

    if (!Number.isInteger(amountCents) || amountCents < config.topUp.minimumCents || amountCents > config.topUp.maximumCents) {
      throw new GrokUnsupportedRequestError(`Top-up amount must be between ${config.topUp.minimumCents} and ${config.topUp.maximumCents} cents`);
    }

    const usdRate = await lightningService.getUsdBtcRate();
    const usdAmount = amountCents / 100;
    const satoshis = Math.round((usdAmount / usdRate) * 100000000);
    const invoiceId = uuidv4();
    const invoiceData = await lightningService.createInvoice(satoshis, invoiceId, 'NostriaGrokTopup');
    const ts = now();

    return this.paymentRepository.create({
      id: `payment-${invoiceId}`,
      type: 'payment',
      paymentType: 'ln',
      lnHash: invoiceData.paymentHash,
      lnInvoice: invoiceData.serialized,
      lnAmountSat: invoiceData.amountSat,
      purpose: 'grok_topup',
      tier,
      billingCycle: 'one_time',
      priceCents: amountCents,
      creditNanosUsd: amountCents * config.topUp.nanosUsdPerCent,
      pubkey,
      isPaid: false,
      applied: undefined,
      expires: ts + INVOICE_TTL,
      created: ts,
      modified: ts,
    });
  }

  async applyTopUpPayment(paymentId: string, pubkey: string): Promise<number> {
    const payment = await this.paymentRepository.get(paymentId, pubkey);

    if (!payment || payment.pubkey !== pubkey) {
      throw new Error('Payment not found');
    }

    if ((payment.purpose || 'subscription') !== 'grok_topup') {
      throw new Error('Payment is not a Grok top-up payment');
    }

    if (!payment.isPaid) {
      throw new Error('Payment has not been completed');
    }

    return this.chargeTopUp(payment);
  }

  async createResponse(pubkey: string, payload: Record<string, unknown>): Promise<{ response: unknown; charge: GrokResponseCharge }> {
    await this.requirePaidSubscription(pubkey);
    const config = await this.configService.getConfig();
    this.assertConfigured(config);
    if (!config.allowResponses) {
      throw new GrokUnsupportedRequestError('Grok text generation is currently disabled on the server');
    }
    this.assertNoTools(payload, config);

    const model = typeof payload.model === 'string' && payload.model.trim().length > 0
      ? payload.model.trim()
      : config.defaults.responseModel;
    const pricing = this.getResponsePricing(model, config);
    if (!pricing) {
      throw new GrokUnsupportedRequestError('Unsupported xAI response model');
    }
    const balance = await this.getOrCreateBalance(pubkey);
    const estimatedInputTokens = this.estimateInputTokens(payload.input ?? payload.messages ?? payload);
    const requestedOutputTokens = this.getRequestedOutputTokens(payload);
    const estimatedCost = (estimatedInputTokens * pricing.inputTokenNanosUsd) + (requestedOutputTokens * pricing.outputTokenNanosUsd);
    const requiredBalance = this.applyResponseSafetyMargin(estimatedCost, config);

    if (balance.balanceNanosUsd < requiredBalance) {
      throw new GrokBalanceRequiredError('Your Grok balance is too low for this request after applying the response safety margin. Increase your credits to continue.');
    }

    const requestId = uuidv4();
    const response = await this.callXAI<Record<string, unknown>>('/responses', payload);
    const usage = (response.usage as Record<string, unknown> | undefined) || {};
    const inputTokens = this.toNumber(usage.input_tokens) || estimatedInputTokens;
    const outputTokens = this.toNumber(usage.output_tokens);
    const reasoningTokens = this.toNumber(usage.reasoning_tokens);
    const actualCost = Math.max(
      estimatedCost,
      (inputTokens * pricing.inputTokenNanosUsd) + (outputTokens * pricing.outputTokenNanosUsd)
    );

    const balanceNanosUsd = await this.recordUsageAndCharge({
      pubkey,
      requestId,
      providerRequestId: typeof response.id === 'string' ? response.id : undefined,
      operationType: 'response',
      model,
      inputTokens,
      outputTokens,
      reasoningTokens,
      imageCount: 0,
      costNanosUsd: actualCost,
      description: `xAI response request using ${model}`,
    });

    return {
      response,
      charge: {
        requestId,
        providerRequestId: typeof response.id === 'string' ? response.id : undefined,
        model,
        inputTokens,
        outputTokens,
        reasoningTokens,
        costNanosUsd: actualCost,
        balanceNanosUsd,
      },
    };
  }

  async createImages(pubkey: string, payload: Record<string, unknown>): Promise<{ response: unknown; charge: GrokImageCharge }> {
    const tier = await this.requirePaidSubscription(pubkey);
    const config = await this.configService.getConfig();
    this.assertConfigured(config);
    if (!config.allowImages) {
      throw new GrokUnsupportedRequestError('Grok image generation is currently disabled on the server');
    }
    this.assertNoTools(payload, config);

    const model = typeof payload.model === 'string' && payload.model.trim().length > 0
      ? payload.model.trim()
      : config.defaults.imageModel;
    const price = this.getImagePricing(model, config);
    if (!price) {
      throw new GrokUnsupportedRequestError('Unsupported xAI image model');
    }

    const imageCount = Math.min(Math.max(1, Math.floor(this.toNumber(payload.n) || 1)), 4);
    const quota = this.getQuota(tier, config);
    const status = await this.getStatus(pubkey);

    if (quota.dailyImageLimit !== undefined && (status.imagesUsedToday + imageCount) > quota.dailyImageLimit) {
      throw new GrokQuotaExceededError(`Daily image limit reached for ${tier.replace('_', '+')} users. Increase tomorrow or reduce the number of images.`);
    }

    const eligibleIncluded = price.includedQuotaEligible ? Math.min(status.includedImagesRemaining, imageCount) : 0;
    const billedImages = imageCount - eligibleIncluded;
    const costNanosUsd = billedImages * price.imageNanosUsd;

    if (costNanosUsd > status.balanceNanosUsd) {
      throw new GrokBalanceRequiredError('Included image quota exhausted. Increase your credits to generate more images.');
    }

    const requestId = uuidv4();
    const requestBody: Record<string, unknown> = {
      ...payload,
      model,
      n: imageCount,
    };
    const imagePath = Array.isArray(requestBody['images']) || requestBody['image']
      ? '/images/edits'
      : '/images/generations';
    const response = await this.callXAI<Record<string, unknown>>(imagePath, requestBody);

    const returnedImages = Array.isArray(response.data) ? response.data.length : imageCount;
    const actualIncluded = Math.min(eligibleIncluded, returnedImages);
    const actualBilledImages = Math.max(0, returnedImages - actualIncluded);
    const actualCost = actualBilledImages * price.imageNanosUsd;
    const balanceNanosUsd = await this.recordUsageAndCharge({
      pubkey,
      requestId,
      providerRequestId: typeof response.created === 'number' ? `image-${response.created}` : undefined,
      operationType: 'image',
      model,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      imageCount: returnedImages,
      costNanosUsd: actualCost,
      description: `xAI image generation using ${model}`,
    });

    const updatedStatus = await this.getStatus(pubkey);

    return {
      response,
      charge: {
        requestId,
        providerRequestId: typeof response.created === 'number' ? `image-${response.created}` : undefined,
        model,
        imageCount: returnedImages,
        usedIncludedQuota: actualIncluded,
        billedImages: actualBilledImages,
        costNanosUsd: actualCost,
        balanceNanosUsd,
        includedImagesRemaining: updatedStatus.includedImagesRemaining,
      },
    };
  }
}

export default GrokService;