import request from 'supertest';
import { Response } from 'supertest';

// Mock some other routes before importing app so that their initialization code is skipped
// Mock removed - BaseRepository no longer exists
jest.mock('../routes/subscription', () => {
  const router = require('express').Router();
  return router;
});

jest.mock('../routes/notification', () => {
  const router = require('express').Router();
  return router;
});

// Now import the app after mocks are set up
jest.mock('../database/accountRepository');
jest.mock('../database/paymentRepository');

// Mock config for admin authentication
jest.mock('../config', () => ({
  admin: {
    pubkeys: ['test_admin_pubkey']
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

import app from '../index';
import { generateNIP98, NIP98Fixture, testAccount, testPayment, generateKeyPair } from '../helpers/testHelper';
import { finalizeEvent, nip98 } from 'nostr-tools';

import RepositoryFactory from '../database/RepositoryFactory';
import { DEFAULT_SUBSCRIPTION } from '../models/accountSubscription';

import config from '../config';

const paymentRepository = RepositoryFactory.getPaymentRepository();
const accountRepository = RepositoryFactory.getAccountRepository();
import { now } from '../helpers/now';
import { Account } from '../models/account';

const mockPaymentRepository = paymentRepository as jest.Mocked<typeof paymentRepository>;
const mockAccountRepository = accountRepository as jest.Mocked<typeof accountRepository>;

// Helper function to generate admin NIP-98 token
const generateAdminNIP98 = async (method = 'GET', url = '/api/account/list'): Promise<NIP98Fixture> => {
  const keyPair = generateKeyPair();
  // Use the admin pubkey from mocked config
  keyPair.pubkey = 'test_admin_pubkey';
  const token = await nip98.getToken(`http://localhost:3000${url}`, method, e => finalizeEvent(e, keyPair.privateKey));
  return {
    ...keyPair,
    token,
  };
};

describe('Account API', () => {
  let account: Account;

  beforeEach(() => {
    account = testAccount()
    jest.resetAllMocks();
  });

  describe('GET /api/account/:pubkeyOrUsername', () => {
    test('should check if pubkey is not available', async () => {
      mockAccountRepository.getByPubkey.mockResolvedValueOnce(account)

      const response = await request(app)
        .get(`/api/account/${account.pubkey}`)
        .expect(200);

      expect(mockAccountRepository.getByPubkey).toHaveBeenCalledWith(account.pubkey)
      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("result", {
        pubkey: account.pubkey,
        signupDate: account.created,
        tier: account.tier,
        username: account.username,
        isActive: true,
      });
    });

    test('should return proper tier', async () => {
      mockAccountRepository.getByPubkey.mockResolvedValueOnce(testAccount({
        tier: 'premium',
      }))
      const response = await request(app).get(`/api/account/${account.pubkey}`)
      expect(response.body.result).toHaveProperty("tier", 'premium');
    });

    test('should return isActive true if subscription is not expired', async () => {
      mockAccountRepository.getByPubkey.mockResolvedValueOnce(testAccount({
        expires: Date.now() + 1000
      }))
      const response = await request(app).get(`/api/account/${account.pubkey}`)
      expect(response.body.result).toHaveProperty("isActive", true);
    });

    test('should return isActive false if subscription expired', async () => {
      mockAccountRepository.getByPubkey.mockResolvedValueOnce(testAccount({
        expires: Date.now() - 100
      }))
      const response = await request(app).get(`/api/account/${account.pubkey}`)
      expect(response.body.result).toHaveProperty("isActive", false);
    });

    test('should return success false if user does not exist for the pubkey', async () => {
      mockAccountRepository.getByPubkey.mockResolvedValueOnce(null)

      const response = await request(app)
        .get(`/api/account/${account.pubkey}`)
        .expect(200);

      expect(response.body).toEqual({
        success: false,
        message: 'User not found'
      });

      expect(mockAccountRepository.getByPubkey).toHaveBeenCalledWith(account.pubkey);
    });

    test('should return existing user by username', async () => {
      mockAccountRepository.getByUsername.mockResolvedValueOnce(account)

      const response = await request(app)
        .get(`/api/account/${account.username}`)
        .expect(200);

      expect(mockAccountRepository.getByUsername).toHaveBeenCalledWith(account.username)
      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("result", {
        pubkey: account.pubkey,
        signupDate: account.created,
        tier: account.tier,
        username: account.username,
        isActive: true,
      });
    });

    test('should return success false if user does not exist for the username', async () => {
      mockAccountRepository.getByUsername.mockResolvedValueOnce(null)

      const response = await request(app)
        .get(`/api/account/${account.username}`)
        .expect(200);

      expect(response.body).toEqual({
        success: false,
        message: 'User not found'
      });
      expect(mockAccountRepository.getByPubkey).not.toHaveBeenCalled()
      expect(mockAccountRepository.getByUsername).toHaveBeenCalledWith(account.username);
    });

    test('should apply rate limits', async () => {
      mockAccountRepository.getByPubkey.mockResolvedValue(account)

      // Make multiple requests quickly
      const requests = Array.from({ length: 30 }, () =>
        request(app)
          .get(`/api/account/${account.pubkey}`)
      );

      const responses = await Promise.all(requests);

      // Some requests should be rate limited
      const hasRateLimited = responses.some((response: Response) => response.status === 429);
      expect(hasRateLimited).toBe(true);
    });
  });

  describe('POST /api/account', () => {
    test('should create new free account successfully', async () => {
      mockAccountRepository.getByPubkey.mockResolvedValueOnce(null);

      const response = await request(app)
        .post('/api/account')
        .send({
          pubkey: account.pubkey,
          username: account.username,
        })
        .expect(201);

      expect(mockAccountRepository.getByPubkey).toHaveBeenCalledWith(account.pubkey);
      expect(mockAccountRepository.create).toHaveBeenCalledWith({
        id: `account-${account.pubkey}`,
        type: 'account',
        pubkey: account.pubkey,
        tier: 'free',
        subscription: DEFAULT_SUBSCRIPTION,
        expires: undefined,
        username: undefined,
        created: expect.any(Number),
        modified: expect.any(Number), // test sets the same as "created"
      });

      expect(mockPaymentRepository.get).not.toHaveBeenCalled();

      expect(response.body).toEqual({
        pubkey: account.pubkey,
        tier: 'free',
        entitlements: DEFAULT_SUBSCRIPTION.entitlements,
        signupDate: expect.any(Number),
      });
    });

    test('should create new premium account successfully', async () => {
      mockAccountRepository.getByPubkey.mockResolvedValueOnce(null);
      const mockPayment = testPayment({
        pubkey: account.pubkey,
        isPaid: true,
        paid: now(),
      });
      mockPaymentRepository.get.mockResolvedValueOnce(mockPayment)

      const response = await request(app)
        .post('/api/account')
        .send({
          pubkey: account.pubkey,
          username: account.username,
          paymentId: mockPayment.id,
        })
        .expect(201);

      expect(mockAccountRepository.getByPubkey).toHaveBeenCalledWith(account.pubkey);
      expect(mockAccountRepository.create).toHaveBeenCalledWith({
        pubkey: account.pubkey,
        id: `account-${account.pubkey}`,
        type: 'account',
        tier: mockPayment.tier,
        username: account.username,
        subscription: {
          tier: mockPayment.tier,
          billingCycle: mockPayment.billingCycle,
          price: {
            priceCents: mockPayment.priceCents,
            currency: 'USD',
          },
          entitlements: config.tiers['premium'].entitlements,
        },
        expires: expect.any(Number),
        created: expect.any(Number),
        modified: expect.any(Number),
      });

      expect(response.body).toEqual({
        pubkey: account.pubkey,
        username: account.username,
        tier: mockPayment.tier,
        expires: expect.any(Number),
        entitlements: config.tiers['premium'].entitlements,
        signupDate: expect.any(Number),
      });
    });

    test('should return 400 if pubkey is missing', async () => {
      await request(app)
        .post('/api/account')
        .send({ username: 'bla' })
        .expect(400, { error: 'Public key is required' });
    });

    test('should return 400 if username is too short', async () => {
      await request(app).post('/api/account')
        .send({ pubkey: account.pubkey, username: 'oi' })
        .expect(400, { error: 'Username must be at least 3 characters' });
    });
    
    test('should return 400 if username is reserved', async () => {
      await request(app).post('/api/account')
        .send({ pubkey: account.pubkey, username: 'system' })
        .expect(400, { error: 'This username is reserved' });
    });
    
    test('should return 400 if username is not alphanumeric', async () => {
      await request(app).post('/api/account')
        .send({ pubkey: account.pubkey, username: 'Dude🤙' })
        .expect(400, { error: 'Username can only contain letters, numbers, and underscores' });
    });

    test('should return 409 if account already exists', async () => {
      mockAccountRepository.getByPubkey.mockResolvedValueOnce(account);

      await request(app)
        .post('/api/account')
        .send({
          pubkey: account.pubkey,
          username: account.username
        })
        .expect(409);

      expect(mockAccountRepository.getByPubkey).toHaveBeenCalledWith(account.pubkey);
      expect(mockAccountRepository.create).not.toHaveBeenCalled();
    });

    test('should handle server errors gracefully', async () => {
      mockAccountRepository.getByPubkey.mockRejectedValueOnce(new Error('Database error 1'));

      await request(app)
        .post('/api/account')
        .send({
          pubkey: account.pubkey,
          username: account.username
        })
        .expect(500);
    });

    test('should apply rate limits', async () => {
      mockAccountRepository.getByPubkey.mockResolvedValueOnce(null);
      mockAccountRepository.create.mockResolvedValueOnce(account);

      // Make multiple requests quickly
      const requests = Array.from({ length: 20 }, () =>
        request(app)
          .post('/api/account')
          .send({
            pubkey: account.pubkey,
            username: account.username
          })
      );

      const responses = await Promise.all(requests);

      // Some requests should be rate limited
      const hasRateLimited = responses.some((response: Response) => response.status === 429);
      expect(hasRateLimited).toBe(true);
    });
  });

  describe('GET /api/account', () => {
    test('should return 401 if not authenticated', async () => {
      await request(app)
        .get('/api/account')
        .expect(401);
    });

    test('should return account info when authenticated', async () => {
      const testAuth = await generateNIP98();
      account = testAccount({ pubkey: testAuth.pubkey })
      mockAccountRepository.getByPubkey.mockResolvedValueOnce(account);

      const response = await request(app)
        .get('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .expect(200);

      expect(response.body).toEqual({
        pubkey: account.pubkey,
        username: account.username,
        tier: 'free',
        expires: expect.any(Number),
        entitlements: DEFAULT_SUBSCRIPTION.entitlements,
        signupDate: account.created,
      });

      expect(mockAccountRepository.getByPubkey).toHaveBeenCalledWith(testAuth.pubkey);
    });

    test('should return 404 if account not found', async () => {
      // setup auth
      const testAuth = await generateNIP98();
      account = testAccount({ pubkey: testAuth.pubkey })

      // make service return null for a pubkey
      mockAccountRepository.getByPubkey.mockResolvedValueOnce(null);

      await request(app)
        .get('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .expect(404);

      expect(mockAccountRepository.getByPubkey).toHaveBeenCalled();
    });

    test('should handle server errors gracefully', async () => {
      const testAuth = await generateNIP98();
      mockAccountRepository.getByPubkey.mockRejectedValueOnce(new Error('Database error 2'));

      await request(app)
        .get('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .expect(500);
    });
  });

  describe('PUT /api/account', () => {
    let testAuth: NIP98Fixture;

    beforeAll(async () => {
      testAuth = await generateNIP98('PUT');
    })

    test('should return 401 if not authenticated', async () => {
      await request(app)
        .put('/api/account')
        .send({ username: 'testtest' })
        .expect(401);
    });

    test('should update account details when authenticated', async () => {
      const currentAccount = testAccount({ pubkey: testAuth.pubkey });
      const updatedAccount = {
        ...currentAccount,
        username: 'bob',
        modified: now()
      };

      mockAccountRepository.getByPubkey.mockResolvedValueOnce(currentAccount);
      mockAccountRepository.update.mockResolvedValueOnce(updatedAccount);

      const response = await request(app)
        .put('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .send({ username: 'bob' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        pubkey: updatedAccount.pubkey,
        username: updatedAccount.username,
        tier: 'free',
        expires: expect.any(Number),
        entitlements: DEFAULT_SUBSCRIPTION.entitlements,
        signupDate: updatedAccount.created,
      });

      expect(mockAccountRepository.getByPubkey).toHaveBeenCalledWith(testAuth.pubkey);
      expect(mockAccountRepository.update).toHaveBeenCalledWith({
        ...currentAccount,
        username: 'bob',
      });
    });

    test('should now allow to set username which is already taken', async () => {
      const currentAccount = testAccount({ pubkey: testAuth.pubkey });
      mockAccountRepository.update.mockRejectedValueOnce({ message: 'Username is already taken' });
      mockAccountRepository.getByPubkey.mockResolvedValueOnce(currentAccount);

      const response = await request(app)
        .put('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .send({ username: 'bob' });

      expect(response.status).toBe(409);
    });

    test('should keep existing details if updated weren\'t provided', async () => {
      const currentAccount = testAccount({ pubkey: testAuth.pubkey });
      const updatedAccount = {
        ...currentAccount,
        modified: now()
      };

      mockAccountRepository.getByPubkey.mockResolvedValueOnce(currentAccount);
      mockAccountRepository.update.mockResolvedValueOnce(updatedAccount);

      const response = await request(app)
        .put('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .send({})
        .expect(200);

      expect(response.body).toEqual({
        pubkey: updatedAccount.pubkey,
        username: updatedAccount.username,
        tier: 'free',
        expires: expect.any(Number),
        entitlements: DEFAULT_SUBSCRIPTION.entitlements,
        signupDate: updatedAccount.created,
      });

      expect(mockAccountRepository.getByPubkey).toHaveBeenCalledWith(testAuth.pubkey);
      expect(mockAccountRepository.update).toHaveBeenCalledWith(currentAccount);
    });

    test('should return 404 if account not found', async () => {
      mockAccountRepository.getByPubkey.mockResolvedValueOnce(null);

      await request(app)
        .put('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .send({ username: 'bla' })
        .expect(404);

      expect(mockAccountRepository.getByPubkey).toHaveBeenCalledWith(testAuth.pubkey);
      expect(mockAccountRepository.update).not.toHaveBeenCalled();
    });

    test('should handle server errors gracefully', async () => {
      mockAccountRepository.getByPubkey.mockRejectedValueOnce(new Error('Database error 3'));

      await request(app)
        .put('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .send({ username: 'bla' })
        .expect(500);

      expect(mockAccountRepository.getByPubkey).toHaveBeenCalledWith(testAuth.pubkey);
      expect(mockAccountRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/account/list', () => {
    it('should list accounts with valid admin authentication', async () => {
      const testAuth = await generateAdminNIP98();
      const mockAccounts = [testAccount()];
      
      mockAccountRepository.getAllAccounts.mockResolvedValue(mockAccounts);

      const response = await request(app)
        .get('/api/account/list')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(response.status).toEqual(200);
      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBe(1);
      expect(response.body[0]).toHaveProperty('id');
      expect(response.body[0]).toHaveProperty('type');
      expect(response.body[0]).toHaveProperty('pubkey');
      expect(response.body[0]).toHaveProperty('tier');
      expect(response.body[0]).toHaveProperty('subscription');
      expect(response.body[0]).toHaveProperty('created');
      expect(response.body[0]).toHaveProperty('modified');
      expect(response.body[0].type).toBe('account');
      expect(mockAccountRepository.getAllAccounts).toHaveBeenCalledWith(100);
    });

    it('should deny access for non-admin users', async () => {
      const testAuth = await generateNIP98();

      const response = await request(app)
        .get('/api/account/list')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(response.status).toEqual(403);
      expect(response.body.error).toBe('Admin access required');
    });

    it('should require NIP-98 authentication', async () => {
      const response = await request(app)
        .get('/api/account/list');

      expect(response.status).toEqual(401);
      expect(response.body.error).toBe('NIP98 Authorization header required');
    });

    it('should accept custom limit parameter', async () => {
      const testAuth = await generateAdminNIP98();
      const mockAccounts: any[] = [];
      
      mockAccountRepository.getAllAccounts.mockResolvedValue(mockAccounts);

      const response = await request(app)
        .get('/api/account/list?limit=50')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(response.status).toEqual(200);
      expect(mockAccountRepository.getAllAccounts).toHaveBeenCalledWith(50);
    });

    it('should validate limit parameter bounds', async () => {
      const testAuth = await generateAdminNIP98();

      const response = await request(app)
        .get('/api/account/list?limit=2000')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(response.status).toEqual(400);
      expect(response.body.error).toBe('Limit must be between 1 and 1000');
    });

    it('should return 500 when repository fails', async () => {
      const testAuth = await generateAdminNIP98();
      
      mockAccountRepository.getAllAccounts.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/account/list')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(response.status).toEqual(500);
      expect(response.body.error).toBe('Internal server error');
    });

    it('should return accounts with all expected fields', async () => {
      const testAuth = await generateAdminNIP98();
      const mockAccount = testAccount({
        username: 'testuser',
        lastLoginDate: now() - 3600000 // 1 hour ago
      });
      
      mockAccountRepository.getAllAccounts.mockResolvedValue([mockAccount]);

      const response = await request(app)
        .get('/api/account/list')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(response.status).toEqual(200);
      expect(response.body[0]).toEqual({
        id: mockAccount.id,
        type: mockAccount.type,
        pubkey: mockAccount.pubkey,
        username: mockAccount.username,
        tier: mockAccount.tier,
        subscription: mockAccount.subscription,
        expires: mockAccount.expires,
        created: mockAccount.created,
        modified: mockAccount.modified,
        lastLoginDate: mockAccount.lastLoginDate,
      });
    });
  });
});
