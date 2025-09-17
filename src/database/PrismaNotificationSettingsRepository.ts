import { NotificationSettings } from "../models/notificationSettings";
import { PrismaBaseRepository } from "./PrismaBaseRepository";
import logger from "../utils/logger";
import { now } from "../helpers/now";

class PrismaNotificationSettingsRepository extends PrismaBaseRepository {
  constructor() {
    super('notification-settings');
  }

  private transformPrismaNotificationSettingsToNotificationSettings(prismaNotificationSettings: any): NotificationSettings {
    return {
      id: prismaNotificationSettings.id,
      type: 'notification-settings',
      pubkey: prismaNotificationSettings.pubkey,
      enabled: prismaNotificationSettings.enabled,
      filters: prismaNotificationSettings.filters,
      settings: prismaNotificationSettings.settings,
      created: Number(prismaNotificationSettings.created),
      modified: Number(prismaNotificationSettings.modified),
    };
  }

  async upsertSettings(pubkey: string, settingsData: any): Promise<NotificationSettings> {
    try {
      const ts = now();
      const id = `notification-settings-${pubkey}`;

      // Try to get existing settings
      const existing = await this.getSettings(pubkey);

      const settingsEntityData = {
        id,
        pubkey,
        enabled: settingsData.enabled !== undefined ? settingsData.enabled : true,
        filters: settingsData.filters ? (settingsData.filters as any) : null,
        settings: settingsData.settings ? (settingsData.settings as any) : null,
        created: existing ? existing.created : ts,
        modified: ts,
      };

      let result;
      if (existing) {
        result = await this.prisma.notificationSettings.update({
          where: { id },
          data: {
            enabled: settingsEntityData.enabled,
            filters: settingsEntityData.filters,
            settings: settingsEntityData.settings,
            modified: BigInt(settingsEntityData.modified),
          }
        });
      } else {
        result = await this.prisma.notificationSettings.create({
          data: {
            id: settingsEntityData.id,
            pubkey: settingsEntityData.pubkey,
            enabled: settingsEntityData.enabled,
            filters: settingsEntityData.filters,
            settings: settingsEntityData.settings,
            created: BigInt(settingsEntityData.created),
            modified: BigInt(settingsEntityData.modified),
          }
        });
      }

      logger.info(`Upserted notification settings: ${id}`);
      return this.transformPrismaNotificationSettingsToNotificationSettings(result);
    } catch (error) {
      this.handlePrismaError(error, 'upsert');
    }
  }

  async getSettings(pubkey: string): Promise<NotificationSettings | null> {
    try {
      const id = `notification-settings-${pubkey}`;
      const result = await this.prisma.notificationSettings.findFirst({
        where: { 
          id: id,
          pubkey: pubkey 
        }
      });

      return result ? this.transformPrismaNotificationSettingsToNotificationSettings(result) : null;
    } catch (error) {
      logger.error('Failed to get notification settings by pubkey:', error);
      throw new Error(`Failed to get notification settings: ${(error as Error).message}`);
    }
  }

  async getAllSettings(limit: number = 100): Promise<NotificationSettings[]> {
    try {
      const results = await this.prisma.notificationSettings.findMany({
        orderBy: { created: 'desc' },
        take: limit
      });

      return results.map((result: any) => this.transformPrismaNotificationSettingsToNotificationSettings(result));
    } catch (error) {
      logger.error('Failed to get all notification settings:', error);
      throw new Error(`Failed to get notification settings: ${(error as Error).message}`);
    }
  }

  async updateSettings(pubkey: string, settingsData: any): Promise<NotificationSettings> {
    try {
      const id = `notification-settings-${pubkey}`;
      const ts = now();

      const result = await this.prisma.notificationSettings.update({
        where: { id },
        data: {
          enabled: settingsData.enabled,
          filters: settingsData.filters ? (settingsData.filters as any) : null,
          settings: settingsData.settings ? (settingsData.settings as any) : null,
          modified: BigInt(ts),
        }
      });

      logger.info(`Updated notification settings: ${id}`);
      return this.transformPrismaNotificationSettingsToNotificationSettings(result);
    } catch (error) {
      this.handlePrismaError(error, 'update');
    }
  }

  async deleteSettings(pubkey: string): Promise<void> {
    try {
      const id = `notification-settings-${pubkey}`;
      await this.prisma.notificationSettings.delete({
        where: { id }
      });

      logger.info(`Deleted notification settings: ${id}`);
    } catch (error) {
      this.handlePrismaError(error, 'delete');
    }
  }

  // Additional helper methods
  async getEnabledSettings(limit: number = 100): Promise<NotificationSettings[]> {
    try {
      const results = await this.prisma.notificationSettings.findMany({
        where: { enabled: true },
        orderBy: { modified: 'desc' },
        take: limit
      });

      return results.map((result: any) => this.transformPrismaNotificationSettingsToNotificationSettings(result));
    } catch (error) {
      logger.error('Failed to get enabled notification settings:', error);
      throw new Error(`Failed to get enabled notification settings: ${(error as Error).message}`);
    }
  }
}

export default PrismaNotificationSettingsRepository;