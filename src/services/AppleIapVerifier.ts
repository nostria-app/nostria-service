import { importPKCS8, SignJWT } from 'jose';

import logger from '../utils/logger';

export interface AppleTransactionInfo {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  bundleId?: string;
  purchaseDateMs: number;
  expiresDateMs?: number;
  environment: 'Sandbox' | 'Production' | string;
  type?: string;
  raw: Record<string, unknown>;
}

interface AppleApiTransactionResponse {
  signedTransactionInfo: string;
}

/**
 * Verifies App Store purchases via StoreKit 2 JWS and/or App Store Server API.
 *
 * Env:
 * - APPLE_IAP_BUNDLE_ID (required for strict verification)
 * - APPLE_IAP_ISSUER_ID, APPLE_IAP_KEY_ID, APPLE_IAP_PRIVATE_KEY (App Store Server API)
 * - APPLE_IAP_APP_APPLE_ID (numeric App Store app id, production)
 * - APPLE_IAP_ALLOW_UNVERIFIED_DECODE=true (dev only: decode JWS without signature checks)
 */
export class AppleIapVerifier {
  private readonly bundleId = process.env.APPLE_IAP_BUNDLE_ID || 'app.nostria';
  private readonly issuerId = process.env.APPLE_IAP_ISSUER_ID;
  private readonly keyId = process.env.APPLE_IAP_KEY_ID;
  private readonly privateKeyPem = process.env.APPLE_IAP_PRIVATE_KEY?.replace(/\\n/g, '\n');
  private readonly allowUnverifiedDecode =
    process.env.APPLE_IAP_ALLOW_UNVERIFIED_DECODE === 'true' &&
    process.env.NODE_ENV !== 'production';

  isConfigured(): boolean {
    return Boolean(this.issuerId && this.keyId && this.privateKeyPem) || this.allowUnverifiedDecode;
  }

  /**
   * Verify a purchase token from the iOS client.
   * Accepts StoreKit 2 JWS, or a raw transaction id when Server API credentials are set.
   */
  async verify(purchaseToken: string, expectedProductId?: string): Promise<AppleTransactionInfo> {
    const token = purchaseToken.trim();
    if (!token) {
      throw new Error('Missing App Store purchase token');
    }

    // Prefer JWS path (StoreKit 2 returns jwsRepresentation)
    if (token.includes('.')) {
      const fromJws = await this.verifyJws(token);
      if (expectedProductId && fromJws.productId !== expectedProductId) {
        throw new Error(
          `Product mismatch: expected ${expectedProductId}, got ${fromJws.productId}`
        );
      }
      return fromJws;
    }

    // Raw transaction id — look up via App Store Server API
    if (!this.hasServerApiCredentials()) {
      throw new Error(
        'App Store Server API credentials are required to verify a raw transaction id'
      );
    }

    const fromApi = await this.fetchTransactionFromApi(token);
    if (expectedProductId && fromApi.productId !== expectedProductId) {
      throw new Error(
        `Product mismatch: expected ${expectedProductId}, got ${fromApi.productId}`
      );
    }
    return fromApi;
  }

  private hasServerApiCredentials(): boolean {
    return Boolean(this.issuerId && this.keyId && this.privateKeyPem);
  }

  private async verifyJws(jws: string): Promise<AppleTransactionInfo> {
    // When Server API is available, decode payload then re-verify transaction via API.
    if (this.hasServerApiCredentials()) {
      const decoded = this.decodeJwsPayload(jws);
      const transactionId = String(decoded.transactionId || '');
      if (!transactionId) {
        throw new Error('JWS payload missing transactionId');
      }
      try {
        return await this.fetchTransactionFromApi(transactionId);
      } catch (error) {
        logger.warn(
          `App Store Server API lookup failed, falling back to local JWS decode: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    if (this.allowUnverifiedDecode) {
      logger.warn('APPLE_IAP_ALLOW_UNVERIFIED_DECODE is enabled — not for production');
      return this.toTransactionInfo(this.decodeJwsPayload(jws));
    }

    // Attempt online verification of JWS using Apple's JWKS (limited support for StoreKit txs).
    // StoreKit transaction JWS uses x5c; parse and accept only when Server API confirmed above.
    throw new Error(
      'Unable to verify App Store JWS. Configure APPLE_IAP_ISSUER_ID, APPLE_IAP_KEY_ID, and APPLE_IAP_PRIVATE_KEY'
    );
  }

  private decodeJwsPayload(jws: string): Record<string, unknown> {
    const parts = jws.split('.');
    if (parts.length < 2) {
      throw new Error('Invalid JWS format');
    }

    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payloadJson) as Record<string, unknown>;
  }

  private toTransactionInfo(payload: Record<string, unknown>): AppleTransactionInfo {
    const transactionId = String(payload.transactionId || '');
    const originalTransactionId = String(
      payload.originalTransactionId || payload.transactionId || ''
    );
    const productId = String(payload.productId || '');
    const purchaseDateMs = Number(payload.purchaseDate || payload.purchaseDateMs || Date.now());
    const expiresDateMs = payload.expiresDate
      ? Number(payload.expiresDate)
      : payload.expiresDateMs
        ? Number(payload.expiresDateMs)
        : undefined;

    if (!transactionId || !productId) {
      throw new Error('Apple transaction payload missing transactionId or productId');
    }

    const bundleId = payload.bundleId ? String(payload.bundleId) : undefined;
    if (bundleId && this.bundleId && bundleId !== this.bundleId) {
      throw new Error(`Bundle id mismatch: expected ${this.bundleId}, got ${bundleId}`);
    }

    return {
      transactionId,
      originalTransactionId,
      productId,
      bundleId,
      purchaseDateMs,
      expiresDateMs,
      environment: String(payload.environment || 'Unknown'),
      type: payload.type ? String(payload.type) : undefined,
      raw: payload,
    };
  }

  private async createApiToken(): Promise<string> {
    if (!this.issuerId || !this.keyId || !this.privateKeyPem) {
      throw new Error('App Store Server API credentials are not configured');
    }

    const privateKey = await importPKCS8(this.privateKeyPem, 'ES256');
    const now = Math.floor(Date.now() / 1000);

    return new SignJWT({ bid: this.bundleId })
      .setProtectedHeader({ alg: 'ES256', kid: this.keyId, typ: 'JWT' })
      .setIssuer(this.issuerId)
      .setIssuedAt(now)
      .setExpirationTime(now + 20 * 60)
      .setAudience('appstoreconnect-v1')
      .sign(privateKey);
  }

  private async fetchTransactionFromApi(transactionId: string): Promise<AppleTransactionInfo> {
    const jwt = await this.createApiToken();
    const hosts = [
      'https://api.storekit.itunes.apple.com',
      'https://api.storekit-sandbox.itunes.apple.com',
    ];

    let lastError: Error | undefined;

    for (const host of hosts) {
      const url = `${host}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`;
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${jwt}`,
            Accept: 'application/json',
          },
        });

        if (response.status === 404) {
          lastError = new Error(`Transaction not found on ${host}`);
          continue;
        }

        if (!response.ok) {
          const body = await response.text();
          lastError = new Error(`App Store API ${response.status}: ${body}`);
          continue;
        }

        const data = (await response.json()) as AppleApiTransactionResponse;
        if (!data.signedTransactionInfo) {
          throw new Error('App Store API response missing signedTransactionInfo');
        }

        // signedTransactionInfo is itself a JWS — decode payload (already server-authenticated)
        const payload = this.decodeJwsPayload(data.signedTransactionInfo);
        return this.toTransactionInfo(payload);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError || new Error('Failed to verify transaction with App Store Server API');
  }
}

export default new AppleIapVerifier();
