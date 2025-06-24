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
jest.mock('../database/accountRepositoryCosmosDb');
jest.mock('../database/paymentRepositoryCosmosDb');

import app from '../index';
import { generateNIP98, testAccount, testPayment } from '../helpers/testHelper';

import paymentRepository from '../database/paymentRepositoryCosmosDb';
import accountRepository from '../database/accountRepositoryCosmosDb';
import { DEFAULT_SUBSCRIPTION, expiresAt } from '../models/accountSubscription';

import config from '../config';
import { now } from '../helpers/now';

const mockPaymentRepository = paymentRepository as jest.Mocked<typeof paymentRepository>;
const mockAccountRepository = accountRepository as jest.Mocked<typeof accountRepository>;

describe('Account API', () => {
  let account: any;

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

        isActive: true,
      });
    });

    // test('should return proper tier', async () => {
    //   mockAccountRepository.getByPubKey.mockResolvedValueOnce(testAccount({
    //     tier: 'premium',
    //   }))
    //   const response = await request(app).get(`/api/account/${account.pubkey}`)
    //   expect(response.body.result).toHaveProperty("tier", 'premium');
    // });

    // test('should return isActive true if subscription is not expired', async () => {
    //   mockAccountRepository.getByPubKey.mockResolvedValueOnce(testAccount({
    //     expires: Date.now() + 1000
    //   }))
    //   const response = await request(app).get(`/api/account/${account.pubkey}`)
    //   expect(response.body.result).toHaveProperty("isActive", true);
    // });

    // test('should return isActive false if subscription expired', async () => {
    //   mockAccountRepository.getByPubKey.mockResolvedValueOnce(testAccount({
    //     expires: Date.now() - 100
    //   }))
    //   const response = await request(app).get(`/api/account/${account.pubkey}`)
    //   expect(response.body.result).toHaveProperty("isActive", false);
    // });

    // test('should return success false if user does not exist for the pubkey', async () => {
    //   mockAccountRepository.getByPubKey.mockResolvedValueOnce(null)

    //   const response = await request(app)
    //     .get(`/api/account/${account.pubkey}`)
    //     .expect(200);

    //   expect(response.body).toEqual({
    //     success: false,
    //     message: 'User not found'
    //   });

    //   expect(mockAccountRepository.getByPubkey).toHaveBeenCalledWith(account.pubkey);
    // });

    test('should return existing user by username', async () => {
      mockAccountRepository.getByUsername.mockResolvedValueOnce(account)

      const response = await request(app)
        .get(`/api/account/${account.username}`)
        .expect(200);

      expect(mockAccountRepository.getByUsername).toHaveBeenCalledWith(account.username)
      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("result", {
        pubkey: account.pubkey,
        signupDate: account.createdAt.toISOString(),
        tier: account.tier,
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
          username: account.username
        })
        .expect(201);

      expect(mockAccountRepository.getByPubkey).toHaveBeenCalledWith(account.pubkey);
      expect(mockAccountRepository.create).toHaveBeenCalledWith({
        pubkey: account.pubkey,
        tier: 'free',
        subscription: DEFAULT_SUBSCRIPTION,
        expires: undefined,
        created: expect.any(Number),
        updated: expect.any(Number), // test sets the same as createdAt
      });

      expect(mockPaymentRepository.get).not.toHaveBeenCalled();

      expect(response.body).toEqual({
        pubkey: account.pubkey,
        tier: 'free',
        entitlements: DEFAULT_SUBSCRIPTION.entitlements,
        signupDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/),
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
        updated: expect.any(Number),
      });

      expect(response.body).toEqual({
        pubkey: account.pubkey,
        username: account.username,
        tier: mockPayment.tier,
        expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/),
        entitlements: config.tiers['premium'].entitlements,
        signupDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/),
      });
    });

    test('should return 400 if pubkey is missing', async () => {
      await request(app)
        .post('/api/account')
        .send({ username: 'bla' })
        .expect(400);
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
      account = testAccount({ pubkey: testAuth.npub })
      mockAccountRepository.getByPubkey.mockResolvedValueOnce(account);

      const response = await request(app)
        .get('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .expect(200);

      expect(response.body).toEqual({
        pubkey: account.pubkey,
        username: account.username,
        tier: 'free',
        expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/),
        entitlements: DEFAULT_SUBSCRIPTION.entitlements,
        signupDate: account.created,
      });

      expect(mockAccountRepository.getByPubkey).toHaveBeenCalledWith(testAuth.npub);
    });

    test('should return 404 if account not found', async () => {
      // setup auth
      const testAuth = await generateNIP98();
      account = testAccount({ pubkey: testAuth.npub })

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
    let testAuth: any;

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
      const currentAccount = testAccount({ pubkey: testAuth.npub });
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
        expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/),
        entitlements: DEFAULT_SUBSCRIPTION.entitlements,
        signupDate: updatedAccount.created,
      });

      expect(mockAccountRepository.getByPubkey).toHaveBeenCalledWith(testAuth.npub);
      expect(mockAccountRepository.update).toHaveBeenCalledWith({
        ...currentAccount,
        username: 'bob',
      });
    });

    test('should now allow to set username which is already taken', async () => {
      const currentAccount = testAccount({ pubkey: testAuth.npub });
      mockAccountRepository.update.mockRejectedValueOnce({ message: 'Username is already taken' });
      mockAccountRepository.getByPubkey.mockResolvedValueOnce(currentAccount);

      const response = await request(app)
        .put('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .send({ username: 'bob' });

      expect(response.status).toBe(409);
    });

    test('should keep existing details if updated weren\'t provided', async () => {
      const currentAccount = testAccount({ pubkey: testAuth.npub });
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
        expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/),
        entitlements: DEFAULT_SUBSCRIPTION.entitlements,
        signupDate: updatedAccount.created,
      });

      expect(mockAccountRepository.getByPubkey).toHaveBeenCalledWith(testAuth.npub);
      expect(mockAccountRepository.update).toHaveBeenCalledWith(currentAccount);
    });

    test('should return 404 if account not found', async () => {
      mockAccountRepository.getByPubkey.mockResolvedValueOnce(null);

      await request(app)
        .put('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .send({ username: 'bla' })
        .expect(404);

      expect(mockAccountRepository.getByPubkey).toHaveBeenCalledWith(testAuth.npub);
      expect(mockAccountRepository.update).not.toHaveBeenCalled();
    });

    test('should handle server errors gracefully', async () => {
      mockAccountRepository.getByPubkey.mockRejectedValueOnce(new Error('Database error 3'));

      await request(app)
        .put('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .send({ username: 'bla' })
        .expect(500);

      expect(mockAccountRepository.getByPubkey).toHaveBeenCalledWith(testAuth.npub);
      expect(mockAccountRepository.update).not.toHaveBeenCalled();
    });
  });
});
