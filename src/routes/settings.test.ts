import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import app from '../index';
import RepositoryFactory from '../database/RepositoryFactory';
import { now } from '../helpers/now';

const userSettingsRepository = RepositoryFactory.getUserSettingsRepository();

// Mock the repository
jest.mock('../database/RepositoryFactory');
const mockUserSettingsRepository = userSettingsRepository as jest.Mocked<typeof userSettingsRepository>;

// Mock NIP-98 validation
jest.mock('nostr-tools', () => ({
  nip98: {
    validateToken: jest.fn().mockResolvedValue(true)
  }
}));

describe('Settings API', () => {
  const testPubkey = 'test_pubkey_123';
  const validSettings = {
    socialSharing: false
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('POST /api/settings/:pubkey', () => {
    it('should create new user settings successfully', async () => {
      const mockSettings = {
        id: `user-settings-${testPubkey}`,
        type: 'user-settings',
        pubkey: testPubkey,
        socialSharing: false,
        created: now(),
        modified: now()
      };

      mockUserSettingsRepository.upsertUserSettings.mockResolvedValue(mockSettings as any);

      const response = await request(app)
        .post(`/api/settings/${testPubkey}`)
        .set('Authorization', 'Bearer test_token')
        .send(validSettings);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.pubkey).toBe(testPubkey);
      expect(response.body.data.socialSharing).toBe(false);
      expect(mockUserSettingsRepository.upsertUserSettings).toHaveBeenCalledWith(testPubkey, validSettings);
    });

    it('should return 401 without valid authorization', async () => {
      const response = await request(app)
        .post(`/api/settings/${testPubkey}`)
        .send(validSettings);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid or missing authorization token');
    });

    it('should return 400 for invalid social sharing value', async () => {
      const invalidSettings = {
        socialSharing: 'not_a_boolean'
      };

      const response = await request(app)
        .post(`/api/settings/${testPubkey}`)
        .set('Authorization', 'Bearer test_token')
        .send(invalidSettings);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid social sharing setting');
    });
  });

  describe('GET /api/settings/:pubkey', () => {
    it('should retrieve existing user settings', async () => {
      const mockSettings = {
        id: `user-settings-${testPubkey}`,
        type: 'user-settings',
        pubkey: testPubkey,
        socialSharing: false,
        created: now(),
        modified: now()
      };

      mockUserSettingsRepository.getUserSettings.mockResolvedValue(mockSettings as any);

      const response = await request(app)
        .get(`/api/settings/${testPubkey}`)
        .set('Authorization', 'Bearer test_token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.pubkey).toBe(testPubkey);
      expect(response.body.data.socialSharing).toBe(false);
    });

    it('should return default settings when none exist', async () => {
      mockUserSettingsRepository.getUserSettings.mockResolvedValue(null);
      mockUserSettingsRepository.getDefaultSettings.mockReturnValue({
        socialSharing: true
      });

      const response = await request(app)
        .get(`/api/settings/${testPubkey}`)
        .set('Authorization', 'Bearer test_token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.socialSharing).toBe(true);
      expect(response.body.isDefault).toBe(true);
    });
  });

  describe('PATCH /api/settings/:pubkey', () => {
    it('should update specific settings fields', async () => {
      const updates = { socialSharing: true };
      const mockUpdatedSettings = {
        id: `user-settings-${testPubkey}`,
        type: 'user-settings',
        pubkey: testPubkey,
        socialSharing: true,
        created: now(),
        updated: now()
      };

      mockUserSettingsRepository.updateUserSettings.mockResolvedValue(mockUpdatedSettings as any);

      const response = await request(app)
        .patch(`/api/settings/${testPubkey}`)
        .set('Authorization', 'Bearer test_token')
        .send(updates);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
  expect(response.body.data.socialSharing).toBe(true);
      expect(mockUserSettingsRepository.updateUserSettings).toHaveBeenCalledWith(testPubkey, updates);
    });

    it('should return 400 for empty update object', async () => {
      const response = await request(app)
        .patch(`/api/settings/${testPubkey}`)
        .set('Authorization', 'Bearer test_token')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request body');
    });
  });

  describe('DELETE /api/settings/:pubkey', () => {
    it('should delete user settings successfully', async () => {
      const mockSettings = {
        id: `user-settings-${testPubkey}`,
        type: 'user-settings',
        pubkey: testPubkey,
        socialSharing: false,
        created: now(),
        updated: now()
      };

      mockUserSettingsRepository.getUserSettings.mockResolvedValue(mockSettings as any);
      mockUserSettingsRepository.deleteUserSettings.mockResolvedValue();

      const response = await request(app)
        .delete(`/api/settings/${testPubkey}`)
        .set('Authorization', 'Bearer test_token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockUserSettingsRepository.deleteUserSettings).toHaveBeenCalledWith(testPubkey);
    });

    it('should return 404 when settings do not exist', async () => {
      mockUserSettingsRepository.getUserSettings.mockResolvedValue(null);

      const response = await request(app)
        .delete(`/api/settings/${testPubkey}`)
        .set('Authorization', 'Bearer test_token');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Settings not found');
    });
  });
});
