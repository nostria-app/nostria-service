import crypto from 'crypto';

import OAuth from 'oauth-1.0a';

import RepositoryFactory from '../database/RepositoryFactory';
import logger from '../utils/logger';

type XStatus = {
  connected: boolean;
  username?: string;
  userId?: string;
};

type XPostResult = {
  id: string;
  text: string;
};

type OAuthToken = {
  key: string;
  secret: string;
};

class XService {
  private readonly userSettingsRepository = RepositoryFactory.getUserSettingsRepository();
  private readonly consumerKey = process.env.X_CONSUMER_KEY || process.env.X_CONSUMER_API_KEY || '';
  private readonly consumerSecret = process.env.X_CONSUMER_SECRET || process.env.X_CONSUMER_API_SECRET || '';
  private readonly callbackUrl = process.env.X_CALLBACK_URL || '';
  private readonly appUrl = process.env.NOSTRIA_APP_URL || 'https://nostria.app/';
  private readonly encryptionSecret = process.env.X_TOKEN_ENCRYPTION_SECRET || '';
  private readonly oauth = new OAuth({
    consumer: {
      key: this.consumerKey,
      secret: this.consumerSecret,
    },
    signature_method: 'HMAC-SHA1',
    hash_function(baseString: string, key: string): string {
      return crypto.createHmac('sha1', key).update(baseString).digest('base64');
    },
  });

  private assertConfigured(): void {
    if (!this.consumerKey || !this.consumerSecret || !this.callbackUrl || !this.encryptionSecret) {
      throw new Error('X integration is not fully configured on the server');
    }
  }

  private encrypt(value: string): string {
    const key = crypto.createHash('sha256').update(this.encryptionSecret).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  private decrypt(value: string): string {
    const buffer = Buffer.from(value, 'base64');
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const encrypted = buffer.subarray(28);
    const key = crypto.createHash('sha256').update(this.encryptionSecret).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  private async signedFormRequest(
    url: string,
    method: 'POST' | 'GET',
    data: Record<string, string>,
    token?: OAuthToken
  ): Promise<string> {
    const requestData = { url, method, data };
    const authData = this.oauth.authorize(requestData, token);
    const headers = this.oauth.toHeader(authData) as unknown as Record<string, string>;

    const response = await fetch(url, {
      method,
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(data).toString(),
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`X OAuth request failed: ${response.status} ${responseText}`);
    }

    return responseText;
  }

  private async signedJsonRequest<T>(
    url: string,
    method: 'POST',
    body: Record<string, unknown>,
    token: OAuthToken
  ): Promise<T> {
    const requestData = { url, method };
    const authData = this.oauth.authorize(requestData, token);
    const headers = this.oauth.toHeader(authData) as unknown as Record<string, string>;

    const response = await fetch(url, {
      method,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`X API request failed: ${response.status} ${responseText}`);
    }

    return JSON.parse(responseText) as T;
  }

  private buildAppRedirect(status: 'success' | 'cancelled' | 'error', pubkey?: string, message?: string): string {
    const redirectUrl = new URL('/settings/general', this.appUrl);
    redirectUrl.searchParams.set('xAuth', status);

    if (pubkey) {
      redirectUrl.searchParams.set('pubkey', pubkey);
    }

    if (message) {
      redirectUrl.searchParams.set('xMessage', message);
    }

    return redirectUrl.toString();
  }

  async getStatus(pubkey: string): Promise<XStatus> {
    const settings = await this.userSettingsRepository.getUserSettings(pubkey);

    return {
      connected: !!(settings?.xAccessToken && settings?.xAccessSecret),
      username: settings?.xUsername,
      userId: settings?.xUserId,
    };
  }

  async startAuthorization(pubkey: string): Promise<string> {
    this.assertConfigured();

    const responseText = await this.signedFormRequest(
      'https://api.x.com/oauth/request_token',
      'POST',
      { oauth_callback: this.callbackUrl }
    );

    const params = new URLSearchParams(responseText);
    const requestToken = params.get('oauth_token');
    const requestSecret = params.get('oauth_token_secret');
    const callbackConfirmed = params.get('oauth_callback_confirmed');

    if (!requestToken || !requestSecret || callbackConfirmed !== 'true') {
      throw new Error('X did not return a valid request token');
    }

    await this.userSettingsRepository.storeXRequestToken(pubkey, {
      requestToken,
      requestSecret: this.encrypt(requestSecret),
    });

    return `https://api.x.com/oauth/authorize?oauth_token=${encodeURIComponent(requestToken)}`;
  }

  async handleCallback(oauthToken?: string, oauthVerifier?: string, denied?: string): Promise<string> {
    this.assertConfigured();

    if (denied) {
      const deniedSettings = await this.userSettingsRepository.getUserSettingsByXRequestToken(denied);
      if (deniedSettings?.pubkey) {
        await this.userSettingsRepository.clearXRequestToken(deniedSettings.pubkey);
      }
      return this.buildAppRedirect('cancelled', deniedSettings?.pubkey);
    }

    if (!oauthToken || !oauthVerifier) {
      return this.buildAppRedirect('error', undefined, 'Missing X callback parameters');
    }

    const settings = await this.userSettingsRepository.getUserSettingsByXRequestToken(oauthToken);
    if (!settings || !settings.xRequestSecret) {
      return this.buildAppRedirect('error', undefined, 'X authorization session not found');
    }

    try {
      const responseText = await this.signedFormRequest(
        'https://api.x.com/oauth/access_token',
        'POST',
        { oauth_verifier: oauthVerifier },
        {
          key: oauthToken,
          secret: this.decrypt(settings.xRequestSecret),
        }
      );

      const params = new URLSearchParams(responseText);
      const accessToken = params.get('oauth_token');
      const accessSecret = params.get('oauth_token_secret');
      const userId = params.get('user_id');
      const username = params.get('screen_name');

      if (!accessToken || !accessSecret || !userId || !username) {
        throw new Error('X did not return a valid access token');
      }

      await this.userSettingsRepository.connectXAccount(settings.pubkey, {
        userId,
        username,
        accessToken: this.encrypt(accessToken),
        accessSecret: this.encrypt(accessSecret),
      });

      return this.buildAppRedirect('success', settings.pubkey);
    } catch (error) {
      logger.error('Failed to complete X authorization', error);
      await this.userSettingsRepository.clearXRequestToken(settings.pubkey);
      return this.buildAppRedirect('error', settings.pubkey, (error as Error).message);
    }
  }

  async disconnect(pubkey: string): Promise<XStatus> {
    await this.userSettingsRepository.disconnectXAccount(pubkey);
    return { connected: false };
  }

  async createPost(pubkey: string, text: string): Promise<XPostResult> {
    this.assertConfigured();

    const settings = await this.userSettingsRepository.getUserSettings(pubkey);
    if (!settings?.xAccessToken || !settings?.xAccessSecret) {
      throw new Error('No connected X account found for this user');
    }

    const payload = {
      text,
    };

    const response = await this.signedJsonRequest<{ data?: { id: string; text: string } }>(
      'https://api.x.com/2/tweets',
      'POST',
      payload,
      {
        key: this.decrypt(settings.xAccessToken),
        secret: this.decrypt(settings.xAccessSecret),
      }
    );

    if (!response.data?.id || !response.data.text) {
      throw new Error('X did not return a created post');
    }

    return response.data;
  }
}

export default XService;