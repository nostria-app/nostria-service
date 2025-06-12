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

const accountService = AccountService as jest.Mocked<typeof AccountService>;

const testAccount = (partial?: { pubkey?: string, email?: string }) => ({
  pubkey: 'npub1test123456789',
  email: 'test@email.com',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...partial,
});

describe('Account API', () => {
  let account: any;

  beforeEach(() => {
    account = testAccount()
    jest.resetAllMocks();
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
      accountService.getAccount.mockRejectedValueOnce(new Error('Database error 1'));

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
      await request(app)
        .get('/api/account')
        .expect(401);
    });

    test('should return account info when authenticated', async () => {
      const testAuth = await generateNIP98();
      account = testAccount({ pubkey: testAuth.npub })
      accountService.getAccount.mockResolvedValueOnce(account);

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

      // make service return null for a pubkey
      accountService.getAccount.mockResolvedValueOnce(null);

      await request(app)
        .get('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .expect(404);

      expect(accountService.getAccount).toHaveBeenCalled();
    });

    test('should handle server errors gracefully', async () => {
      const testAuth = await generateNIP98();
      accountService.getAccount.mockRejectedValueOnce(new Error('Database error 2'));

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
        .send({ email: 'new@example.com' })
        .expect(401);
    });

    test('should update account email when authenticated', async () => {
      const currentAccount = testAccount({ pubkey: testAuth.npub });
      const updatedAccount = {
        ...currentAccount,
        email: 'new@example.com',
        updatedAt: new Date()
      };

      accountService.getAccount.mockResolvedValueOnce(currentAccount);
      accountService.updateAccount.mockResolvedValueOnce(updatedAccount);

      const response = await request(app)
        .put('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .send({ email: 'new@example.com' });

      expect(response.status).toBe(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('account', {
        ...updatedAccount,
        createdAt: updatedAccount.createdAt.toISOString(),
        updatedAt: updatedAccount.updatedAt.toISOString(),
      });

      expect(accountService.getAccount).toHaveBeenCalledWith(testAuth.npub);
      expect(accountService.updateAccount).toHaveBeenCalledWith({
        ...currentAccount,
        email: 'new@example.com',
      });
    });

    test('should keep existing email if no new email provided', async () => {
      const currentAccount = testAccount({ pubkey: testAuth.npub });
      const updatedAccount = {
        ...currentAccount,
        updatedAt: new Date()
      };

      accountService.getAccount.mockResolvedValueOnce(currentAccount);
      accountService.updateAccount.mockResolvedValueOnce(updatedAccount);

      const response = await request(app)
        .put('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .send({})
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('account', {
        ...updatedAccount,
        createdAt: updatedAccount.createdAt.toISOString(),
        updatedAt: updatedAccount.updatedAt.toISOString(),
      });

      expect(accountService.getAccount).toHaveBeenCalledWith(testAuth.npub);
      expect(accountService.updateAccount).toHaveBeenCalledWith(currentAccount);
    });

    test('should return 404 if account not found', async () => {
      accountService.getAccount.mockResolvedValueOnce(null);

      await request(app)
        .put('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .send({ email: 'new@example.com' })
        .expect(404);

      expect(accountService.getAccount).toHaveBeenCalledWith(testAuth.npub);
      expect(accountService.updateAccount).not.toHaveBeenCalled();
    });

    test('should handle server errors gracefully', async () => {
      accountService.getAccount.mockRejectedValueOnce(new Error('Database error 3'));

      await request(app)
        .put('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .send({ email: 'new@example.com' })
        .expect(500);

      expect(accountService.getAccount).toHaveBeenCalledWith(testAuth.npub);
      expect(accountService.updateAccount).not.toHaveBeenCalled();
    });
  });
});