import crypto from 'crypto';

import OAuth from 'oauth-1.0a';

import RepositoryFactory from '../database/RepositoryFactory';
import { XPostUsageSummary } from '../models/xPostMetric';
import logger from '../utils/logger';

export class XPremiumRequiredError extends Error {
  constructor() {
    super('X dual-posting requires an active premium subscription');
    this.name = 'XPremiumRequiredError';
  }
}

type XStatus = {
  connected: boolean;
  username?: string;
  userId?: string;
  totalPosts: number;
  postsLast24h: number;
  lastPosted?: number;
  limit24h?: number;
  remaining24h?: number;
};

type XPostResult = {
  id: string;
  text: string;
};

type XMediaInput = {
  url: string;
  mimeType?: string;
  fallbackUrls?: string[];
};

type XMediaUploadResponse = {
  data?: {
    id: string;
    media_key?: string;
    expires_after_secs?: number;
    size?: number;
    processing_info?: {
      state: 'pending' | 'in_progress' | 'succeeded' | 'failed';
      check_after_secs?: number;
      progress_percent?: number;
      error?: {
        name?: string;
        message?: string;
      };
    };
  };
};

type OAuthToken = {
  key: string;
  secret: string;
};

const DEFAULT_X_CALLBACK_URL = 'https://api.nostria.app/api/x/callback';
const DEFAULT_NOSTRIA_APP_URL = 'https://nostria.app/';

class XService {
  private readonly userSettingsRepository = RepositoryFactory.getUserSettingsRepository();
  private readonly accountRepository = RepositoryFactory.getAccountRepository();
  private readonly xPostRepository = RepositoryFactory.getXPostRepository();
  private readonly consumerKey = process.env.X_CONSUMER_KEY || process.env.X_CONSUMER_API_KEY || '';
  private readonly consumerSecret = process.env.X_CONSUMER_SECRET || process.env.X_CONSUMER_API_SECRET || '';
  private readonly callbackUrl = process.env.X_CALLBACK_URL || DEFAULT_X_CALLBACK_URL;
  private readonly appUrl = process.env.NOSTRIA_APP_URL || DEFAULT_NOSTRIA_APP_URL;
  private readonly encryptionSecret = process.env.X_TOKEN_ENCRYPTION_SECRET || '';
  private readonly maxPostsPer24h = Math.max(0, parseInt(process.env.X_MAX_POSTS_PER_24H || '12', 10) || 12);
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

  private async assertPremiumAccess(pubkey: string): Promise<void> {
    const hasPremiumSubscription = await this.accountRepository.hasPremiumSubscription(pubkey);
    if (!hasPremiumSubscription) {
      throw new XPremiumRequiredError();
    }
  }

  private async assertPostingLimit(pubkey: string): Promise<XPostUsageSummary> {
    const usageSummary = await this.xPostRepository.getUsageSummary(pubkey);

    if (this.maxPostsPer24h > 0 && usageSummary.postsLast24h >= this.maxPostsPer24h) {
      throw new Error(`X posting limit reached for the last 24 hours (${this.maxPostsPer24h} posts)`);
    }

    return usageSummary;
  }

  private isMissingXColumnsError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return error.message.includes('user_settings.xUserId')
      || error.message.includes('user_settings.xUsername')
      || error.message.includes('user_settings.xAccessToken')
      || error.message.includes('user_settings.xAccessSecret')
      || error.message.includes('user_settings.xRequestToken')
      || error.message.includes('user_settings.xRequestSecret')
      || error.message.includes('user_settings.xRequestCreated');
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
    method: 'POST' | 'GET',
    body: Record<string, unknown> | undefined,
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
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`X API request failed: ${response.status} ${responseText}`);
    }

    return JSON.parse(responseText) as T;
  }

  private async signedMultipartRequest<T>(
    url: string,
    method: 'POST',
    formData: FormData,
    token: OAuthToken
  ): Promise<T> {
    const requestData = { url, method };
    const authData = this.oauth.authorize(requestData, token);
    const headers = this.oauth.toHeader(authData) as unknown as Record<string, string>;

    const response = await fetch(url, {
      method,
      headers,
      body: formData,
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`X multipart request failed: ${response.status} ${responseText}`);
    }

    if (!responseText) {
      return {} as T;
    }

    return JSON.parse(responseText) as T;
  }

  private normalizeMimeType(mimeType?: string): string {
    if (!mimeType) {
      return 'application/octet-stream';
    }

    return mimeType.split(';')[0].trim().toLowerCase();
  }

  private getMediaCategory(mimeType: string): 'tweet_image' | 'tweet_video' | 'tweet_gif' {
    if (mimeType.startsWith('video/')) {
      return 'tweet_video';
    }

    if (mimeType === 'image/gif') {
      return 'tweet_gif';
    }

    if (mimeType.startsWith('image/')) {
      return 'tweet_image';
    }

    throw new Error(`Unsupported media type for X posting: ${mimeType}`);
  }

  private validateMediaInputs(media: XMediaInput[]): void {
    if (media.length === 0) {
      return;
    }

    const categories = media.map(item => this.getMediaCategory(this.normalizeMimeType(item.mimeType)));
    const hasNonImage = categories.some(category => category !== 'tweet_image');

    if (hasNonImage && media.length > 1) {
      throw new Error('X supports either up to 4 images or a single video/GIF per post');
    }

    if (!hasNonImage && media.length > 4) {
      throw new Error('X supports at most 4 images per post');
    }

    if (hasNonImage && categories.some(category => category === 'tweet_image')) {
      throw new Error('X does not allow mixing images with video or GIF in the same post');
    }
  }

  private async downloadMedia(media: XMediaInput): Promise<{ buffer: Buffer; mimeType: string }> {
    const urls = [media.url, ...(media.fallbackUrls || [])].filter(Boolean);
    let lastError: Error | null = null;

    for (const url of urls) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const mimeType = this.normalizeMimeType(media.mimeType || response.headers.get('content-type') || undefined);

        return {
          buffer: Buffer.from(arrayBuffer),
          mimeType,
        };
      } catch (error) {
        lastError = error as Error;
      }
    }

    throw new Error(`Failed to download media for X upload: ${lastError?.message || 'Unknown error'}`);
  }

  private async waitForProcessing(mediaId: string, token: OAuthToken): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const statusResponse = await this.signedJsonRequest<XMediaUploadResponse>(
        `https://api.x.com/2/media/upload?command=STATUS&media_id=${encodeURIComponent(mediaId)}`,
        'GET',
        undefined,
        token
      );

      const processingInfo = statusResponse.data?.processing_info;
      if (!processingInfo || processingInfo.state === 'succeeded') {
        return;
      }

      if (processingInfo.state === 'failed') {
        throw new Error(processingInfo.error?.message || 'X media processing failed');
      }

      const waitSeconds = processingInfo.check_after_secs ?? 1;
      await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
    }

    throw new Error('Timed out waiting for X media processing to finish');
  }

  private async uploadMediaItem(media: XMediaInput, token: OAuthToken): Promise<string> {
    const downloadedMedia = await this.downloadMedia(media);
    const mediaCategory = this.getMediaCategory(downloadedMedia.mimeType);

    const initializeResponse = await this.signedJsonRequest<XMediaUploadResponse>(
      'https://api.x.com/2/media/upload/initialize',
      'POST',
      {
        media_category: mediaCategory,
        media_type: downloadedMedia.mimeType,
        total_bytes: downloadedMedia.buffer.byteLength,
        shared: false,
      },
      token
    );

    const mediaId = initializeResponse.data?.id;
    if (!mediaId) {
      throw new Error('X media upload initialization failed');
    }

    const chunkSize = 4 * 1024 * 1024;
    for (let offset = 0, segmentIndex = 0; offset < downloadedMedia.buffer.length; offset += chunkSize, segmentIndex += 1) {
      const chunk = downloadedMedia.buffer.subarray(offset, offset + chunkSize);
      const formData = new FormData();
      formData.set('segment_index', segmentIndex.toString());
      formData.set('media', new Blob([chunk], { type: downloadedMedia.mimeType }), `chunk-${segmentIndex}`);

      await this.signedMultipartRequest(
        `https://api.x.com/2/media/upload/${encodeURIComponent(mediaId)}/append`,
        'POST',
        formData,
        token
      );
    }

    const finalizeResponse = await this.signedJsonRequest<XMediaUploadResponse>(
      `https://api.x.com/2/media/upload/${encodeURIComponent(mediaId)}/finalize`,
      'POST',
      undefined,
      token
    );

    if (finalizeResponse.data?.processing_info) {
      await this.waitForProcessing(mediaId, token);
    }

    return mediaId;
  }

  private async uploadMedia(media: XMediaInput[], token: OAuthToken): Promise<string[]> {
    this.validateMediaInputs(media);

    const mediaIds: string[] = [];
    for (const item of media) {
      mediaIds.push(await this.uploadMediaItem(item, token));
    }

    return mediaIds;
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
    try {
      const [settings, usageSummary] = await Promise.all([
        this.userSettingsRepository.getUserSettings(pubkey),
        this.xPostRepository.getUsageSummary(pubkey),
      ]);

      return {
        connected: !!(settings?.xAccessToken && settings?.xAccessSecret),
        username: settings?.xUsername,
        userId: settings?.xUserId,
        totalPosts: usageSummary.totalPosts,
        postsLast24h: usageSummary.postsLast24h,
        lastPosted: usageSummary.lastPosted,
        limit24h: this.maxPostsPer24h > 0 ? this.maxPostsPer24h : undefined,
        remaining24h: this.maxPostsPer24h > 0 ? Math.max(0, this.maxPostsPer24h - usageSummary.postsLast24h) : undefined,
      };
    } catch (error) {
      if (this.isMissingXColumnsError(error)) {
        logger.warn('X settings columns are not available yet; treating X as disconnected until migration is applied');
        return {
          connected: false,
          totalPosts: 0,
          postsLast24h: 0,
          limit24h: this.maxPostsPer24h > 0 ? this.maxPostsPer24h : undefined,
          remaining24h: this.maxPostsPer24h > 0 ? this.maxPostsPer24h : undefined,
        };
      }

      throw error;
    }
  }

  async startAuthorization(pubkey: string): Promise<string> {
    this.assertConfigured();
    await this.assertPremiumAccess(pubkey);

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
      await this.assertPremiumAccess(settings.pubkey);

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
    const usageSummary = await this.xPostRepository.getUsageSummary(pubkey);
    return {
      connected: false,
      totalPosts: usageSummary.totalPosts,
      postsLast24h: usageSummary.postsLast24h,
      lastPosted: usageSummary.lastPosted,
      limit24h: this.maxPostsPer24h > 0 ? this.maxPostsPer24h : undefined,
      remaining24h: this.maxPostsPer24h > 0 ? Math.max(0, this.maxPostsPer24h - usageSummary.postsLast24h) : undefined,
    };
  }

  async createPost(pubkey: string, text: string, media: XMediaInput[] = []): Promise<XPostResult> {
    this.assertConfigured();
    await this.assertPremiumAccess(pubkey);
    await this.assertPostingLimit(pubkey);

    const settings = await this.userSettingsRepository.getUserSettings(pubkey);
    if (!settings?.xAccessToken || !settings?.xAccessSecret) {
      throw new Error('No connected X account found for this user');
    }

    const token = {
      key: this.decrypt(settings.xAccessToken),
      secret: this.decrypt(settings.xAccessSecret),
    };

    const mediaIds = media.length > 0 ? await this.uploadMedia(media, token) : [];

    const payload: Record<string, unknown> = {
      text,
    };

    if (mediaIds.length > 0) {
      payload.media = {
        media_ids: mediaIds,
      };
    }

    const response = await this.signedJsonRequest<{ data?: { id: string; text: string } }>(
      'https://api.x.com/2/tweets',
      'POST',
      payload,
      token
    );

    if (!response.data?.id || !response.data.text) {
      throw new Error('X did not return a created post');
    }

    try {
      await this.xPostRepository.recordPost(pubkey, response.data.id, mediaIds.length > 0);
    } catch (error) {
      logger.error('Failed to persist X post usage metrics after successful post', error);
    }

    return response.data;
  }
}

export default XService;