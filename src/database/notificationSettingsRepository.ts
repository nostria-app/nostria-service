import { NotificationSettings } from "../models/notificationSettings";
import CosmosDbBaseRepository from "./CosmosDbBaseRepository";
import logger from "../utils/logger";
import { now } from "../helpers/now";

class NotificationSettingsRepository extends CosmosDbBaseRepository<NotificationSettings> {
  constructor() {
    super('notification-settings');
  }

  async upsertSettings(pubkey: string, settingsData: any): Promise<NotificationSettings> {
    try {
      const ts = now();
      const id = `settings-${pubkey}`;
      
      // Try to get existing settings
      const existing = await this.getById(id, pubkey);
      
      const settingsEntity: NotificationSettings = {
        id,
        type: 'notification-settings',
        pubkey,
        enabled: settingsData.enabled !== undefined ? settingsData.enabled : true,
        filters: settingsData.filters,
        settings: settingsData.settings,
        created: existing?.created || ts,
        updated: ts,
        ...settingsData // Spread any additional properties
      };
      
      return await super.upsert(settingsEntity);
    } catch (error) {
      logger.error('Failed to upsert notification settings:', error);
      throw new Error(`Failed to upsert notification settings: ${(error as Error).message}`);
    }
  }

  async getSettings(pubkey: string): Promise<NotificationSettings | null> {
    try {
      const id = `settings-${pubkey}`;
      return await this.getById(id, pubkey);
    } catch (error) {
      logger.error('Failed to get notification settings:', error);
      throw new Error(`Failed to get notification settings: ${(error as Error).message}`);
    }
  }

  async deleteSettings(pubkey: string): Promise<void> {
    try {
      const id = `settings-${pubkey}`;
      await this.delete(id, pubkey);
    } catch (error) {
      logger.error('Failed to delete notification settings:', error);
      throw new Error(`Failed to delete notification settings: ${(error as Error).message}`);
    }
  }
}

export default new NotificationSettingsRepository();
