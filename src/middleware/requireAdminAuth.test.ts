import request from 'supertest';
import { generateKeyPair, testAccount, NIP98Fixture } from '../helpers/testHelper';
import { finalizeEvent, nip98 } from 'nostr-tools';

// Mock the config
jest.mock('../config', () => ({
  admin: {
    pubkeys: ['test_admin_pubkey_1', 'test_admin_pubkey_2']
  },
  tiers: {
    free: {
      tier: 'free',
      name: 'Free',
      entitlements: {
        notificationsPerDay: 5,
        features: ['BASIC_WEBPUSH', 'COMMUNITY_SUPPORT']
      }
    }
  }
}));

// Mock the repositories
jest.mock('../database/accountRepository');
jest.mock('../database/paymentRepository');
jest.mock('../database/notificationSubscriptionRepository');

// Mock other routes 
jest.mock('../routes/subscription', () => {
  const router = require('express').Router();
  return router;
});

jest.mock('../routes/notification', () => {
  const router = require('express').Router();
  return router;
});

import app from '../index';
import accountRepository from '../database/accountRepository';

const mockAccountRepository = accountRepository as jest.Mocked<typeof accountRepository>;

// Helper function to generate NIP-98 token with specific pubkey
const generateAdminNIP98 = async (pubkey: string, method = 'GET', url = '/api/account/list'): Promise<NIP98Fixture> => {
  const keyPair = generateKeyPair();
  // Override the pubkey to simulate admin
  keyPair.pubkey = pubkey;
  const token = await nip98.getToken(`http://localhost:3000${url}`, method, e => finalizeEvent(e, keyPair.privateKey));
  return {
    ...keyPair,
    token,
  };
};

describe('Admin Authentication Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Account List Endpoint (/api/account/list)', () => {
    it('should allow access for admin users', async () => {
      const adminAuth = await generateAdminNIP98('test_admin_pubkey_1');
      const mockAccounts = [testAccount()];
      
      mockAccountRepository.getAllAccounts.mockResolvedValue(mockAccounts);

      const response = await request(app)
        .get('/api/account/list')
        .set('Authorization', `Nostr ${adminAuth.token}`);

      expect(response.status).toBe(200);
      expect(response.body).toBeInstanceOf(Array);
    });

    it('should deny access for non-admin users', async () => {
      const nonAdminAuth = await generateAdminNIP98('non_admin_pubkey');

      const response = await request(app)
        .get('/api/account/list')
        .set('Authorization', `Nostr ${nonAdminAuth.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Admin access required');
    });

    it('should deny access without authentication', async () => {
      const response = await request(app)
        .get('/api/account/list');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('NIP98 Authorization header required');
    });
  });

  describe('Payment List Endpoint (/api/payment)', () => {
    it('should allow access for admin users', async () => {
      const adminAuth = await generateAdminNIP98('test_admin_pubkey_2', 'GET', '/api/payment');

      const response = await request(app)
        .get('/api/payment')
        .set('Authorization', `Nostr ${adminAuth.token}`);

      // Should return 200 or specific payment-related response
      expect(response.status).not.toBe(403);
    });

    it('should deny access for non-admin users', async () => {
      const nonAdminAuth = await generateAdminNIP98('non_admin_pubkey', 'GET', '/api/payment');

      const response = await request(app)
        .get('/api/payment')
        .set('Authorization', `Nostr ${nonAdminAuth.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Admin access required');
    });
  });

  describe('Admin Configuration', () => {
    it('should handle empty admin pubkeys configuration', async () => {
      // Temporarily override config for this test
      const originalConfig = require('../config').default;
      jest.doMock('../config', () => ({
        admin: {
          pubkeys: []
        }
      }));

      const adminAuth = await generateAdminNIP98('test_admin_pubkey_1');

      const response = await request(app)
        .get('/api/account/list')
        .set('Authorization', `Nostr ${adminAuth.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Admin access not configured');

      // Restore original config
      jest.doMock('../config', () => originalConfig);
    });
  });
});