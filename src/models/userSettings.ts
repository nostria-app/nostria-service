export interface UserSettings {
  id: string; // Will be "-user-settings" + pubkey
  type: 'user-settings' | string;
  pubkey: string;
  releaseChannel: 'stable' | 'beta' | 'alpha';
  socialSharing: boolean;
  xUserId?: string;
  xUsername?: string;
  xAccessToken?: string;
  xAccessSecret?: string;
  xRequestToken?: string;
  xRequestSecret?: string;
  xRequestCreated?: number;
  created: number; // Timestamp in milliseconds
  modified: number; // Timestamp in milliseconds
}

export interface UserSettingsUpdate {
  releaseChannel?: 'stable' | 'beta' | 'alpha';
  socialSharing?: boolean;
}

export interface UserSettingsResponse {
  pubkey: string;
  releaseChannel: 'stable' | 'beta' | 'alpha';
  socialSharing: boolean;
  created: number;
  modified: number;
}

export interface XConnectionData {
  userId: string;
  username: string;
  accessToken: string;
  accessSecret: string;
}

export interface XRequestTokenData {
  requestToken: string;
  requestSecret: string;
}
