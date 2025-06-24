import { NotificationSettings } from "../models/notificationSettings";
import CosmosDbBaseRepository from "./CosmosDbBaseRepository";
import logger from "../utils/logger";

class NotificationSettingsRepository extends CosmosDbBaseRepository<NotificationSettings> {
  constructor() {
    super('notification-settings');
  }

  async upsertSettings(pubkey: string, settingsData: any): Promise<NotificationSettings> {
    try {
      const now = new Date();
      const id = `${pubkey}-settings`;
      
      // Try to get existing settings
      const existing = await this.getById(id, pubkey);
      
      const settingsEntity: NotificationSettings = {
        id,
        type: 'notification-settings',
        pubkey,
        enabled: settingsData.enabled !== undefined ? settingsData.enabled : true,
        filters: settingsData.filters,
        settings: settingsData.settings,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
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
      const id = `${pubkey}-settings`;
      return await this.getById(id, pubkey);
    } catch (error) {
      logger.error('Failed to get notification settings:', error);
      throw new Error(`Failed to get notification settings: ${(error as Error).message}`);
    }
  }

  async deleteSettings(pubkey: string): Promise<void> {
    try {
      const id = `${pubkey}-settings`;
      await this.delete(id, pubkey);
    } catch (error) {
      logger.error('Failed to delete notification settings:', error);
      throw new Error(`Failed to delete notification settings: ${(error as Error).message}`);
    }
  }
}

export default new NotificationSettingsRepository();
