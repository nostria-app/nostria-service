import { v4 as uuidv4 } from 'uuid';

import config from '../config';
import RepositoryFactory from '../database/RepositoryFactory';
import { now } from '../helpers/now';
import { Account } from '../models/account';
import {
  AccountSubscription,
  extendExpiry,
} from '../models/accountSubscription';
import { Payment } from '../models/payment';
import { BillingCycle, Tier } from '../config/types';
import logger from '../utils/logger';
import validateUsername from '../routes/account/validateUsername';
import appleIapVerifier from './AppleIapVerifier';
import googlePlayIapVerifier from './GooglePlayIapVerifier';
import {
  getStoreProduct,
  resolvePriceCents,
  StoreName,
} from './storeProductCatalog';

export interface VerifyStorePurchaseInput {
  purchaseToken: string;
  pubkey: string;
  store: StoreName;
  productId?: string;
  username?: string | null;
  jwsRepresentation?: string;
}

export interface VerifyStorePurchaseResult {
  success: true;
  alreadyProcessed: boolean;
  paymentId: string;
  account: Account;
  store: StoreName;
  productId: string;
  transactionId: string;
}

export interface StoreRenewalResult {
  handled: boolean;
  pubkey?: string;
  action?: 'renewed' | 'revoked' | 'already-processed';
  paymentId?: string;
  reason?: string;
}

const TIER_PRIORITY: Record<Tier, number> = {
  free: 0,
  basic: 1,
  premium: 2,
  premium_plus: 3,
};

export class StorePurchaseService {
  private readonly accountRepository = RepositoryFactory.getAccountRepository();
  private readonly paymentRepository = RepositoryFactory.getPaymentRepository();

  async verifyAndActivate(input: VerifyStorePurchaseInput): Promise<VerifyStorePurchaseResult> {
    const pubkey = input.pubkey?.trim().toLowerCase();
    if (!pubkey || !/^[a-f0-9]{64}$/.test(pubkey)) {
      throw new StorePurchaseError(400, 'Invalid pubkey format. Must be 64 lowercase hex chars');
    }

    if (input.store !== 'app-store' && input.store !== 'play-store') {
      throw new StorePurchaseError(400, 'store must be app-store or play-store');
    }

    const token = (input.jwsRepresentation || input.purchaseToken || '').trim();
    if (!token) {
      throw new StorePurchaseError(400, 'purchaseToken is required');
    }

    let productId: string;
    let transactionId: string;
    let originalTransactionId: string;
    let purchaseDateMs: number;
    let expiresDateMs: number | undefined;

    if (input.store === 'app-store') {
      if (!appleIapVerifier.isConfigured()) {
        throw new StorePurchaseError(
          503,
          'App Store verification is not configured on the server'
        );
      }

      const verified = await appleIapVerifier.verify(token, input.productId);
      productId = verified.productId;
      transactionId = verified.transactionId;
      originalTransactionId = verified.originalTransactionId;
      purchaseDateMs = verified.purchaseDateMs;
      expiresDateMs = verified.expiresDateMs;
    } else {
      if (!input.productId) {
        throw new StorePurchaseError(400, 'productId is required for play-store purchases');
      }
      if (!googlePlayIapVerifier.isConfigured()) {
        throw new StorePurchaseError(
          503,
          'Play Store verification is not configured on the server'
        );
      }

      const verified = await googlePlayIapVerifier.verify(token, input.productId);
      productId = verified.productId || input.productId;
      transactionId = verified.orderId || token.slice(0, 64);
      originalTransactionId = token;
      purchaseDateMs = verified.purchaseDateMs;
      expiresDateMs = verified.expiresDateMs;
    }

    if (input.productId && input.productId !== productId) {
      throw new StorePurchaseError(
        400,
        `Product mismatch: expected ${input.productId}, got ${productId}`
      );
    }

    const catalogProduct = getStoreProduct(productId);
    if (!catalogProduct) {
      throw new StorePurchaseError(400, `Unknown store productId: ${productId}`);
    }

    // Idempotency: if this store transaction was already applied, return success
    const existingPayment = await this.paymentRepository.getByStoreTransactionId(transactionId);
    if (existingPayment) {
      if (existingPayment.pubkey !== pubkey) {
        throw new StorePurchaseError(
          409,
          'This store transaction is already linked to a different account'
        );
      }

      const account = await this.accountRepository.getByPubkey(pubkey);
      if (!account) {
        throw new StorePurchaseError(500, 'Payment exists but account is missing');
      }

      return {
        success: true,
        alreadyProcessed: true,
        paymentId: existingPayment.id,
        account,
        store: input.store,
        productId,
        transactionId,
      };
    }

    const tier = catalogProduct.tier;
    const billingCycle = catalogProduct.billingCycle;
    const priceCents = resolvePriceCents(catalogProduct);
    const tierDetails = config.tiers[tier];
    if (!tierDetails) {
      throw new StorePurchaseError(500, `Tier config missing for ${tier}`);
    }

    const ts = now();
    const paymentId = `payment-store-${uuidv4()}`;

    const payment: Payment = {
      id: paymentId,
      type: 'payment',
      paymentType: input.store,
      lnHash: originalTransactionId || transactionId,
      lnInvoice: input.store === 'app-store' ? 'app-store' : 'play-store',
      lnAmountSat: 0,
      purpose: 'subscription',
      tier,
      billingCycle,
      priceCents,
      pubkey,
      isPaid: true,
      paid: purchaseDateMs || ts,
      applied: ts,
      expires: ts, // store payment records don't need an invoice TTL
      created: ts,
      modified: ts,
      storeTransactionId: transactionId,
      storeOriginalTransactionId: originalTransactionId,
      storeProductId: productId,
    };

    await this.paymentRepository.create(payment);

    const account = await this.applySubscriptionToAccount({
      pubkey,
      tier,
      billingCycle,
      priceCents,
      expiresDateMs,
      username: input.username,
    });

    logger.info(
      `Store purchase activated: store=${input.store} product=${productId} ` +
        `tx=${transactionId} pubkey=${pubkey.substring(0, 16)}... tier=${tier}`
    );

    return {
      success: true,
      alreadyProcessed: false,
      paymentId,
      account,
      store: input.store,
      productId,
      transactionId,
    };
  }

  /**
   * Apply an App Store / Play Store renewal (or refund) reported by a server notification.
   * Resolves the account from an earlier payment with the same original transaction id.
   */
  async applyStoreRenewal(params: {
    store: StoreName;
    transactionId: string;
    originalTransactionId: string;
    productId: string;
    purchaseDateMs: number;
    expiresDateMs?: number;
    revoked?: boolean;
  }): Promise<StoreRenewalResult> {
    const previous = await this.paymentRepository.getLatestByStoreOriginalTransactionId(
      params.originalTransactionId
    );

    if (!previous) {
      return { handled: false, reason: 'No prior payment for this original transaction id' };
    }

    const pubkey = previous.pubkey as string;

    if (params.revoked) {
      await this.revokeSubscription(pubkey, params.expiresDateMs);
      return { handled: true, pubkey, action: 'revoked' };
    }

    const existingPayment = await this.paymentRepository.getByStoreTransactionId(
      params.transactionId
    );
    if (existingPayment) {
      return { handled: true, pubkey, action: 'already-processed' };
    }

    const catalogProduct = getStoreProduct(params.productId);
    if (!catalogProduct) {
      return { handled: false, reason: `Unknown store productId: ${params.productId}` };
    }

    const tier = catalogProduct.tier;
    const billingCycle = catalogProduct.billingCycle;
    const priceCents = resolvePriceCents(catalogProduct);
    const ts = now();

    const payment: Payment = {
      id: `payment-store-${uuidv4()}`,
      type: 'payment',
      paymentType: params.store,
      lnHash: params.originalTransactionId,
      lnInvoice: params.store,
      lnAmountSat: 0,
      purpose: 'subscription',
      tier,
      billingCycle,
      priceCents,
      pubkey,
      isPaid: true,
      paid: params.purchaseDateMs || ts,
      applied: ts,
      expires: ts,
      created: ts,
      modified: ts,
      storeTransactionId: params.transactionId,
      storeOriginalTransactionId: params.originalTransactionId,
      storeProductId: params.productId,
    };

    await this.paymentRepository.create(payment);

    await this.applySubscriptionToAccount({
      pubkey,
      tier,
      billingCycle,
      priceCents,
      expiresDateMs: params.expiresDateMs,
    });

    logger.info(
      `Store renewal applied: store=${params.store} product=${params.productId} ` +
        `tx=${params.transactionId} pubkey=${pubkey.substring(0, 16)}...`
    );

    return { handled: true, pubkey, action: 'renewed', paymentId: payment.id };
  }

  /** Cut a subscription short after a refund/revocation reported by the store. */
  private async revokeSubscription(pubkey: string, expiresDateMs?: number): Promise<void> {
    const account = await this.accountRepository.getByPubkey(pubkey);
    if (!account) {
      return;
    }

    const ts = now();
    const newExpiry = Math.min(account.expires ?? ts, expiresDateMs ?? ts);

    await this.accountRepository.update({
      ...account,
      expires: newExpiry,
      modified: ts,
    });

    logger.warn(
      `Store subscription revoked for ${pubkey.substring(0, 16)}..., expires=${new Date(
        newExpiry
      ).toISOString()}`
    );
  }

  private async applySubscriptionToAccount(params: {
    pubkey: string;
    tier: Tier;
    billingCycle: BillingCycle;
    priceCents: number;
    expiresDateMs?: number;
    username?: string | null;
  }): Promise<Account> {
    const { pubkey, tier, billingCycle, priceCents, expiresDateMs } = params;
    const ts = now();
    const tierDetails = config.tiers[tier];

    let username: string | undefined;
    const trimmedUsername = params.username?.trim();
    if (trimmedUsername) {
      const usernameError = validateUsername(trimmedUsername);
      if (usernameError) {
        throw new StorePurchaseError(400, usernameError);
      }
      const taken = await this.accountRepository.isUsernameTaken(trimmedUsername, pubkey);
      if (taken) {
        throw new StorePurchaseError(409, 'Username is already taken');
      }
      username = trimmedUsername;
    }

    const subscription: AccountSubscription = {
      tier,
      billingCycle,
      price: {
        priceCents,
        currency: 'USD',
      },
      entitlements: tierDetails.entitlements,
    };

    let existing = await this.accountRepository.getByPubkey(pubkey);

    // Prefer Apple/Google-provided expiry when present; otherwise extend by billing cycle.
    const computeExpiry = (currentExpires?: number): number => {
      if (expiresDateMs && expiresDateMs > ts) {
        // For renewals of existing paid periods, take the later of store expiry vs extended
        if (currentExpires && currentExpires > ts) {
          return Math.max(currentExpires, expiresDateMs);
        }
        return expiresDateMs;
      }
      return extendExpiry(currentExpires, billingCycle);
    };

    if (existing) {
      const newExpiry = computeExpiry(existing.expires);
      const currentTier = existing.tier as Tier;
      const newTier: Tier =
        TIER_PRIORITY[tier] >= TIER_PRIORITY[currentTier] ? tier : currentTier;

      const canHaveUsername =
        (newTier !== 'free' &&
          config.tiers[newTier].entitlements.features.includes('USERNAME')) ||
        subscription.entitlements.features.includes('USERNAME');

      const updated: Account = {
        ...existing,
        tier: newTier,
        subscription: {
          ...subscription,
          tier: newTier,
          entitlements: config.tiers[newTier].entitlements,
        },
        expires: newExpiry,
        modified: ts,
        username:
          canHaveUsername && username
            ? username
            : existing.username,
      };

      return this.accountRepository.update(updated);
    }

    const newExpiry = computeExpiry(undefined);
    const canHaveUsername = subscription.entitlements.features.includes('USERNAME');

    const account: Account = {
      id: pubkey,
      type: 'account',
      pubkey,
      username: canHaveUsername ? username : undefined,
      tier,
      subscription,
      expires: newExpiry,
      created: ts,
      modified: ts,
    };

    return this.accountRepository.create(account);
  }
}

export class StorePurchaseError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'StorePurchaseError';
  }
}

export default new StorePurchaseService();
