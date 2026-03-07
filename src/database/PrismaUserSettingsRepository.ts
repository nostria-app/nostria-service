import { UserSettings, UserSettingsUpdate, XConnectionData, XRequestTokenData } from "../models/userSettings";
import { PrismaBaseRepository } from "./PrismaBaseRepository";
import logger from "../utils/logger";
import { now } from "../helpers/now";

class PrismaUserSettingsRepository extends PrismaBaseRepository {
  constructor() {
    super('user-settings');
  }

  private transformPrismaUserSettingsToUserSettings(prismaUserSettings: any): UserSettings {
    return {
      id: prismaUserSettings.id,
      type: 'user-settings',
      pubkey: prismaUserSettings.pubkey,
      releaseChannel: prismaUserSettings.releaseChannel,
      socialSharing: prismaUserSettings.socialSharing,
      xUserId: prismaUserSettings.xUserId ?? undefined,
      xUsername: prismaUserSettings.xUsername ?? undefined,
      xAccessToken: prismaUserSettings.xAccessToken ?? undefined,
      xAccessSecret: prismaUserSettings.xAccessSecret ?? undefined,
      xRequestToken: prismaUserSettings.xRequestToken ?? undefined,
      xRequestSecret: prismaUserSettings.xRequestSecret ?? undefined,
      xRequestCreated: prismaUserSettings.xRequestCreated ? Number(prismaUserSettings.xRequestCreated) : undefined,
      created: Number(prismaUserSettings.created),
      modified: Number(prismaUserSettings.modified)
    };
  }

  private transformUserSettingsToPrismaUserSettings(userSettings: UserSettings): any {
    return {
      id: userSettings.id,
      pubkey: userSettings.pubkey,
      releaseChannel: userSettings.releaseChannel,
      socialSharing: userSettings.socialSharing,
      xUserId: userSettings.xUserId ?? null,
      xUsername: userSettings.xUsername ?? null,
      xAccessToken: userSettings.xAccessToken ?? null,
      xAccessSecret: userSettings.xAccessSecret ?? null,
      xRequestToken: userSettings.xRequestToken ?? null,
      xRequestSecret: userSettings.xRequestSecret ?? null,
      xRequestCreated: userSettings.xRequestCreated ? BigInt(userSettings.xRequestCreated) : null,
      created: BigInt(userSettings.created),
      modified: BigInt(userSettings.modified || userSettings.created)
    };
  }

  /**
   * Create or update user settings with proper validation and defaults
   * @param pubkey - User's public key
   * @param settingsData - Settings data to upsert
   * @returns Promise<UserSettings>
   */
  async upsertUserSettings(pubkey: string, settingsData: Partial<UserSettingsUpdate>): Promise<UserSettings> {
    try {
      const id = `user-settings-${pubkey}`;

      // Get existing settings to preserve created date and merge data
      const existing = await this.getUserSettings(pubkey);

      // Validate and set defaults for new settings
      const settingsEntity: UserSettings = {
        id,
        type: 'user-settings',
        pubkey,
        // Apply defaults for required fields if not provided
        releaseChannel: settingsData.releaseChannel || existing?.releaseChannel || 'stable',
        socialSharing: settingsData.socialSharing !== undefined ? settingsData.socialSharing : existing?.socialSharing || false,
        created: existing?.created || now(),
        modified: now()
      };

      const prismaData = this.transformUserSettingsToPrismaUserSettings(settingsEntity);

      const upsertedSettings = await this.prisma.userSettings.upsert({
        where: { pubkey },
        update: {
          releaseChannel: prismaData.releaseChannel,
          socialSharing: prismaData.socialSharing,
          modified: prismaData.modified
        },
        create: prismaData
      });

      return this.transformPrismaUserSettingsToUserSettings(upsertedSettings);
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
      const settings = await this.prisma.userSettings.findUnique({
        where: { pubkey }
      });

      if (!settings) {
        return null;
      }

      return this.transformPrismaUserSettingsToUserSettings(settings);
    } catch (error) {
      logger.error('Failed to get user settings:', error);
      throw new Error(`Failed to get user settings: ${(error as Error).message}`);
    }
  }

  async getUserSettingsByXRequestToken(requestToken: string): Promise<UserSettings | null> {
    try {
      const settings = await this.prisma.userSettings.findFirst({
        where: { xRequestToken: requestToken }
      });

      if (!settings) {
        return null;
      }

      return this.transformPrismaUserSettingsToUserSettings(settings);
    } catch (error) {
      logger.error('Failed to get user settings by X request token:', error);
      throw new Error(`Failed to get user settings by X request token: ${(error as Error).message}`);
    }
  }

  /**
   * Update existing user settings
   * @param pubkey - User's public key
   * @param updates - Settings updates to apply
   * @returns Promise<UserSettings>
   */
  async updateUserSettings(pubkey: string, updates: UserSettingsUpdate): Promise<UserSettings> {
    try {
      const updateData: any = {
        modified: BigInt(now())
      };

      if (updates.releaseChannel !== undefined) {
        updateData.releaseChannel = updates.releaseChannel;
      }
      if (updates.socialSharing !== undefined) {
        updateData.socialSharing = updates.socialSharing;
      }

      const updatedSettings = await this.prisma.userSettings.update({
        where: { pubkey },
        data: updateData
      });

      return this.transformPrismaUserSettingsToUserSettings(updatedSettings);
    } catch (error) {
      logger.error('Failed to update user settings:', error);
      throw new Error(`Failed to update user settings: ${(error as Error).message}`);
    }
  }

  async storeXRequestToken(pubkey: string, tokenData: XRequestTokenData): Promise<UserSettings> {
    try {
      const existing = await this.getUserSettings(pubkey);
      const id = existing?.id || `user-settings-${pubkey}`;
      const created = existing?.created || now();

      const updatedSettings = await this.prisma.userSettings.upsert({
        where: { pubkey },
        update: {
          xRequestToken: tokenData.requestToken,
          xRequestSecret: tokenData.requestSecret,
          xRequestCreated: BigInt(now()),
          modified: BigInt(now())
        },
        create: {
          id,
          pubkey,
          releaseChannel: existing?.releaseChannel || 'stable',
          socialSharing: existing?.socialSharing || false,
          xRequestToken: tokenData.requestToken,
          xRequestSecret: tokenData.requestSecret,
          xRequestCreated: BigInt(now()),
          created: BigInt(created),
          modified: BigInt(now())
        }
      });

      return this.transformPrismaUserSettingsToUserSettings(updatedSettings);
    } catch (error) {
      logger.error('Failed to store X request token:', error);
      throw new Error(`Failed to store X request token: ${(error as Error).message}`);
    }
  }

  async clearXRequestToken(pubkey: string): Promise<UserSettings> {
    try {
      const existing = await this.getUserSettings(pubkey);

      if (!existing) {
        throw new Error('User settings not found');
      }

      const updatedSettings = await this.prisma.userSettings.update({
        where: { pubkey },
        data: {
          xRequestToken: null,
          xRequestSecret: null,
          xRequestCreated: null,
          modified: BigInt(now())
        }
      });

      return this.transformPrismaUserSettingsToUserSettings(updatedSettings);
    } catch (error) {
      logger.error('Failed to clear X request token:', error);
      throw new Error(`Failed to clear X request token: ${(error as Error).message}`);
    }
  }

  async connectXAccount(pubkey: string, connectionData: XConnectionData): Promise<UserSettings> {
    try {
      const existing = await this.getUserSettings(pubkey);
      const id = existing?.id || `user-settings-${pubkey}`;
      const created = existing?.created || now();

      const updatedSettings = await this.prisma.userSettings.upsert({
        where: { pubkey },
        update: {
          xUserId: connectionData.userId,
          xUsername: connectionData.username,
          xAccessToken: connectionData.accessToken,
          xAccessSecret: connectionData.accessSecret,
          xRequestToken: null,
          xRequestSecret: null,
          xRequestCreated: null,
          modified: BigInt(now())
        },
        create: {
          id,
          pubkey,
          releaseChannel: existing?.releaseChannel || 'stable',
          socialSharing: existing?.socialSharing || false,
          xUserId: connectionData.userId,
          xUsername: connectionData.username,
          xAccessToken: connectionData.accessToken,
          xAccessSecret: connectionData.accessSecret,
          created: BigInt(created),
          modified: BigInt(now())
        }
      });

      return this.transformPrismaUserSettingsToUserSettings(updatedSettings);
    } catch (error) {
      logger.error('Failed to connect X account:', error);
      throw new Error(`Failed to connect X account: ${(error as Error).message}`);
    }
  }

  async disconnectXAccount(pubkey: string): Promise<UserSettings> {
    try {
      const existing = await this.getUserSettings(pubkey);

      if (!existing) {
        throw new Error('User settings not found');
      }

      const updatedSettings = await this.prisma.userSettings.update({
        where: { pubkey },
        data: {
          xUserId: null,
          xUsername: null,
          xAccessToken: null,
          xAccessSecret: null,
          xRequestToken: null,
          xRequestSecret: null,
          xRequestCreated: null,
          modified: BigInt(now())
        }
      });

      return this.transformPrismaUserSettingsToUserSettings(updatedSettings);
    } catch (error) {
      logger.error('Failed to disconnect X account:', error);
      throw new Error(`Failed to disconnect X account: ${(error as Error).message}`);
    }
  }

  /**
   * Delete user settings
   * @param pubkey - User's public key
   * @returns Promise<void>
   */
  async deleteUserSettings(pubkey: string): Promise<void> {
    try {
      await this.prisma.userSettings.delete({
        where: { pubkey }
      });
    } catch (error) {
      logger.error('Failed to delete user settings:', error);
      throw new Error(`Failed to delete user settings: ${(error as Error).message}`);
    }
  }

  /**
   * Get users by release channel
   * @param channel - Release channel to filter by
   * @returns Promise<string[]> - Array of pubkeys
   */
  async getUsersByReleaseChannel(channel: 'stable' | 'beta' | 'alpha'): Promise<string[]> {
    try {
      const users = await this.prisma.userSettings.findMany({
        where: { releaseChannel: channel },
        select: { pubkey: true }
      });

      return users.map((user: any) => user.pubkey);
    } catch (error) {
      logger.error('Failed to get users by release channel:', error);
      throw new Error(`Failed to get users by release channel: ${(error as Error).message}`);
    }
  }

  /**
   * Get default settings structure
   * @returns UserSettings with default values
   */
  getDefaultSettings(): UserSettings {
    return {
      id: '',
      type: 'user-settings',
      pubkey: '',
      releaseChannel: 'stable',
      socialSharing: false,
      created: now(),
      modified: now()
    };
  }
}

export default PrismaUserSettingsRepository;