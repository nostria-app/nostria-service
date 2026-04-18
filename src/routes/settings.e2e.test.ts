import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import app from '../index';
import RepositoryFactory from '../database/RepositoryFactory';
import { now } from '../helpers/now';

const userSettingsRepository = RepositoryFactory.getUserSettingsRepository();

// Mock the repository
// jest.mock('../database/RepositoryFactory');
// const mockUserSettingsRepository = userSettingsRepository as jest.Mocked<typeof userSettingsRepository>;

// Mock NIP-98 validation
// jest.mock('nostr-tools', () => ({
//   nip98: {
//     validateToken: jest.fn().mockResolvedValue(true)
//   }
// }));

// Comment out this test for normal test runs, only for end-to-end testing
describe('End-to-end Settings API (populated database)', () => {
  const testPubkey = 'test_pubkey_123';

  const validSettings = {
    socialSharing: false
  };

  beforeEach(() => {

  });

  afterEach(() => {

  });

  describe('Insert, Get and Remove User Settings', () => {
    it('should create new user settings successfully', async () => {
      const settings = await userSettingsRepository.upsertUserSettings(testPubkey, validSettings);
      expect(settings).toBeDefined();

      const savedSettings = await userSettingsRepository.getUserSettings(testPubkey);
      expect(savedSettings).toBeDefined();
      expect(savedSettings?.id).toBe(settings.id);
      expect(savedSettings?.created).toBe(settings.created);

      savedSettings!.socialSharing = true;
      const updatedSettings = await userSettingsRepository.upsertUserSettings(testPubkey, savedSettings!);

      // Ensure that created date is preserved
      expect(updatedSettings?.created).toBe(savedSettings!.created);

      // This will only work if it takes more than a second to update.
      // expect(updatedSettings?.modified).toBeGreaterThan(savedSettings!.modified!);

      // await userSettingsRepository.deleteUserSettings(testPubkey);
    });

    it('should get user settings successfully', async () => {
      const savedSettings = await userSettingsRepository.getUserSettings(testPubkey);
      expect(savedSettings).toBeDefined();
    });
  });
});
