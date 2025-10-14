// Mock dependencies to prevent real database connections
jest.mock('../database/notificationSubscriptionRepository', () => ({
  __esModule: true,
  default: {
    getAllUserPubkeys: jest.fn(),
    getUserSubscriptions: jest.fn()
  }
}));

jest.mock('../database/notificationSettingsRepository', () => ({
  __esModule: true,
  default: {
    getSettings: jest.fn()
  }
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

// Mock web push to prevent initialization issues
jest.mock('../utils/webPush', () => ({
  sendNotification: jest.fn(),
  sendBulkNotifications: jest.fn()
}));

// Set up environment before importing app
process.env.NODE_ENV = 'test';
process.env.SERVICE_API_KEY = 'test-api-key';

import request from 'supertest';
import express from 'express';
import usersRoutes from './users';
import { apiKeyAuth } from '../middleware/auth';
import notificationSubscriptionRepository from '../database/notificationSubscriptionRepository';
import notificationSettingsRepository from '../database/notificationSettingsRepository';

// Create a minimal test app
const app = express();
app.use(express.json());
app.use('/api/users', apiKeyAuth, usersRoutes);

describe('Users API', () => {
  const validApiKey = process.env.SERVICE_API_KEY || 'test-api-key';
  const mockNotificationSubscriptionRepository = notificationSubscriptionRepository as jest.Mocked<typeof notificationSubscriptionRepository>;
  const mockNotificationSettingsRepository = notificationSettingsRepository as jest.Mocked<typeof notificationSettingsRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/users', () => {
    it('should require API key authentication', async () => {
      const response = await request(app)
        .get('/api/users');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Unauthorized: Invalid API key');
    });

    it('should return users with valid API key', async () => {
      // Mock data
      const mockPubkeys = ['pubkey1', 'pubkey2'];
      const mockSettings1 = {
        id: 'notification-settings-pubkey1',
        type: 'notification-settings' as const,
        pubkey: 'pubkey1',
        enabled: true,
        filters: null,
        settings: null,
        created: 1234567890,
        modified: 1234567890
      };
      const mockSubscriptions = [
        [{ 
          id: 'sub1', 
          type: 'notification-subscription' as const,
          pubkey: 'pubkey1',
          subscription: { endpoint: 'test', keys: { p256dh: 'test', auth: 'test' } },
          deviceKey: 'device1',
          created: 1234567890,
          modified: 1234567890
        }], // pubkey1 has 1 subscription
        [{ 
          id: 'sub2', 
          type: 'notification-subscription' as const,
          pubkey: 'pubkey2',
          subscription: { endpoint: 'test', keys: { p256dh: 'test', auth: 'test' } },
          deviceKey: 'device2',
          created: 1234567890,
          modified: 1234567890
        }, { 
          id: 'sub3', 
          type: 'notification-subscription' as const,
          pubkey: 'pubkey2',
          subscription: { endpoint: 'test', keys: { p256dh: 'test', auth: 'test' } },
          deviceKey: 'device3',
          created: 1234567890,
          modified: 1234567890
        }] // pubkey2 has 2 subscriptions
      ];

      mockNotificationSubscriptionRepository.getAllUserPubkeys.mockResolvedValue(mockPubkeys);
      mockNotificationSettingsRepository.getSettings
        .mockResolvedValueOnce(mockSettings1)
        .mockResolvedValueOnce(null); // No settings for pubkey2
      mockNotificationSubscriptionRepository.getUserSubscriptions
        .mockResolvedValueOnce(mockSubscriptions[0])
        .mockResolvedValueOnce(mockSubscriptions[1]);

      const response = await request(app)
        .get('/api/users')
        .set('x-api-key', validApiKey);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('users');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('hasMore');
      expect(Array.isArray(response.body.users)).toBe(true);
      expect(response.body.users).toHaveLength(2);
      expect(response.body.users[0]).toMatchObject({
        pubkey: 'pubkey1',
        enabled: true,
        subscriptionCount: 1
      });
      expect(response.body.users[1]).toMatchObject({
        pubkey: 'pubkey2',
        enabled: true, // Default value
        subscriptionCount: 2
      });
    });

    it('should accept limit parameter', async () => {
      mockNotificationSubscriptionRepository.getAllUserPubkeys.mockResolvedValue([]);
      
      const response = await request(app)
        .get('/api/users?limit=50')
        .set('x-api-key', validApiKey);

      expect(response.status).toBe(200);
    });

    it('should accept enabledOnly parameter', async () => {
      mockNotificationSubscriptionRepository.getAllUserPubkeys.mockResolvedValue([]);
      
      const response = await request(app)
        .get('/api/users?enabledOnly=true')
        .set('x-api-key', validApiKey);

      expect(response.status).toBe(200);
    });

    it('should limit maximum results to 1000', async () => {
      mockNotificationSubscriptionRepository.getAllUserPubkeys.mockResolvedValue([]);
      
      const response = await request(app)
        .get('/api/users?limit=5000')
        .set('x-api-key', validApiKey);

      expect(response.status).toBe(200);
      // The limit should be capped at 1000
    });

    it('should return empty result when no users have subscriptions', async () => {
      mockNotificationSubscriptionRepository.getAllUserPubkeys.mockResolvedValue([]);
      
      const response = await request(app)
        .get('/api/users')
        .set('x-api-key', validApiKey);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        users: [],
        total: 0,
        hasMore: false
      });
    });
  });
});