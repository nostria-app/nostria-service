import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { testAccount, testPayment } from '../helpers/testHelper';

const getByPubkeyMock: any = jest.fn();
const getPaymentMock: any = jest.fn();
const createPaymentMock: any = jest.fn();
const grokBalanceUpsertMock: any = jest.fn();
const grokBalanceUpdateMock: any = jest.fn();
const grokBalanceFindUniqueMock: any = jest.fn();
const grokUsageAggregateMock: any = jest.fn();
const grokUsageCreateMock: any = jest.fn();
const grokTransactionCreateMock: any = jest.fn();
const grokConfigUpsertMock: any = jest.fn();
const paymentFindFirstMock: any = jest.fn();
const paymentUpdateMock: any = jest.fn();
const transactionMock: any = jest.fn();

const mockAccountRepository = {
  getByPubkey: getByPubkeyMock,
};

const mockPaymentRepository = {
  get: getPaymentMock,
  create: createPaymentMock,
};

const mockPrisma = {
  grokBalance: {
    upsert: grokBalanceUpsertMock,
    update: grokBalanceUpdateMock,
    findUnique: grokBalanceFindUniqueMock,
  },
  grokUsage: {
    aggregate: grokUsageAggregateMock,
    create: grokUsageCreateMock,
  },
  grokTransaction: {
    create: grokTransactionCreateMock,
  },
  grokConfig: {
    upsert: grokConfigUpsertMock,
    update: jest.fn(),
  },
  payment: {
    findFirst: paymentFindFirstMock,
    update: paymentUpdateMock,
  },
  $transaction: transactionMock,
};

jest.mock('../database/RepositoryFactory', () => ({
  __esModule: true,
  default: {
    getAccountRepository: () => mockAccountRepository,
    getPaymentRepository: () => mockPaymentRepository,
  },
}));

jest.mock('../database/prismaClient', () => ({
  __esModule: true,
  default: {
    getInstance: () => mockPrisma,
  },
}));

jest.mock('./LightningService', () => ({
  __esModule: true,
  default: {
    getUsdBtcRate: jest.fn(),
    createInvoice: jest.fn(),
  },
}));

import lightningService from './LightningService';
import GrokService, {
  GrokBalanceRequiredError,
  GrokPremiumRequiredError,
  GrokQuotaExceededError,
} from './GrokService';

const mockLightningService = lightningService as jest.Mocked<typeof lightningService>;

describe('GrokService', () => {
  let service: GrokService;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.XAI_API_KEY = 'test-xai-key';
    service = new GrokService();
    transactionMock.mockImplementation(async (callback: any) => callback(mockPrisma));
    grokBalanceUpsertMock.mockResolvedValue({
      pubkey: 'test-pubkey',
      balanceNanosUsd: BigInt(0),
      totalSpentNanosUsd: BigInt(0),
      totalToppedUpNanosUsd: BigInt(0),
      created: BigInt(Date.now()),
      modified: BigInt(Date.now()),
    });
    grokBalanceUpdateMock.mockResolvedValue({
      balanceNanosUsd: BigInt(0),
    });
    grokUsageAggregateMock.mockResolvedValue({ _sum: { imageCount: 0 } });
    grokConfigUpsertMock.mockResolvedValue({
      id: 'default',
      settings: {
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
          basic: { includedImagesPerMonth: 5 },
          premium: { includedImagesPerMonth: 10 },
          premiumPlus: { includedImagesPerMonth: 30, dailyImageLimit: 5 },
        },
        pricing: {
          responses: {
            'grok-4.20-0309-reasoning': { enabled: true, inputTokenNanosUsd: 2000, outputTokenNanosUsd: 6000 },
            'grok-4.20-0309-non-reasoning': { enabled: true, inputTokenNanosUsd: 2000, outputTokenNanosUsd: 6000 },
            'grok-4.20-multi-agent-0309': { enabled: true, inputTokenNanosUsd: 2000, outputTokenNanosUsd: 6000 },
            'grok-4-1-fast-reasoning': { enabled: true, inputTokenNanosUsd: 200, outputTokenNanosUsd: 500 },
            'grok-4-1-fast-non-reasoning': { enabled: true, inputTokenNanosUsd: 200, outputTokenNanosUsd: 500 },
          },
          images: {
            'grok-imagine-image': { enabled: true, imageNanosUsd: 20000000, includedQuotaEligible: true },
            'grok-imagine-image-pro': { enabled: true, imageNanosUsd: 70000000, includedQuotaEligible: false },
          },
        },
      },
      created: BigInt(Date.now()),
      modified: BigInt(Date.now()),
    });
  });

  afterEach(() => {
    delete process.env.XAI_API_KEY;
  });

  it('rejects free users', async () => {
    getByPubkeyMock.mockResolvedValue(testAccount({ tier: 'free' }));

    await expect(service.getStatus('test-pubkey')).rejects.toBeInstanceOf(GrokPremiumRequiredError);
  });

  it('returns paid user status with included image quota', async () => {
    getByPubkeyMock.mockResolvedValue(testAccount({ tier: 'premium' }));
    grokBalanceUpsertMock.mockResolvedValue({
      pubkey: 'test-pubkey',
      balanceNanosUsd: BigInt(250_000_000),
      totalSpentNanosUsd: BigInt(10_000_000),
      totalToppedUpNanosUsd: BigInt(260_000_000),
      created: BigInt(Date.now()),
      modified: BigInt(Date.now()),
    });
    grokUsageAggregateMock
      .mockResolvedValueOnce({ _sum: { imageCount: 3 } })
      .mockResolvedValueOnce({ _sum: { imageCount: 1 } });

    const status = await service.getStatus('test-pubkey');

    expect(status.tier).toBe('premium');
    expect(status.includedImagesRemaining).toBe(7);
    expect(status.canGenerateImagesToday).toBe(true);
  });

  it('creates a Grok top-up payment invoice', async () => {
    getByPubkeyMock.mockResolvedValue(testAccount({ tier: 'premium' }));
    mockLightningService.getUsdBtcRate.mockResolvedValue(50000);
    mockLightningService.createInvoice.mockResolvedValue({
      serialized: 'lnbc-topup',
      paymentHash: 'hash-topup',
      amountSat: 2000,
    });
    createPaymentMock.mockImplementation(async (payment: any) => payment);

    const payment = await service.createTopUpPayment('test-pubkey', 1000);

    expect(payment.purpose).toBe('grok_topup');
    expect(payment.billingCycle).toBe('one_time');
    expect(payment.creditNanosUsd).toBe(10_000_000_000);
  });

  it('blocks image generation when premium plus daily quota is exhausted', async () => {
    getByPubkeyMock.mockResolvedValue(testAccount({ tier: 'premium_plus' }));
    grokUsageAggregateMock
      .mockResolvedValueOnce({ _sum: { imageCount: 10 } })
      .mockResolvedValueOnce({ _sum: { imageCount: 5 } });

    await expect(service.createImages('test-pubkey', { model: 'grok-imagine-image', n: 1 })).rejects.toBeInstanceOf(GrokQuotaExceededError);
  });

  it('requires prepaid balance for response models', async () => {
    getByPubkeyMock.mockResolvedValue(testAccount({ tier: 'premium' }));
    grokBalanceUpsertMock.mockResolvedValue({
      pubkey: 'test-pubkey',
      balanceNanosUsd: BigInt(1000),
      totalSpentNanosUsd: BigInt(0),
      totalToppedUpNanosUsd: BigInt(1000),
      created: BigInt(Date.now()),
      modified: BigInt(Date.now()),
    });

    await expect(service.createResponse('test-pubkey', {
      model: 'grok-4.20-0309-reasoning',
      input: 'Write a long post about Nostr relays',
      max_output_tokens: 4096,
    })).rejects.toBeInstanceOf(GrokBalanceRequiredError);
  });

  it('applies the configured response safety margin before calling xAI', async () => {
    getByPubkeyMock.mockResolvedValue(testAccount({ tier: 'premium' }));
    grokBalanceUpsertMock.mockResolvedValue({
      pubkey: 'test-pubkey',
      balanceNanosUsd: BigInt(6000),
      totalSpentNanosUsd: BigInt(0),
      totalToppedUpNanosUsd: BigInt(6000),
      created: BigInt(Date.now()),
      modified: BigInt(Date.now()),
    });

    await expect(service.createResponse('test-pubkey', {
      model: 'grok-4-1-fast-reasoning',
      input: 'hello',
      max_output_tokens: 10,
    })).rejects.toBeInstanceOf(GrokBalanceRequiredError);
  });

  it('applies a paid Grok top-up payment once', async () => {
    const payment = testPayment({
      pubkey: 'test-pubkey',
      purpose: 'grok_topup',
      billingCycle: 'one_time',
      creditNanosUsd: 250_000_000,
      isPaid: true,
    });

    getPaymentMock.mockResolvedValue(payment);
    paymentFindFirstMock.mockResolvedValue({
      id: payment.id,
      pubkey: payment.pubkey,
      applied: null,
    });
    grokBalanceUpsertMock.mockResolvedValue({
      pubkey: 'test-pubkey',
      balanceNanosUsd: BigInt(100_000_000),
      totalSpentNanosUsd: BigInt(0),
      totalToppedUpNanosUsd: BigInt(100_000_000),
      created: BigInt(Date.now()),
      modified: BigInt(Date.now()),
    });
    grokBalanceUpdateMock.mockResolvedValue({
      balanceNanosUsd: BigInt(350_000_000),
    });

    const balance = await service.applyTopUpPayment(payment.id, payment.pubkey);

    expect(balance).toBe(350_000_000);
    expect(mockPrisma.payment.update).toHaveBeenCalled();
    expect(mockPrisma.grokTransaction.create).toHaveBeenCalled();
  });
});