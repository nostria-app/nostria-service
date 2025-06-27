import request from 'supertest';

import { Tier, BillingCycle } from '../config/types';

import { generateKeyPair, testPayment } from '../helpers/testHelper';

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

jest.mock('../database/paymentRepositoryCosmosDb');
jest.mock('../database/accountRepositoryCosmosDb');
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
      price: 999,
      billingCycle: 'monthly' as BillingCycle,
      pubkey: generateKeyPair().pubkey,
    };

    it('should create a payment invoice successfully', async () => {
      // Mock LightningService responses
      mockLightningService.getUsdBtcRate.mockResolvedValue(45000);
      mockLightningService.createInvoice.mockResolvedValue({
        serialized: 'lnbc1234567890',
        paymentHash: 'test-hash',
        amountSat: 22200,
      });

      const mockInvoice = testPayment({
        pubkey: validPaymentRequest.pubkey,
        billingCycle: validPaymentRequest.billingCycle,
        priceCents: validPaymentRequest.price,
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
      expect(mockLightningService.createInvoice).toHaveBeenCalledWith(22200, 'test-uuid-id', 'NostriaPremium');
      expect(mockPaymentRepository.create).toHaveBeenCalledWith({
        id: 'test-uuid-id',
        type: 'ln',
        lnHash: 'test-hash',
        lnInvoice: 'lnbc1234567890',
        lnAmountSat: 22200,
        tier: 'premium',
        billingCycle: 'monthly',
        priceCents: 999,
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
      const invalidRequest = { ...validPaymentRequest, pubkey: 'invalid-pubkey' };

      const response = await request(app)
        .post('/api/payment')
        .send(invalidRequest)
        .expect(400);

      expect(response.body.error).toBe('Invalid pubkey format. Must be npub format');
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

  describe('GET /api/payment/:paymentId', () => {
    const mockInvoice = testPayment();

    it('should return 400 when invoice not found', async () => {
      mockPaymentRepository.get.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/payment/non-existing-id')
        .expect(400);

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
        .get('/api/payment/test-id')
        .expect(200);

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
        .get('/api/payment/test-id')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'paid');
      expect(mockPaymentRepository.update).toHaveBeenCalledWith({
        ...mockInvoice,
        isPaid: true,
        paid: expect.any(Number),
        updated: expect.any(Number),
      });
    });

    it('should return unpaid status when payment is not confirmed', async () => {
      mockPaymentRepository.get.mockResolvedValue(mockInvoice);
      mockLightningService.checkPaymentStatus.mockResolvedValue(false);

      const response = await request(app).get('/api/payment/test-id')

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

      const response = await request(app).get('/api/payment/test-id');

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

      const response = await request(app).get('/api/payment/test-id')

      expect(response.status).toEqual(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });
}); 