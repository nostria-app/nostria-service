import { CosmosDbEntity } from "../database/CosmosDbBaseRepository";

export interface UserSettings extends CosmosDbEntity {
  id: string; // Will be "-user-settings" + pubkey
  type: 'user-settings' | string;
  pubkey: string;
  releaseChannel: 'stable' | 'beta' | 'alpha';
  socialSharing: boolean;
  created: number; // Timestamp in milliseconds
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
