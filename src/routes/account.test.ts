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
import { generateNIP98, testAccount } from '../helpers/testHelper';

const accountService = AccountService as jest.Mocked<typeof AccountService>;

describe('Account API', () => {
  let account: any;

  beforeEach(() => {
    account = testAccount()
    jest.resetAllMocks();
  });

  describe('GET /api/account/:pubkeyOrUsername', () => {
    test('should check if pubkey is not available', async () => {
      accountService.getAccount.mockResolvedValueOnce(account)

      const response = await request(app)
        .get(`/api/account/${account.pubkey}`)
        .expect(200);

      expect(accountService.getAccount).toHaveBeenCalledWith(account.pubkey)
      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("result", {
        pubkey: account.pubkey,
        signupDate: account.createdAt.toISOString(),
        tier: 'free',
        isActive: true,
      });
    });

    test('should check if pubkey is available', async () => {
      accountService.getAccount.mockResolvedValueOnce(null)

      const response = await request(app)
        .get(`/api/account/${account.pubkey}`)
        .expect(200);

      expect(response.body).toEqual({
        success: false,
        message: 'User not found'
      });

      expect(accountService.getAccount).toHaveBeenCalledWith(account.pubkey);
    });

    test('should return existing user by username', async () => {
      accountService.getAccountByUsername.mockResolvedValueOnce(account)

      const response = await request(app)
        .get(`/api/account/${account.username}`)
        .expect(200);

      expect(accountService.getAccountByUsername).toHaveBeenCalledWith(account.username)
      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("result", {
        pubkey: account.pubkey,
        signupDate: account.createdAt.toISOString(),
        tier: 'free',
        isActive: true,
      });
    });

    test('should handle when the user with username is not available', async () => {
      accountService.getAccountByUsername.mockResolvedValueOnce(null)

      const response = await request(app)
        .get(`/api/account/${account.username}`)
        .expect(200);

      expect(response.body).toEqual({
        success: false,
        message: 'User not found'
      });
      expect(accountService.getAccount).not.toHaveBeenCalled()
      expect(accountService.getAccountByUsername).toHaveBeenCalledWith(account.username);
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
      accountService.addAccount.mockResolvedValueOnce({
        pubkey: account.pubkey,
        email: account.email,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

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
      expect(response.body).toEqual({
        email: account.email,
        pubkey: account.pubkey,
        signupDate: account.createdAt.toISOString(),
      });
    });

    test('should return 400 if pubkey is missing', async () => {
      await request(app)
        .post('/api/account')
        .send({ email: 'test@example.com' })
        .expect(400);
    });

    test('should create new account with pubkey only', async () => {
      account = testAccount({ username: undefined, email: undefined })
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
      expect(response.body).toEqual({
        email: account.email,
        pubkey: account.pubkey,
        signupDate: account.createdAt.toISOString(),
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

      expect(response.body).toEqual({
        pubkey: account.pubkey,
        username: account.username,
        email: account.email,
        signupDate: account.createdAt.toISOString(),
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

    test('should update account details when authenticated', async () => {
      const currentAccount = testAccount({ pubkey: testAuth.npub });
      const updatedAccount = {
        ...currentAccount,
        email: 'new@example.com',
        username: 'bob',
        updatedAt: new Date()
      };

      accountService.getAccount.mockResolvedValueOnce(currentAccount);
      accountService.updateAccount.mockResolvedValueOnce(updatedAccount);

      const response = await request(app)
        .put('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .send({ email: 'new@example.com', username: 'bob' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        pubkey: updatedAccount.pubkey,
        username: updatedAccount.username,
        email: updatedAccount.email,
        signupDate: updatedAccount.createdAt.toISOString(),
      });

      expect(accountService.getAccount).toHaveBeenCalledWith(testAuth.npub);
      expect(accountService.updateAccount).toHaveBeenCalledWith({
        ...currentAccount,
        username: 'bob',
        email: 'new@example.com',
      });
    });

    test('should now allow to set username which is already taken', async () => {
      const currentAccount = testAccount({ pubkey: testAuth.npub });
      accountService.updateAccount.mockRejectedValueOnce({ message: 'Username is already taken' });
      accountService.getAccount.mockResolvedValueOnce(currentAccount);

      const response = await request(app)
        .put('/api/account')
        .set('Authorization', `Nostr ${testAuth.token}`)
        .send({ email: 'new@example.com', username: 'bob' });

      expect(response.status).toBe(409);
    });

    test('should keep existing details if updated weren\'t provided', async () => {
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

      expect(response.body).toEqual({
        pubkey: updatedAccount.pubkey,
        username: updatedAccount.username,
        email: updatedAccount.email,
        signupDate: updatedAccount.createdAt.toISOString(),
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