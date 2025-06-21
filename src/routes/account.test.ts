import request from 'supertest';
import { Response } from 'supertest';

// Mock some other routes before importing app so that their initialization code is skipped
jest.mock('../database/BaseRepository')
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

import app from '../index';
import { generateNIP98, testAccount, testPayment } from '../helpers/testHelper';
import paymentRepository from '../database/paymentRepository';
import accountRepository from '../database/accountRepository';
import { DEFAULT_SUBSCRIPTION } from '../models/accountSubscription';
import config from '../config';

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
      mockAccountRepository.getByPubKey.mockResolvedValueOnce(account)

      const response = await request(app)
        .get(`/api/account/${account.pubkey}`)
        .expect(200);

      expect(mockAccountRepository.getByPubKey).toHaveBeenCalledWith(account.pubkey)
      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("result", {
        pubkey: account.pubkey,
        signupDate: account.createdAt.toISOString(),
        tier: 'free',
        isActive: true,
      });
    });

    test('should check if pubkey is available', async () => {
      mockAccountRepository.getByPubKey.mockResolvedValueOnce(null)

      const response = await request(app)
        .get(`/api/account/${account.pubkey}`)
        .expect(200);

      expect(response.body).toEqual({
        success: false,
        message: 'User not found'
      });

      expect(mockAccountRepository.getByPubKey).toHaveBeenCalledWith(account.pubkey);
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
        signupDate: account.createdAt.toISOString(),
        tier: 'free',
        isActive: true,
      });
    });

    test('should handle when the user with username is not available', async () => {
      mockAccountRepository.getByUsername.mockResolvedValueOnce(null)

      const response = await request(app)
        .get(`/api/account/${account.username}`)
        .expect(200);

      expect(response.body).toEqual({
        success: false,
        message: 'User not found'
      });
      expect(mockAccountRepository.getByPubKey).not.toHaveBeenCalled()
      expect(mockAccountRepository.getByUsername).toHaveBeenCalledWith(account.username);
    });

    test('should apply rate limits', async () => {
      mockAccountRepository.getByPubKey.mockResolvedValue(account)

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
      mockAccountRepository.getByPubKey.mockResolvedValueOnce(null);

      const response = await request(app)
        .post('/api/account')
        .send({
          pubkey: account.pubkey,
          username: account.username
        })
        .expect(201);

      expect(mockAccountRepository.getByPubKey).toHaveBeenCalledWith(account.pubkey);
      expect(mockAccountRepository.create).toHaveBeenCalledWith({
        pubkey: account.pubkey,
        tier: 'free',
        subscription: JSON.stringify(DEFAULT_SUBSCRIPTION),
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date), // test sets the same as createdAt
      });

      expect(mockPaymentRepository.get).not.toHaveBeenCalled();

      expect(response.body).toEqual({
        pubkey: account.pubkey,
        signupDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/),
      });
    });

    test('should create new premium account successfully', async () => {
      mockAccountRepository.getByPubKey.mockResolvedValueOnce(null);
      const mockPayment = testPayment({
        pubkey: account.pubkey,
        isPaid: true,
        paidAt: new Date(),
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

      expect(mockAccountRepository.getByPubKey).toHaveBeenCalledWith(account.pubkey);
      expect(mockAccountRepository.create).toHaveBeenCalledWith({
        pubkey: account.pubkey,
        tier: mockPayment.tier,
        username: account.username,
        subscription: JSON.stringify({
          tier: mockPayment.tier,
          billingCycle: mockPayment.billingCycle,
          price: {
            priceCents: mockPayment.priceCents,
            currency: 'USD',
          },
          entitlements: config.tiers['premium'].entitlements,
        }),
        expiresAt: expect.any(Date),
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });

      expect(response.body).toEqual({
        pubkey: account.pubkey,
        username: account.username,
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
      mockAccountRepository.getByPubKey.mockResolvedValueOnce(account);

      await request(app)
        .post('/api/account')
        .send({
          pubkey: account.pubkey,
          username: account.username
        })
        .expect(409);

      expect(mockAccountRepository.getByPubKey).toHaveBeenCalledWith(account.pubkey);
      expect(mockAccountRepository.create).not.toHaveBeenCalled();
    });

    test('should handle server errors gracefully', async () => {
      mockAccountRepository.getByPubKey.mockRejectedValueOnce(new Error('Database error 1'));

      await request(app)
        .post('/api/account')
        .send({
          pubkey: account.pubkey,
          username: account.username
        })
        .expect(500);
    });

    test('should apply rate limits', async () => {
      mockAccountRepository.getByPubKey.mockResolvedValueOnce(null);
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
      mockAccountRepository.getByPubKey.mockResolvedValueOnce(account);

      const response = await request(app)
        .get('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .expect(200);

      expect(response.body).toEqual({
        pubkey: account.pubkey,
        username: account.username,
        signupDate: account.createdAt.toISOString(),
      });

      expect(mockAccountRepository.getByPubKey).toHaveBeenCalledWith(testAuth.npub);
    });

    test('should return 404 if account not found', async () => {
      // setup auth
      const testAuth = await generateNIP98();
      account = testAccount({ pubkey: testAuth.npub })

      // make service return null for a pubkey
      mockAccountRepository.getByPubKey.mockResolvedValueOnce(null);

      await request(app)
        .get('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .expect(404);

      expect(mockAccountRepository.getByPubKey).toHaveBeenCalled();
    });

    test('should handle server errors gracefully', async () => {
      const testAuth = await generateNIP98();
      mockAccountRepository.getByPubKey.mockRejectedValueOnce(new Error('Database error 2'));

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
        updatedAt: new Date()
      };

      mockAccountRepository.getByPubKey.mockResolvedValueOnce(currentAccount);
      mockAccountRepository.update.mockResolvedValueOnce(updatedAccount);

      const response = await request(app)
        .put('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .send({ username: 'bob' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        pubkey: updatedAccount.pubkey,
        username: updatedAccount.username,
        signupDate: updatedAccount.createdAt.toISOString(),
      });

      expect(mockAccountRepository.getByPubKey).toHaveBeenCalledWith(testAuth.npub);
      expect(mockAccountRepository.update).toHaveBeenCalledWith({
        ...currentAccount,
        username: 'bob',
      });
    });

    test('should now allow to set username which is already taken', async () => {
      const currentAccount = testAccount({ pubkey: testAuth.npub });
      mockAccountRepository.update.mockRejectedValueOnce({ message: 'Username is already taken' });
      mockAccountRepository.getByPubKey.mockResolvedValueOnce(currentAccount);

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
        updatedAt: new Date()
      };

      mockAccountRepository.getByPubKey.mockResolvedValueOnce(currentAccount);
      mockAccountRepository.update.mockResolvedValueOnce(updatedAccount);

      const response = await request(app)
        .put('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .send({})
        .expect(200);

      expect(response.body).toEqual({
        pubkey: updatedAccount.pubkey,
        username: updatedAccount.username,
        signupDate: updatedAccount.createdAt.toISOString(),
      });

      expect(mockAccountRepository.getByPubKey).toHaveBeenCalledWith(testAuth.npub);
      expect(mockAccountRepository.update).toHaveBeenCalledWith(currentAccount);
    });

    test('should return 404 if account not found', async () => {
      mockAccountRepository.getByPubKey.mockResolvedValueOnce(null);

      await request(app)
        .put('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .send({ username: 'bla' })
        .expect(404);

      expect(mockAccountRepository.getByPubKey).toHaveBeenCalledWith(testAuth.npub);
      expect(mockAccountRepository.update).not.toHaveBeenCalled();
    });

    test('should handle server errors gracefully', async () => {
      mockAccountRepository.getByPubKey.mockRejectedValueOnce(new Error('Database error 3'));

      await request(app)
        .put('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .send({ username: 'bla' })
        .expect(500);

      expect(mockAccountRepository.getByPubKey).toHaveBeenCalledWith(testAuth.npub);
      expect(mockAccountRepository.update).not.toHaveBeenCalled();
    });
  });
});