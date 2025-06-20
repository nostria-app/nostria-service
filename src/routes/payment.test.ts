import request from 'supertest';

import { Tier, BillingCycle } from '../config/types';

// Mock the services
jest.mock('../services/BaseTableStorageService')
jest.mock('../routes/subscription', () => {
  const router = require('express').Router();
  return router;
});

jest.mock('../routes/notification', () => {
  const router = require('express').Router();
  return router;
});

jest.mock('../services/PaymentService');
jest.mock('../services/AccountService');
jest.mock('../services/LightningService');

import app from '../index';
import paymentService from '../services/PaymentService';
import accountService from '../services/AccountService';
import lightningService from '../services/LightningService';

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-id'),
}));

const mockPaymentService = paymentService as jest.Mocked<typeof paymentService>;
const mockAccountService = accountService as jest.Mocked<typeof accountService>;
const mockLightningService = lightningService as jest.Mocked<typeof lightningService>;

import { v4 } from 'uuid';
import config from '../config';


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
      pubkey: 'npub1234567890',
      username: 'testuser',
    };

    it('should create a payment invoice successfully', async () => {
      // Mock LightningService responses
      mockLightningService.getUsdBtcRate.mockResolvedValue(45000);
      mockLightningService.createInvoice.mockResolvedValue({
        serialized: 'lnbc1234567890',
        paymentHash: 'test-hash',
        amountSat: 22200,
      });

      const mockInvoice = {
        id: 'test-uuid-id',
        hash: 'test-hash',
        invoice: 'lnbc1234567890',
        amountSat: 22200,
        tier: 'premium' as Tier,
        billingCycle: 'monthly' as BillingCycle,
        priceCents: 999,
        pubkey: 'npub1234567890',
        username: 'testuser',
        isPaid: false,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 5000),
      }

      // Mock payment service
      mockPaymentService.createInvoice.mockResolvedValue(mockInvoice);

      const response = await request(app)
        .post('/api/payment')
        .send(validPaymentRequest)
        .expect(200);

      expect(response.body).toEqual({
        id: 'test-uuid-id',
        hash: 'test-hash',
        amountSat: 22200,
        status: 'pending',
        invoice: 'lnbc1234567890',
        expiresAt: mockInvoice.expiresAt.toISOString()
      });

      expect(mockLightningService.getUsdBtcRate).toHaveBeenCalled();
      expect(mockLightningService.createInvoice).toHaveBeenCalledWith(22200, 'test-uuid-id', 'NostriaPremium');
      expect(mockPaymentService.createInvoice).toHaveBeenCalledWith({
        id: 'test-uuid-id',
        hash: 'test-hash',
        invoice: 'lnbc1234567890',
        amountSat: 22200,
        tier: 'premium',
        billingCycle: 'monthly',
        priceCents: 999,
        pubkey: 'npub1234567890',
        username: 'testuser',
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

  describe('GET /api/payment/:hash', () => {
    const mockInvoice = {
      id: 'test-id',
      hash: 'test-hash',
      invoice: 'lnbc1234567890',
      amountSat: 22200,
      tier: 'premium' as Tier,
      billingCycle: 'monthly' as BillingCycle,
      priceCents: 999,
      pubkey: 'npub1234567890',
      username: 'testuser',
      isPaid: false,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 5000)
    };

    it('should return 400 when invoice not found', async () => {
      mockPaymentService.getInvoiceByHash.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/payment/non-existent-hash')
        .expect(400);

      expect(response.body.error).toBe('Invoice not found');
    });

    it('should return paid status when invoice is already marked as paid', async () => {
      const paidInvoice = { 
        ...mockInvoice, 
        isPaid: true, 
        paidAt: new Date('2025-06-18T15:16:45.325Z') 
      };
      mockPaymentService.getInvoiceByHash.mockResolvedValue(paidInvoice);

      const response = await request(app)
        .get('/api/payment/test-hash')
        .expect(200);

      expect(mockLightningService.checkPaymentStatus).not.toHaveBeenCalled();
      expect(response.body).toEqual({
        id: 'test-id',
        hash: 'test-hash',
        amountSat: 22200,
        status: 'paid',
        invoice: 'lnbc1234567890',
        expiresAt: mockInvoice.expiresAt.toISOString()
      });
    });

    it('should mark invoice as paid and create account when payment is confirmed', async () => {
      mockPaymentService.getInvoiceByHash.mockResolvedValue(mockInvoice);
      mockPaymentService.markInvoiceAsPaid.mockResolvedValue({
        ...mockInvoice,
        isPaid: true,
        paidAt: new Date(),
      });

      // Mock LightningService payment status check
      mockLightningService.checkPaymentStatus.mockResolvedValue(true);

      // Mock account service
      mockAccountService.getAccount.mockResolvedValue(null);
      mockAccountService.addAccount.mockResolvedValue({
        pubkey: 'npub1234567890',
        username: 'testuser',
        subscription: {
          tier: 'premium',
          billingCycle: 'monthly',
          price: { priceCents: 999, currency: 'USD' },
          entitlements: expect.any(Object),
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(app)
        .get('/api/payment/test-hash')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'paid');
      expect(mockPaymentService.markInvoiceAsPaid).toHaveBeenCalledWith('test-id');
      expect(mockAccountService.addAccount).toHaveBeenCalledTimes(1);
      expect(mockAccountService.updateAccount).not.toHaveBeenCalled();
    });

    it('should update existing account when payment is confirmed', async () => {
      const existingAccount = {
        pubkey: 'npub1234567890',
        username: 'olduser',
        subscription: { tier: 'free' as Tier, entitlements: config.tiers.free.entitlements },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPaymentService.getInvoiceByHash.mockResolvedValue(mockInvoice);
      mockPaymentService.markInvoiceAsPaid.mockResolvedValue({
        ...mockInvoice,
        isPaid: true,
        paidAt: new Date(),
      });

      // Mock LightningService payment status check
      mockLightningService.checkPaymentStatus.mockResolvedValue(true);

      // Mock account service
      mockAccountService.getAccount.mockResolvedValue(existingAccount);
      mockAccountService.updateAccount.mockResolvedValue({
        ...existingAccount,
        username: 'testuser',
        subscription: {
          tier: 'premium' as Tier,
          billingCycle: 'monthly' as BillingCycle,
          price: { priceCents: 999, currency: 'USD' },
          entitlements: config.tiers.premium.entitlements,
        },
        updatedAt: new Date(),
      });

      const response = await request(app)
        .get('/api/payment/test-hash')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'paid');
      expect(mockAccountService.addAccount).not.toHaveBeenCalled();
      expect(mockAccountService.updateAccount).toHaveBeenCalledTimes(1);
    });

    it('should return unpaid status when payment is not confirmed', async () => {
      mockPaymentService.getInvoiceByHash.mockResolvedValue(mockInvoice);
      mockLightningService.checkPaymentStatus.mockResolvedValue(false);

      const response = await request(app).get('/api/payment/test-hash')
        
      expect(response.status).toEqual(200);
      expect(mockLightningService.checkPaymentStatus).toHaveBeenCalledTimes(1);
      expect(response.body).toEqual({
        id: 'test-id',
        hash: 'test-hash',
        amountSat: 22200,
        status: 'pending',
        invoice: 'lnbc1234567890',
        expiresAt: mockInvoice.expiresAt.toISOString()
      });
    });

    it('should return expired status when payment is expired', async () => {
      const expiredInvoice = {
        ...mockInvoice,
        expiresAt: new Date(Date.now() - 15 * 60 * 1000) // 15 minutes ago
      }
      mockPaymentService.getInvoiceByHash.mockResolvedValue(expiredInvoice);
      mockLightningService.checkPaymentStatus.mockResolvedValue(false);

      const response = await request(app).get('/api/payment/test-hash');
      
      expect(response.status).toEqual(200);
      expect(mockLightningService.checkPaymentStatus).not.toHaveBeenCalled();
      expect(response.body).toEqual({
        id: 'test-id',
        hash: 'test-hash',
        amountSat: 22200,
        status: 'expired',
        invoice: 'lnbc1234567890',
        expiresAt: expiredInvoice.expiresAt.toISOString()
      });
    });

    it('should return 500 when external payment status API fails', async () => {
      const errorInvoice = { ...mockInvoice, hash: 'error-hash-456' };
      mockPaymentService.getInvoiceByHash.mockResolvedValue(errorInvoice);
      mockLightningService.checkPaymentStatus.mockRejectedValue(new Error('Internal Server Error'));

      const response = await request(app).get('/api/payment/test-hash')

      expect(response.status).toEqual(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });
}); 