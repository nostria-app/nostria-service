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
  revocationDateMs?: number;
  raw: Record<string, unknown>;
}

export type AppleEnvironmentPreference = 'production' | 'sandbox' | 'auto';

export interface AppleIapStatus {
  configured: boolean;
  bundleId: string;
  appAppleId?: string;
  hasIssuerId: boolean;
  hasKeyId: boolean;
  hasPrivateKey: boolean;
  privateKeyLooksValid: boolean;
  environment: AppleEnvironmentPreference;
  allowUnverifiedDecode: boolean;
  /** Env vars still required for production-grade verification */
  missing: string[];
}

interface AppleApiTransactionResponse {
  signedTransactionInfo: string;
}

const PRODUCTION_HOST = 'https://api.storekit.itunes.apple.com';
const SANDBOX_HOST = 'https://api.storekit-sandbox.itunes.apple.com';

/**
 * Verifies App Store purchases via StoreKit 2 JWS and/or App Store Server API.
 *
 * Env:
 * - APPLE_IAP_BUNDLE_ID (required for strict verification)
 * - APPLE_IAP_ISSUER_ID, APPLE_IAP_KEY_ID, APPLE_IAP_PRIVATE_KEY (App Store Server API)
 * - APPLE_IAP_APP_APPLE_ID (numeric App Store app id, production)
 * - APPLE_IAP_ENVIRONMENT (production | sandbox | auto, default auto)
 * - APPLE_IAP_ALLOW_UNVERIFIED_DECODE=true (dev only: decode JWS without signature checks)
 */
export class AppleIapVerifier {
  private readonly bundleId = process.env.APPLE_IAP_BUNDLE_ID || 'app.nostria';
  private readonly appAppleId = process.env.APPLE_IAP_APP_APPLE_ID;
  private readonly issuerId = process.env.APPLE_IAP_ISSUER_ID;
  private readonly keyId = process.env.APPLE_IAP_KEY_ID;
  private readonly privateKeyPem = normalizePrivateKey(process.env.APPLE_IAP_PRIVATE_KEY);
  private readonly environmentPreference = resolveEnvironmentPreference(
    process.env.APPLE_IAP_ENVIRONMENT
  );
  private readonly allowUnverifiedDecode =
    process.env.APPLE_IAP_ALLOW_UNVERIFIED_DECODE === 'true' &&
    process.env.NODE_ENV !== 'production';

  isConfigured(): boolean {
    return this.hasServerApiCredentials() || this.allowUnverifiedDecode;
  }

  /** Non-secret configuration snapshot for diagnostics endpoints. */
  getStatus(): AppleIapStatus {
    const missing: string[] = [];
    if (!this.issuerId) missing.push('APPLE_IAP_ISSUER_ID');
    if (!this.keyId) missing.push('APPLE_IAP_KEY_ID');
    if (!this.privateKeyPem) missing.push('APPLE_IAP_PRIVATE_KEY');

    return {
      configured: this.isConfigured(),
      bundleId: this.bundleId,
      appAppleId: this.appAppleId,
      hasIssuerId: Boolean(this.issuerId),
      hasKeyId: Boolean(this.keyId),
      hasPrivateKey: Boolean(this.privateKeyPem),
      privateKeyLooksValid: Boolean(
        this.privateKeyPem?.includes('BEGIN PRIVATE KEY') &&
          this.privateKeyPem?.includes('END PRIVATE KEY')
      ),
      environment: this.environmentPreference,
      allowUnverifiedDecode: this.allowUnverifiedDecode,
      missing,
    };
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
    const info = token.includes('.')
      ? await this.verifyJws(token)
      : await this.verifyTransactionId(token);

    if (expectedProductId && info.productId !== expectedProductId) {
      throw new Error(`Product mismatch: expected ${expectedProductId}, got ${info.productId}`);
    }

    if (info.revocationDateMs) {
      throw new Error('Transaction has been revoked or refunded by Apple');
    }

    return info;
  }

  /** Look up the latest state of a transaction (used by renewal notifications). */
  async getTransaction(transactionId: string): Promise<AppleTransactionInfo> {
    return this.fetchTransactionFromApi(transactionId);
  }

  /** Decode an Apple-signed JWS payload (used for App Store Server Notifications). */
  decodeSignedPayload(jws: string): Record<string, unknown> {
    return this.decodeJwsPayload(jws);
  }

  /** Map an Apple-signed transaction payload to our normalized shape. */
  parseTransactionPayload(payload: Record<string, unknown>): AppleTransactionInfo {
    return this.toTransactionInfo(payload);
  }

  hasServerApiCredentials(): boolean {
    return Boolean(this.issuerId && this.keyId && this.privateKeyPem);
  }

  private async verifyTransactionId(transactionId: string): Promise<AppleTransactionInfo> {
    if (!this.hasServerApiCredentials()) {
      throw new Error(
        'App Store Server API credentials are required to verify a raw transaction id. ' +
          'Set APPLE_IAP_ISSUER_ID, APPLE_IAP_KEY_ID and APPLE_IAP_PRIVATE_KEY'
      );
    }

    return this.fetchTransactionFromApi(transactionId);
  }

  private async verifyJws(jws: string): Promise<AppleTransactionInfo> {
    const decoded = this.decodeJwsPayload(jws);

    // When Server API is available, re-fetch the transaction from Apple so the result
    // is authenticated by Apple over TLS instead of being trusted from the client.
    if (this.hasServerApiCredentials()) {
      const transactionId = String(decoded.transactionId || '');
      if (!transactionId) {
        throw new Error('JWS payload missing transactionId');
      }

      try {
        return await this.fetchTransactionFromApi(transactionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (this.allowUnverifiedDecode) {
          logger.warn(
            `App Store Server API lookup failed, falling back to local JWS decode: ${message}`
          );
          return this.toTransactionInfo(decoded);
        }
        throw new Error(`App Store Server API verification failed: ${message}`);
      }
    }

    if (this.allowUnverifiedDecode) {
      logger.warn('APPLE_IAP_ALLOW_UNVERIFIED_DECODE is enabled — not for production');
      return this.toTransactionInfo(decoded);
    }

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
      revocationDateMs: payload.revocationDate ? Number(payload.revocationDate) : undefined,
      raw: payload,
    };
  }

  private async createApiToken(): Promise<string> {
    if (!this.issuerId || !this.keyId || !this.privateKeyPem) {
      throw new Error('App Store Server API credentials are not configured');
    }

    let privateKey;
    try {
      privateKey = await importPKCS8(this.privateKeyPem, 'ES256');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `APPLE_IAP_PRIVATE_KEY is not a valid PKCS#8 ES256 key (.p8 contents required): ${message}`
      );
    }

    const now = Math.floor(Date.now() / 1000);

    return new SignJWT({ bid: this.bundleId })
      .setProtectedHeader({ alg: 'ES256', kid: this.keyId, typ: 'JWT' })
      .setIssuer(this.issuerId)
      .setIssuedAt(now)
      .setExpirationTime(now + 20 * 60)
      .setAudience('appstoreconnect-v1')
      .sign(privateKey);
  }

  /** Host order depends on APPLE_IAP_ENVIRONMENT; 'auto' tries production then sandbox. */
  private get hosts(): string[] {
    switch (this.environmentPreference) {
      case 'production':
        return [PRODUCTION_HOST];
      case 'sandbox':
        return [SANDBOX_HOST];
      default:
        return [PRODUCTION_HOST, SANDBOX_HOST];
    }
  }

  private async fetchTransactionFromApi(transactionId: string): Promise<AppleTransactionInfo> {
    const jwt = await this.createApiToken();
    let lastError: Error | undefined;

    for (const host of this.hosts) {
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
          lastError = new Error(`Transaction ${transactionId} not found on ${host}`);
          continue;
        }

        if (response.status === 401) {
          throw new Error(
            'App Store Server API rejected the credentials (401). Verify APPLE_IAP_ISSUER_ID, ' +
              'APPLE_IAP_KEY_ID and APPLE_IAP_PRIVATE_KEY, and that the key has In-App Purchase access.'
          );
        }

        if (!response.ok) {
          const body = await response.text();
          lastError = new Error(`App Store API ${response.status}: ${body.slice(0, 500)}`);
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
        if (lastError.message.includes('(401)')) {
          throw lastError;
        }
      }
    }

    throw lastError || new Error('Failed to verify transaction with App Store Server API');
  }
}

/**
 * Accepts the raw .p8 contents, a `\n`-escaped single-line value, or a base64 blob
 * (useful when the hosting provider cannot store multi-line secrets).
 */
function normalizePrivateKey(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  let key = value.trim().replace(/\\n/g, '\n');

  if (!key.includes('BEGIN')) {
    try {
      const decoded = Buffer.from(key, 'base64').toString('utf8');
      if (decoded.includes('BEGIN')) {
        key = decoded;
      }
    } catch {
      // Not base64 — let importPKCS8 report the problem instead.
    }
  }

  return key;
}

function resolveEnvironmentPreference(value?: string): AppleEnvironmentPreference {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'production' || normalized === 'sandbox') {
    return normalized;
  }
  return 'auto';
}

export default new AppleIapVerifier();
