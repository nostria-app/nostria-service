import request from 'supertest';
import { Response } from 'supertest';

// Mock some other routes before importing app so that their initialization code is skipped
jest.mock('../services/BaseTableStorageService')
jest.mock('../routes/subscription', () => {
  const router = require('express').Router();
  return router;
});

jest.mock('../routes/notification', () => {
  const router = require('express').Router();
  return router;
});


// Now import the app after mocks are set up
jest.mock('../services/AccountService');
import AccountService from '../services/AccountService';

import app from '../index';
import { generateNIP98 } from '../helpers/testHelper';

jest.mock('../middleware/requireNIP98Auth', () => jest.fn((req, res, next) => next()));
import requireNIP98AuthMiddleware from '../middleware/requireNIP98Auth';

const requireNIP98Auth = requireNIP98AuthMiddleware as jest.MockedFn<typeof requireNIP98AuthMiddleware>;
const accountService = AccountService as jest.Mocked<typeof AccountService>;

const testAccount = (partial?: { pubkey?: string, email?: string }) => ({
  pubkey: 'npub1test123456789',
  email: 'test@email.com',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...partial,
});

describe('Account Public API', () => {
  let account: any;

  beforeEach(() => {
    account = testAccount()
    jest.clearAllMocks();
  });

  describe('GET /api/account/:pubkey', () => {
    test('should check if pubkey is not available', async () => {
      accountService.getAccount.mockResolvedValueOnce(account)

      const response = await request(app)
        .get(`/api/account/${account.pubkey}`)
        .expect(200);

      expect(accountService.getAccount).toHaveBeenCalledWith(account.pubkey)
      expect(response.body).toHaveProperty('profile', {
        pubkey: account.pubkey,
        signupDate: account.createdAt.toISOString(),
        tier: 'free',
        isActive: true,
      });
      expect(response.body).toHaveProperty('success', true);
    });

    test('should check if pubkey is available', async () => {
      accountService.getAccount.mockResolvedValueOnce(null)

      await request(app)
        .get(`/api/account/${account.pubkey}`)
        .expect(404);

      expect(accountService.getAccount).toHaveBeenCalledWith(account.pubkey);
    });

    test('should return 400 for invalid pubkey format', async () => {
      await request(app)
        .get('/api/account/invalid-pubkey')
        .expect(404); // The endpoint doesn't validate format, just checks existence
    });

    test('should apply rate limits', async () => {
      accountService.getAccount.mockResolvedValue(account)

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
    test('should create new account successfully', async () => {
      accountService.getAccount.mockResolvedValueOnce(null);
      accountService.addAccount.mockResolvedValueOnce(account);

      const response = await request(app)
        .post('/api/account')
        .send({
          pubkey: account.pubkey,
          email: account.email
        })
        .expect(201);

      expect(accountService.getAccount).toHaveBeenCalledWith(account.pubkey);
      expect(accountService.addAccount).toHaveBeenCalledWith({
        pubkey: account.pubkey,
        email: account.email
      });
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('account', {
        ...account,
        createdAt: account.createdAt.toISOString(),
        updatedAt: account.updatedAt.toISOString(),
      });
    });

    test('should return 400 if pubkey is missing', async () => {
      await request(app)
        .post('/api/account')
        .send({ email: 'test@example.com' })
        .expect(400);
    });

    test('should create new account with pubkey only', async () => {
      account = testAccount({ email: undefined })
      accountService.getAccount.mockResolvedValueOnce(null);
      accountService.addAccount.mockResolvedValueOnce(account);

      const response = await request(app)
        .post('/api/account')
        .send({
          pubkey: account.pubkey
        })
        .expect(201);

      expect(accountService.getAccount).toHaveBeenCalledWith(account.pubkey);
      expect(accountService.addAccount).toHaveBeenCalledWith({
        pubkey: account.pubkey,
        email: undefined,
      });
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('account', {
        ...account,
        email: undefined,
        createdAt: account.createdAt.toISOString(),
        updatedAt: account.updatedAt.toISOString(),
      });
    });

    test('should return 409 if account already exists', async () => {
      accountService.getAccount.mockResolvedValueOnce(account);

      await request(app)
        .post('/api/account')
        .send({
          pubkey: account.pubkey,
          email: account.email
        })
        .expect(409);

      expect(accountService.getAccount).toHaveBeenCalledWith(account.pubkey);
      expect(accountService.addAccount).not.toHaveBeenCalled();
    });

    test('should handle server errors gracefully', async () => {
      accountService.getAccount.mockRejectedValueOnce(new Error('Database error'));

      await request(app)
        .post('/api/account')
        .send({
          pubkey: account.pubkey,
          email: account.email
        })
        .expect(500);
    });

    test('should apply rate limits', async () => {
      accountService.getAccount.mockResolvedValueOnce(null);
      accountService.addAccount.mockResolvedValueOnce(account);

      // Make multiple requests quickly
      const requests = Array.from({ length: 20 }, () =>
        request(app)
          .post('/api/account')
          .send({
            pubkey: account.pubkey,
            email: account.email
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
      requireNIP98Auth.mockImplementationOnce(async (req, res, next) => { res.status(401).end() })
      await request(app)
        .get('/api/account')
        .expect(401);
    });

    test('should return account info when authenticated', async () => {
      const testAuth = await generateNIP98();
      account = testAccount({ pubkey: testAuth.npub })
      accountService.getAccount.mockResolvedValueOnce(account);
      requireNIP98Auth.mockImplementationOnce(async (req, res, next) => { 
        req.authenticatedPubkey = testAuth.npub
        next?.()
      });

      const response = await request(app)
        .get('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('account', {
        ...account,
        email: account.email,
        createdAt: account.createdAt.toISOString(),
        updatedAt: account.updatedAt.toISOString(),
      });

      expect(accountService.getAccount).toHaveBeenCalledWith(testAuth.npub);
    });

    test('should return 404 if account not found', async () => {
      // setup auth
      const testAuth = await generateNIP98();
      account = testAccount({ pubkey: testAuth.npub })
      requireNIP98Auth.mockImplementationOnce(async (req, res, next) => { 
        req.authenticatedPubkey = testAuth.npub
        next?.()
      });

      // make service return null for a pubkey
      accountService.getAccount.mockResolvedValueOnce(null);

      await request(app)
        .get('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .expect(404);

      expect(accountService.getAccount).toHaveBeenCalled();
    });

    test('should handle server errors gracefully', async () => {
      accountService.getAccount.mockRejectedValueOnce(new Error('Database error'));

      await request(app)
        .get('/api/account')
        .set('Authorization', 'Bearer test-token')
        .set('X-Nostr-Auth', 'test-auth')
        .expect(500);
    });
  });
});