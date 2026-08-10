import logger from '../utils/logger';
import appleIapVerifier from './AppleIapVerifier';
import storePurchaseService, { StoreRenewalResult } from './StorePurchaseService';

/**
 * App Store Server Notifications V2 payload envelope.
 * @see https://developer.apple.com/documentation/appstoreservernotifications
 */
interface AppleNotificationPayload {
  notificationType?: string;
  subtype?: string;
  notificationUUID?: string;
  version?: string;
  signedDate?: number;
  data?: {
    appAppleId?: number;
    bundleId?: string;
    environment?: string;
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
  };
}

export interface AppleNotificationResult {
  notificationType: string;
  subtype?: string;
  notificationUUID?: string;
  environment?: string;
  handled: boolean;
  action?: string;
  reason?: string;
}

/** Notification types that grant or extend access. */
const RENEWAL_TYPES = new Set(['SUBSCRIBED', 'DID_RENEW', 'OFFER_REDEEMED', 'ONE_TIME_CHARGE']);

/** Notification types that end access. */
const REVOKE_TYPES = new Set(['REFUND', 'REVOKE', 'EXPIRED', 'GRACE_PERIOD_EXPIRED']);

/**
 * Processes App Store Server Notifications V2 so subscription renewals, refunds and
 * expirations are reflected on the account without the client being online.
 */
export class AppleNotificationService {
  async handle(signedPayload: string): Promise<AppleNotificationResult> {
    if (!signedPayload || typeof signedPayload !== 'string') {
      throw new Error('Missing signedPayload');
    }

    const payload = appleIapVerifier.decodeSignedPayload(signedPayload) as AppleNotificationPayload;
    const notificationType = payload.notificationType || 'UNKNOWN';
    const environment = payload.data?.environment;

    logger.info(
      `App Store notification received: type=${notificationType} subtype=${payload.subtype || '-'} ` +
        `env=${environment || '-'} uuid=${payload.notificationUUID || '-'}`
    );

    const base: AppleNotificationResult = {
      notificationType,
      subtype: payload.subtype,
      notificationUUID: payload.notificationUUID,
      environment,
      handled: false,
    };

    if (notificationType === 'TEST') {
      return { ...base, handled: true, action: 'test' };
    }

    const signedTransactionInfo = payload.data?.signedTransactionInfo;
    if (!signedTransactionInfo) {
      return { ...base, reason: 'Notification has no signedTransactionInfo' };
    }

    const decodedTransaction = appleIapVerifier.decodeSignedPayload(signedTransactionInfo);
    const transactionId = String(decodedTransaction.transactionId || '');
    if (!transactionId) {
      return { ...base, reason: 'Transaction payload has no transactionId' };
    }

    // Re-fetch from Apple over TLS so we never trust an unauthenticated POST body.
    let transaction;
    if (appleIapVerifier.hasServerApiCredentials()) {
      transaction = await appleIapVerifier.getTransaction(transactionId);
    } else {
      logger.warn(
        'App Store Server API credentials missing — notification transaction is not re-verified'
      );
      transaction = appleIapVerifier.parseTransactionPayload(decodedTransaction);
    }

    if (RENEWAL_TYPES.has(notificationType)) {
      const result = await storePurchaseService.applyStoreRenewal({
        store: 'app-store',
        transactionId: transaction.transactionId,
        originalTransactionId: transaction.originalTransactionId,
        productId: transaction.productId,
        purchaseDateMs: transaction.purchaseDateMs,
        expiresDateMs: transaction.expiresDateMs,
      });
      return this.toResult(base, result);
    }

    if (REVOKE_TYPES.has(notificationType)) {
      const result = await storePurchaseService.applyStoreRenewal({
        store: 'app-store',
        transactionId: transaction.transactionId,
        originalTransactionId: transaction.originalTransactionId,
        productId: transaction.productId,
        purchaseDateMs: transaction.purchaseDateMs,
        expiresDateMs: transaction.expiresDateMs,
        revoked: true,
      });
      return this.toResult(base, result);
    }

    // DID_CHANGE_RENEWAL_STATUS, DID_FAIL_TO_RENEW, PRICE_INCREASE, etc. are informational.
    return { ...base, handled: true, action: 'ignored' };
  }

  private toResult(
    base: AppleNotificationResult,
    result: StoreRenewalResult
  ): AppleNotificationResult {
    return {
      ...base,
      handled: result.handled,
      action: result.action,
      reason: result.reason,
    };
  }
}

export default new AppleNotificationService();
