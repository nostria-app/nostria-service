import request from 'supertest';

import { Tier, BillingCycle } from '../config/types';

import { generateKeyPair, testPayment, NIP98Fixture } from '../helpers/testHelper';
import { finalizeEvent, nip98 } from 'nostr-tools';

// Helper function to generate NIP-98 token for payment routes
const generatePaymentNIP98 = async (method = 'GET', url = '/api/payment'): Promise<NIP98Fixture> => {
  const keyPair = generateKeyPair()
  const token = await nip98.getToken(`http://localhost:3000${url}`, method, e => finalizeEvent(e, keyPair.privateKey))
  return {
    ...keyPair,
    token,
  };
};

// Helper function to generate admin NIP-98 token for payment routes
const generateAdminPaymentNIP98 = async (method = 'GET', url = '/api/payment'): Promise<NIP98Fixture> => {
  const keyPair = generateKeyPair();
  // Use the admin pubkey from mocked config
  keyPair.pubkey = 'test_admin_payment_pubkey';
  const token = await nip98.getToken(`http://localhost:3000${url}`, method, e => finalizeEvent(e, keyPair.privateKey));
  return {
    ...keyPair,
    token,
  };
};

// Mock the services
// Mock removed - BaseRepository no longer exists
jest.mock('../routes/subscription', () => {
  const router = require('express').Router();
  return router;
});

jest.mock('../routes/notification', () => {
  const router = require('express').Router();
  return router;
});

jest.mock('../database/PrismaPaymentRepository', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    getAllPayments: jest.fn(),
    getPaymentsByPubkey: jest.fn(),
  }))
}));

jest.mock('../database/PrismaAccountRepository', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    getByPubkey: jest.fn(),
    getByUsername: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    getAllAccounts: jest.fn(),
  }))
}));

jest.mock('../services/LightningService');

// Mock config for admin authentication
jest.mock('../config', () => ({
  admin: {
    pubkeys: ['test_admin_payment_pubkey']
  },
  tiers: {
    free: {
      tier: 'free',
      name: 'Free',
      entitlements: {
        notificationsPerDay: 5,
        features: ['BASIC_WEBPUSH', 'COMMUNITY_SUPPORT']
      }
    },
    premium: {
      tier: 'premium',
      name: 'Premium',
      pricing: {
        monthly: { priceCents: 1000, currency: 'USD' },
        quarterly: { priceCents: 2700, currency: 'USD' },
        yearly: { priceCents: 9600, currency: 'USD' },
      },
      entitlements: {
        notificationsPerDay: 50,
        features: ['USERNAME', 'ADVANCED_FILTERING', 'PRIORITY_SUPPORT']
      }
    },
    premium_plus: {
      tier: 'premium_plus',
      name: 'Premium Plus',
      pricing: {
        monthly: { priceCents: 2500, currency: 'USD' },
        quarterly: { priceCents: 6700, currency: 'USD' },
        yearly: { priceCents: 24000, currency: 'USD' },
      },
      entitlements: {
        notificationsPerDay: 500,
        features: ['USERNAME', 'ADVANCED_FILTERING', 'PRIORITY_SUPPORT', 'API_ACCESS']
      }
    }
  }
}));

import app from '../index';
import RepositoryFactory from '../database/RepositoryFactory';
import lightningService from '../services/LightningService';

const paymentRepository = RepositoryFactory.getPaymentRepository();

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-id'),
}));
import { v4 } from 'uuid';

const mockPaymentRepository = paymentRepository as jest.Mocked<typeof paymentRepository>;
const mockLightningService = lightningService as jest.Mocked<typeof lightningService>;



describe('Payment Routes', () => {

  beforeEach(() => {
    jest.resetAllMocks();
    (v4 as any).mockImplementation(() => 'test-uuid-id')
  });

  describe('POST /api/payment', () => {
    const validPaymentRequest = {
      tierName: 'premium' as Tier,
      billingCycle: 'monthly' as BillingCycle,
      pubkey: generateKeyPair().pubkey,
    };

    it('should create a payment invoice successfully', async () => {
      // Mock LightningService responses
      mockLightningService.getUsdBtcRate.mockResolvedValue(45000);
      mockLightningService.createInvoice.mockResolvedValue({
        serialized: 'lnbc1234567890',
        paymentHash: 'test-hash',
        amountSat: 22222,
      });

      const mockInvoice = testPayment({
        pubkey: validPaymentRequest.pubkey,
        billingCycle: validPaymentRequest.billingCycle,
        tier: validPaymentRequest.tierName,
      });

      // Mock payment service
      mockPaymentRepository.create.mockResolvedValue(mockInvoice);

      const response = await request(app)
        .post('/api/payment')
        .send(validPaymentRequest)
        .expect(200);

      expect(response.body).toEqual({
        id: 'test-uuid-id',
        status: 'pending',
        lnInvoice: 'lnbc1234567890',
        expires: mockInvoice.expires
      });

      expect(mockLightningService.getUsdBtcRate).toHaveBeenCalled();
      expect(mockLightningService.createInvoice).toHaveBeenCalledWith(22222, 'test-uuid-id', 'NostriaPremium');
      expect(mockPaymentRepository.create).toHaveBeenCalledWith({
        id: `payment-${mockInvoice.id}`,
        type: 'payment',
        paymentType: 'ln',
        lnHash: 'test-hash',
        lnInvoice: 'lnbc1234567890',
        lnAmountSat: 22222,
        tier: 'premium',
        billingCycle: 'monthly',
        priceCents: 1000,
        pubkey: mockInvoice.pubkey,
        isPaid: false,
        created: expect.any(Number),
        modified: expect.any(Number),
        expires: expect.any(Number),
      });
    });

    it('should return 400 for invalid tier name', async () => {
      const invalidRequest = { ...validPaymentRequest, tierName: 'invalid' as Tier };

      const response = await request(app)
        .post('/api/payment')
        .send(invalidRequest)
        .expect(400);

      expect(response.body.error).toBe('Invalid tier name');
    });

    it('should return 400 for invalid billing cycle', async () => {
      const invalidRequest = { ...validPaymentRequest, billingCycle: 'invalid' as BillingCycle };

      const response = await request(app)
        .post('/api/payment')
        .send(invalidRequest)
        .expect(400);

      expect(response.body.error).toBe('Invalid billing cycle');
    });

    it('should return 400 for invalid pubkey format', async () => {
      const invalidRequest = { ...validPaymentRequest, pubkey: 'npub12rv5lskctqxxs2c8rf2zlzc7xx3qpvzs3w4etgemauy9thegr43sf485vg' };

      const response = await request(app)
        .post('/api/payment')
        .send(invalidRequest)
        .expect(400);

      expect(response.body.error).toBe('Invalid pubkey format. Must be hex format');
    });

    it('should return 500 when external price API fails', async () => {
      mockLightningService.getUsdBtcRate.mockRejectedValue(new Error('Internal Server Error'));

      const response = await request(app)
        .post('/api/payment')
        .send(validPaymentRequest)
        .expect(500);

      expect(response.body.error).toBe('Internal server error');
    });

    it('should return 500 when external invoice API fails', async () => {
      mockLightningService.getUsdBtcRate.mockResolvedValue(45000);
      mockLightningService.createInvoice.mockRejectedValue(new Error('Internal Server Error'));

      const response = await request(app)
        .post('/api/payment')
        .send(validPaymentRequest)
        .expect(500);

      expect(response.body.error).toBe('Internal server error');
    });
  });

  describe('GET /api/payment/:pubkey/:paymentId', () => {
    const mockInvoice = testPayment();

    it('should return 400 when invoice not found', async () => {
      mockPaymentRepository.get.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/payment/som-pubkey/non-existing-id')
        .expect(404);

      expect(mockPaymentRepository.get).toHaveBeenCalledWith('non-existing-id', 'som-pubkey');
      expect(response.body.error).toBe('Payment Record not found');
    });

    it('should return paid status when invoice is already marked as paid', async () => {
      const paidInvoice = {
        ...mockInvoice,
        isPaid: true,
        paid: 1750259805325 // 2025-06-18T15:16:45.325Z
      };
      mockPaymentRepository.get.mockResolvedValue(paidInvoice);

      const response = await request(app)
        .get(`/api/payment/${paidInvoice.pubkey}/${paidInvoice.id}`)
        .expect(200);

      expect(mockPaymentRepository.get).toHaveBeenCalledWith(paidInvoice.id, paidInvoice.pubkey);
      expect(mockLightningService.checkPaymentStatus).not.toHaveBeenCalled();
      expect(response.body).toEqual({
        id: mockInvoice.id,
        status: 'paid',
        lnInvoice: 'lnbc1234567890',
        expires: mockInvoice.expires
      });
    });

    it('should mark invoice as paid when payment is confirmed', async () => {
      mockPaymentRepository.get.mockResolvedValue(mockInvoice);

      // Mock LightningService payment status check
      mockLightningService.checkPaymentStatus.mockResolvedValue(true);

      const response = await request(app)
        .get(`/api/payment/${mockInvoice.pubkey}/${mockInvoice.id}`)
        .expect(200);

      expect(response.body).toHaveProperty('status', 'paid');
      expect(mockPaymentRepository.update).toHaveBeenCalledWith({
        ...mockInvoice,
        isPaid: true,
        paid: expect.any(Number),
        modified: expect.any(Number),
      });
    });

    it('should return unpaid status when payment is not confirmed', async () => {
      mockPaymentRepository.get.mockResolvedValue(mockInvoice);
      mockLightningService.checkPaymentStatus.mockResolvedValue(false);

      const response = await request(app)
      .get(`/api/payment/${mockInvoice.pubkey}/${mockInvoice.id}`);

      expect(response.status).toEqual(200);
      expect(mockLightningService.checkPaymentStatus).toHaveBeenCalledTimes(1);
      expect(response.body).toEqual({
        id: mockInvoice.id,
        status: 'pending',
        lnInvoice: 'lnbc1234567890',
        expires: mockInvoice.expires
      });
    });

    it('should return expired status when payment is expired', async () => {
      const expiredInvoice = {
        ...mockInvoice,
        expires: Date.now() - 15 * 60 * 1000 // 15 minutes ago
      }
      mockPaymentRepository.get.mockResolvedValue(expiredInvoice);
      mockLightningService.checkPaymentStatus.mockResolvedValue(false);

      const response = await request(app)
        .get(`/api/payment/${mockInvoice.pubkey}/${mockInvoice.id}`);

      expect(response.status).toEqual(200);
      expect(mockLightningService.checkPaymentStatus).not.toHaveBeenCalled();
      expect(response.body).toEqual({
        id: expiredInvoice.id,
        status: 'expired',
        lnInvoice: 'lnbc1234567890',
        expires: expiredInvoice.expires
      });
    });

    it('should return 500 when external payment status API fails', async () => {
      mockPaymentRepository.get.mockResolvedValue(mockInvoice);
      mockLightningService.checkPaymentStatus.mockRejectedValue(new Error('Internal Server Error'));

      const response = await request(app)
        .get(`/api/payment/${mockInvoice.pubkey}/${mockInvoice.id}`);

      expect(response.status).toEqual(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });

  describe('GET /api/payment', () => {
    it('should list payments with valid admin authentication', async () => {
      const testAuth = await generateAdminPaymentNIP98();
      const mockPayments = [testPayment()];
      
      mockPaymentRepository.getAllPayments.mockResolvedValue(mockPayments);

      const response = await request(app)
        .get('/api/payment')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(response.status).toEqual(200);
      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBe(1);
      expect(response.body[0]).toHaveProperty('id');
      expect(response.body[0]).toHaveProperty('lnInvoice');
      expect(response.body[0]).toHaveProperty('status');
      expect(response.body[0]).toHaveProperty('expires');
      expect(mockPaymentRepository.getAllPayments).toHaveBeenCalledWith(100);
    });

    it('should deny access for non-admin users', async () => {
      const testAuth = await generatePaymentNIP98();

      const response = await request(app)
        .get('/api/payment')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(response.status).toEqual(403);
      expect(response.body.error).toBe('Admin access required');
    });

    it('should require NIP-98 authentication', async () => {
      const response = await request(app)
        .get('/api/payment');

      expect(response.status).toEqual(401);
      expect(response.body.error).toBe('NIP98 Authorization header required');
    });

    it('should accept custom limit parameter', async () => {
      const testAuth = await generateAdminPaymentNIP98('GET', '/api/payment?limit=50');
      const mockPayments: any[] = [];
      
      mockPaymentRepository.getAllPayments.mockResolvedValue(mockPayments);

      const response = await request(app)
        .get('/api/payment?limit=50')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(response.status).toEqual(200);
      expect(mockPaymentRepository.getAllPayments).toHaveBeenCalledWith(50);
    });

    it('should validate limit parameter bounds', async () => {
      const testAuth = await generateAdminPaymentNIP98('GET', '/api/payment?limit=2000');

      const response = await request(app)
        .get('/api/payment?limit=2000')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(response.status).toEqual(400);
      expect(response.body.error).toBe('Limit must be between 1 and 1000');
    });

    it('should return 500 when repository fails', async () => {
      const testAuth = await generateAdminPaymentNIP98();
      
      mockPaymentRepository.getAllPayments.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/payment')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(response.status).toEqual(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });

  describe('GET /api/payment/history', () => {
    it('should return 401 when not authenticated', async () => {
      const response = await request(app)
        .get('/api/payment/history');

      expect(response.status).toEqual(401);
    });

    it('should return payment history for authenticated user', async () => {
      const testAuth = await generatePaymentNIP98('GET', '/api/payment/history');
      const paidTimestamp = Date.now() - 1000;
      const mockPayments = [
        testPayment({
          pubkey: testAuth.pubkey,
          isPaid: true,
          paid: paidTimestamp,
          tier: 'premium',
        }),
        testPayment({
          pubkey: testAuth.pubkey,
          isPaid: false,
          expires: Date.now() + 1000000, // not expired
        }),
      ];

      mockPaymentRepository.getPaymentsByPubkey.mockResolvedValue(mockPayments);

      const response = await request(app)
        .get('/api/payment/history')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(response.status).toEqual(200);
      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBe(2);
      
      // First payment is paid
      expect(response.body[0]).toHaveProperty('id');
      expect(response.body[0]).toHaveProperty('tier', 'premium');
      expect(response.body[0]).toHaveProperty('status', 'paid');
      expect(response.body[0]).toHaveProperty('paid', paidTimestamp);
      
      // Second payment is pending
      expect(response.body[1]).toHaveProperty('status', 'pending');
      
      expect(mockPaymentRepository.getPaymentsByPubkey).toHaveBeenCalledWith(testAuth.pubkey, 50);
    });

    it('should correctly identify expired payments', async () => {
      const testAuth = await generatePaymentNIP98('GET', '/api/payment/history');
      const mockPayments = [
        testPayment({
          pubkey: testAuth.pubkey,
          isPaid: false,
          expires: Date.now() - 1000, // expired
        }),
      ];

      mockPaymentRepository.getPaymentsByPubkey.mockResolvedValue(mockPayments);

      const response = await request(app)
        .get('/api/payment/history')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(response.status).toEqual(200);
      expect(response.body[0]).toHaveProperty('status', 'expired');
    });

    it('should return empty array when no payments exist', async () => {
      const testAuth = await generatePaymentNIP98('GET', '/api/payment/history');
      mockPaymentRepository.getPaymentsByPubkey.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/payment/history')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(response.status).toEqual(200);
      expect(response.body).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      const testAuth = await generatePaymentNIP98('GET', '/api/payment/history?limit=25');
      mockPaymentRepository.getPaymentsByPubkey.mockResolvedValue([]);

      await request(app)
        .get('/api/payment/history?limit=25')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(mockPaymentRepository.getPaymentsByPubkey).toHaveBeenCalledWith(testAuth.pubkey, 25);
    });

    it('should cap limit at 100', async () => {
      const testAuth = await generatePaymentNIP98('GET', '/api/payment/history?limit=500');
      mockPaymentRepository.getPaymentsByPubkey.mockResolvedValue([]);

      await request(app)
        .get('/api/payment/history?limit=500')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(mockPaymentRepository.getPaymentsByPubkey).toHaveBeenCalledWith(testAuth.pubkey, 100);
    });

    it('should return 500 when repository fails', async () => {
      const testAuth = await generatePaymentNIP98('GET', '/api/payment/history');
      mockPaymentRepository.getPaymentsByPubkey.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/payment/history')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(response.status).toEqual(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });
});