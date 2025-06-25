import { UserSettings, UserSettingsUpdate } from "../models/userSettings";
import CosmosDbBaseRepository from "./CosmosDbBaseRepository";
import logger from "../utils/logger";
import { now } from "../helpers/now";

class AccountSettingsRepository extends CosmosDbBaseRepository<UserSettings> {
  constructor() {
    super('account-settings');
  }

  /**
   * Create or update user settings with proper validation and defaults
   * @param pubkey - User's public key
   * @param settingsData - Settings data to upsert
   * @returns Promise<UserSettings>
   */
  async upsertUserSettings(pubkey: string, settingsData: Partial<UserSettingsUpdate>): Promise<UserSettings> {
    try {
      const id = `${this.entityType}-${pubkey}`;

      // Get existing settings to preserve created date and merge data
      const existing = await this.getUserSettings(pubkey);

      // Validate and set defaults for new settings
      const settingsEntity: UserSettings = {
        id,
        type: this.entityType,
        pubkey,
        // Apply defaults for required fields if not provided
        releaseChannel: settingsData.releaseChannel || existing?.releaseChannel || 'stable',
        socialSharing: settingsData.socialSharing !== undefined ? settingsData.socialSharing : (existing?.socialSharing ?? true),
        created: existing?.created || now()
      };

      // Validate release channel
      if (!['stable', 'beta', 'alpha'].includes(settingsEntity.releaseChannel)) {
        throw new Error('Invalid release channel. Must be one of: stable, beta, alpha');
      }

      const result = await super.upsert(settingsEntity);
      return result;
    } catch (error) {
      logger.error('Failed to upsert user settings:', error);
      throw new Error(`Failed to upsert user settings: ${(error as Error).message}`);
    }
  }

  /**
   * Get user settings by public key
   * @param pubkey - User's public key
   * @returns Promise<UserSettings | null>
   */
  async getUserSettings(pubkey: string): Promise<UserSettings | null> {
    try {
      const id = `${this.entityType}-${pubkey}`;

      return await this.getById(id, pubkey);
    } catch (error) {
      console.log(error);
      logger.error('Failed to get user settings:', error);
      throw new Error(`Failed to get user settings: ${(error as Error).message}`);
    }
  }

  /**
   * Update specific user settings fields
   * @param pubkey - User's public key
   * @param updates - Partial settings to update
   * @returns Promise<UserSettings>
   */
  async updateUserSettings(pubkey: string, updates: UserSettingsUpdate): Promise<UserSettings> {
    try {
      const existing = await this.getUserSettings(pubkey);

      if (!existing) {
        // If no existing settings, create new ones with the updates
        return await this.upsertUserSettings(pubkey, updates);
      }

      // Merge updates with existing settings
      const updatedSettings: Partial<UserSettingsUpdate> = {
        ...updates
      };

      return await this.upsertUserSettings(pubkey, updatedSettings);
    } catch (error) {
      logger.error('Failed to update user settings:', error);
      throw new Error(`Failed to update user settings: ${(error as Error).message}`);
    }
  }

  /**
   * Delete user settings
   * @param pubkey - User's public key
   * @returns Promise<void>
   */
  async deleteUserSettings(pubkey: string): Promise<void> {
    try {
      const id = `${this.entityType}-${pubkey}`;
      await this.delete(id, pubkey);
    } catch (error) {
      logger.error('Failed to delete user settings:', error);
      throw new Error(`Failed to delete user settings: ${(error as Error).message}`);
    }
  }

  /**
   * Get default user settings
   * @returns Default settings object
   */
  getDefaultSettings(): Omit<UserSettings, 'id' | 'type' | 'pubkey' | 'created'> {
    return {
      releaseChannel: 'stable',
      socialSharing: true
    };
  }

  /**
   * Get all users by release channel (for feature rollout purposes)
   * @param releaseChannel - Release channel to filter by
   * @returns Promise<string[]> - Array of pubkeys
   */
  async getUsersByReleaseChannel(releaseChannel: 'stable' | 'beta' | 'alpha'): Promise<string[]> {
    try {
      const query = {
        query: 'SELECT c.pubkey FROM c WHERE c.type = @type AND c.releaseChannel = @releaseChannel',
        parameters: [
          { name: '@type', value: 'user-settings' },
          { name: '@releaseChannel', value: releaseChannel }
        ]
      };

      const results = await this.queryWithType<any>(query);
      return results.map(r => r.pubkey);
    } catch (error) {
      logger.error('Failed to get users by release channel:', error);
      throw new Error(`Failed to get users by release channel: ${(error as Error).message}`);
    }
  }
}

export default new AccountSettingsRepository();
