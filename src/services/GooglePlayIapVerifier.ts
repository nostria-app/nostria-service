import logger from '../utils/logger';

export interface GooglePlaySubscriptionInfo {
  purchaseToken: string;
  productId: string;
  orderId?: string;
  purchaseDateMs: number;
  expiresDateMs?: number;
  acknowledgementState?: number;
  subscriptionState?: string;
  raw: Record<string, unknown>;
}

/**
 * Verifies Google Play subscription purchases.
 *
 * Env:
 * - GOOGLE_PLAY_PACKAGE_NAME (e.g. app.nostria)
 * - GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (full service account JSON string)
 * - GOOGLE_PLAY_ALLOW_UNVERIFIED=true (dev only)
 */
export class GooglePlayIapVerifier {
  private readonly packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME || 'app.nostria';
  private readonly serviceAccountJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  private readonly allowUnverified =
    process.env.GOOGLE_PLAY_ALLOW_UNVERIFIED === 'true' &&
    process.env.NODE_ENV !== 'production';

  private cachedAccessToken: { token: string; expiresAt: number } | null = null;

  isConfigured(): boolean {
    return Boolean(this.serviceAccountJson) || this.allowUnverified;
  }

  async verify(
    purchaseToken: string,
    productId: string
  ): Promise<GooglePlaySubscriptionInfo> {
    if (!purchaseToken || !productId) {
      throw new Error('Missing Play Store purchaseToken or productId');
    }

    if (this.serviceAccountJson) {
      return this.verifyWithGoogleApi(purchaseToken, productId);
    }

    if (this.allowUnverified) {
      logger.warn('GOOGLE_PLAY_ALLOW_UNVERIFIED is enabled — not for production');
      return {
        purchaseToken,
        productId,
        purchaseDateMs: Date.now(),
        expiresDateMs: undefined,
        raw: { unverified: true },
      };
    }

    throw new Error(
      'Google Play verification is not configured. Set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON.'
    );
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAt > Date.now() + 60_000) {
      return this.cachedAccessToken.token;
    }

    if (!this.serviceAccountJson) {
      throw new Error('Missing GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');
    }

    const sa = JSON.parse(this.serviceAccountJson) as {
      client_email: string;
      private_key: string;
      token_uri?: string;
    };

    const { SignJWT, importPKCS8 } = await import('jose');
    const privateKey = await importPKCS8(sa.private_key, 'RS256');
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({
      scope: 'https://www.googleapis.com/auth/androidpublisher',
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(sa.client_email)
      .setSubject(sa.client_email)
      .setAudience(sa.token_uri || 'https://oauth2.googleapis.com/token')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey);

    const tokenUrl = sa.token_uri || 'https://oauth2.googleapis.com/token';
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google OAuth token error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.cachedAccessToken = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return data.access_token;
  }

  private async verifyWithGoogleApi(
    purchaseToken: string,
    productId: string
  ): Promise<GooglePlaySubscriptionInfo> {
    const accessToken = await this.getAccessToken();

    // subscriptions v2 is preferred for modern Play Billing
    const url =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(this.packageName)}/purchases/subscriptionsv2/tokens/` +
      `${encodeURIComponent(purchaseToken)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      // Fall back to legacy subscriptions endpoint with productId
      return this.verifyLegacySubscription(accessToken, purchaseToken, productId);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const lineItems = (data.lineItems as Array<Record<string, unknown>> | undefined) || [];
    const first = lineItems[0] || {};
    const offerDetails = (first.offerDetails as Record<string, unknown>) || {};
    const expiryTime = first.expiryTime ? String(first.expiryTime) : undefined;
    const startTime = data.startTime ? String(data.startTime) : undefined;

    const resolvedProductId =
      (first.productId as string) ||
      (offerDetails.basePlanId as string) ||
      productId;

    if (productId && resolvedProductId && resolvedProductId !== productId) {
      // basePlanId may differ from SKU; only error when productId field is present and different
      if (first.productId && first.productId !== productId) {
        throw new Error(
          `Play product mismatch: expected ${productId}, got ${String(first.productId)}`
        );
      }
    }

    const state = String(data.subscriptionState || '');
    if (state && state !== 'SUBSCRIPTION_STATE_ACTIVE' && state !== 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD') {
      // Still accept recently purchased states that are active enough to grant access
      if (
        state !== 'SUBSCRIPTION_STATE_CANCELED' &&
        !state.includes('ACTIVE')
      ) {
        logger.warn(`Play subscription state is ${state} for token ${purchaseToken.slice(0, 8)}...`);
      }
    }

    return {
      purchaseToken,
      productId: productId || resolvedProductId,
      orderId: data.latestOrderId ? String(data.latestOrderId) : undefined,
      purchaseDateMs: startTime ? Date.parse(startTime) : Date.now(),
      expiresDateMs: expiryTime ? Date.parse(expiryTime) : undefined,
      subscriptionState: state,
      raw: data,
    };
  }

  private async verifyLegacySubscription(
    accessToken: string,
    purchaseToken: string,
    productId: string
  ): Promise<GooglePlaySubscriptionInfo> {
    const url =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(this.packageName)}/purchases/subscriptions/` +
      `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Play Developer API ${response.status}: ${text}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const expiryTimeMillis = data.expiryTimeMillis
      ? Number(data.expiryTimeMillis)
      : undefined;
    const startTimeMillis = data.startTimeMillis
      ? Number(data.startTimeMillis)
      : Date.now();

    // paymentState: 1 = received, 2 = free trial, 3 = pending deferred
    const paymentState = data.paymentState !== undefined ? Number(data.paymentState) : undefined;
    if (paymentState !== undefined && paymentState !== 1 && paymentState !== 2) {
      throw new Error(`Play subscription payment not received (paymentState=${paymentState})`);
    }

    return {
      purchaseToken,
      productId,
      orderId: data.orderId ? String(data.orderId) : undefined,
      purchaseDateMs: startTimeMillis,
      expiresDateMs: expiryTimeMillis,
      acknowledgementState: data.acknowledgementState
        ? Number(data.acknowledgementState)
        : undefined,
      raw: data,
    };
  }
}

export default new GooglePlayIapVerifier();
