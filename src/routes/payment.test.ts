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

jest.mock('../database/paymentRepository');
jest.mock('../database/accountRepository');
jest.mock('../services/LightningService');

import app from '../index';
import paymentRepository from '../database/paymentRepository';
import lightningService from '../services/LightningService';

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
    it('should list payments with valid NIP-98 authentication', async () => {
      const testAuth = await generatePaymentNIP98();
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

    it('should require NIP-98 authentication', async () => {
      const response = await request(app)
        .get('/api/payment');

      expect(response.status).toEqual(401);
      expect(response.body.error).toBe('NIP98 Authorization header required');
    });

    it('should accept custom limit parameter', async () => {
      const testAuth = await generatePaymentNIP98('GET', '/api/payment?limit=50');
      const mockPayments: any[] = [];
      
      mockPaymentRepository.getAllPayments.mockResolvedValue(mockPayments);

      const response = await request(app)
        .get('/api/payment?limit=50')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(response.status).toEqual(200);
      expect(mockPaymentRepository.getAllPayments).toHaveBeenCalledWith(50);
    });

    it('should validate limit parameter bounds', async () => {
      const testAuth = await generatePaymentNIP98('GET', '/api/payment?limit=2000');

      const response = await request(app)
        .get('/api/payment?limit=2000')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(response.status).toEqual(400);
      expect(response.body.error).toBe('Limit must be between 1 and 1000');
    });

    it('should return 500 when repository fails', async () => {
      const testAuth = await generatePaymentNIP98();
      
      mockPaymentRepository.getAllPayments.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/payment')
        .set('Authorization', `Nostr ${testAuth.token}`);

      expect(response.status).toEqual(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });
}); 