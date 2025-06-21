import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { createRateLimit } from '../utils/rateLimit';
import accountRepository from '../database/accountRepository';
import { ErrorBody } from './types';
import lightningService from '../services/LightningService';
import { Tier, BillingCycle } from '../config/types';
import paymentRepository from '../database/paymentRepository';
import config from '../config';
import { INVOICE_TTL, Payment } from '../models/payment';
import { AccountSubscription, expiresAt } from '../models/accountSubscription';

const paymentRateLimit = createRateLimit(
  1 * 60 * 1000, // 1 minute
  30, // limit each IP to 10 payment requests per minute
  'Too many payment requests from this IP, please try again later.'
);

const router = express.Router();

type PaymentStatus = 'pending' | 'expired' | 'paid';

/**
 * @openapi
 * components:
 *   schemas:
 *     CreatePaymentRequest:
 *       type: object
 *       required:
 *         - tierName
 *         - price
 *         - billingCycle
 *         - pubkey
 *       properties:
 *         tierName:
 *           type: string
 *           enum: [free, premium, premium_plus]
 *           description: Subscription tier name
 *         price:
 *           type: number
 *           description: Price in USD cents
 *         billingCycle:
 *           type: string
 *           enum: [monthly, quarterly, yearly]
 *           description: Billing cycle
 *         pubkey:
 *           type: string
 *           description: User's public key in npub format
 *         username:
 *           type: string
 *           description: Optional username
 */
interface CreatePaymentRequest {
  tierName: Tier;
  price: number; // USD cents
  billingCycle: BillingCycle;
  pubkey: string; // npub format
  username?: string;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     Payment:
 *       type: object
 *       required:
 *         - id
 *         - lnInvoice
 *         - status
 *         - expiresAt
 *       properties:
 *         id:
 *           type: string
 *           description: Invoice ID
 *         lnInvoice:
 *           type: string
 *           description: LN invoice
 *         status:
 *           type: string
 *           enum: [pending, expired, paid]
 *           description: Payment status
 *         expiresAt:
 *           type: string
 *           format: date-time
 *           description: Expiry date
 */
interface PaymentDto {
  id: string;
  lnInvoice: string;
  status: PaymentStatus;
  expiresAt: Date;
}

type CreatePaymentRequestType = Request<{}, any, CreatePaymentRequest, any>;
type CreatePaymentResponseType = Response<PaymentDto | ErrorBody>;

type GetPaymentRequest = Request<{ paymentId: string }, any, any, any>;
type GetPaymentResponse = Response<PaymentDto | ErrorBody>;

const toPaymentDto = ({ id, lnInvoice, expiresAt }: Payment, status: PaymentStatus): PaymentDto => ({
  id,
  lnInvoice,
  status,
  expiresAt,
});

/**
 * @openapi
 * /payment:
 *   post:
 *     operationId: "CreatePayment"
 *     summary: Create a new payment invoice
 *     description: Creates a Lightning invoice for payment processing
 *     tags: [Payment]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreatePaymentRequest'
 *     responses:
 *       200:
 *         description: Payment invoice created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Payment'
 *       400:
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', paymentRateLimit, async (req: CreatePaymentRequestType, res: CreatePaymentResponseType) => {
  try {
    const { tierName, price, billingCycle, pubkey, username } = req.body;

    // Validate tier
    if (!config.tiers[tierName]) {
      return res.status(400).json({ error: 'Invalid tier name' });
    }

    // Validate billing cycle
    if (!['monthly', 'quarterly', 'yearly'].includes(billingCycle)) {
      return res.status(400).json({ error: 'Invalid billing cycle' });
    }

    // Validate price
    if (price <= 0) {
      return res.status(400).json({ error: 'Price must be greater than 0' });
    }

    // Validate pubkey format (basic npub check)
    if (!pubkey.startsWith('npub')) {
      return res.status(400).json({ error: 'Invalid pubkey format. Must be npub format' });
    }

    // Get USD to BTC rate using LightningService
    let usdRate = await lightningService.getUsdBtcRate();

    if (!usdRate || typeof usdRate !== 'number') {
      logger.error('Invalid rate data received:', usdRate);
      return res.status(500).json({ error: 'Invalid exchange rate data' });
    }

    // Convert USD cents to satoshis
    const usdAmount = price / 100; // Convert cents to dollars
    const satoshis = Math.round((usdAmount / usdRate) * 100000000); // Convert to satoshis

    // Generate unique invoice ID
    const invoiceId = uuidv4();

    // Create Lightning invoice using LightningService
    const invoiceData = await lightningService.createInvoice(satoshis, invoiceId, 'NostriaPremium');

    const invoice = invoiceData.serialized;
    const hash = invoiceData.paymentHash;
    const amountSat = invoiceData.amountSat;

    if (!invoice || !hash || !amountSat) {
      logger.error('Invalid invoice data received:', invoiceData);
      return res.status(500).json({ error: 'Invalid invoice data received' });
    }

    const now = new Date()
    // Store invoice in database
    const payment = await paymentRepository.create({
      id: invoiceId,
      type: 'ln',
      lnHash: hash,
      lnInvoice: invoice,
      lnAmountSat: amountSat,
      tier: tierName,
      billingCycle,
      priceCents: price,
      pubkey,
      username,
      isPaid: false,
      expiresAt: new Date(now.getTime() + INVOICE_TTL),
      createdAt: now,
      updatedAt: now,
    });

    logger.info(`Payment invoice created for ${pubkey}, tier: ${tierName}, amount: ${amountSat} sats`);

    return res.json(toPaymentDto(payment, 'pending'));
  } catch (error) {
    logger.error('Error creating payment invoice:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /payment/{paymentId}:
 *   get:
 *     operationId: "GetPayment" 
 *     summary: Get payment
 *     description: Get payment by id
 *     tags: [Payment]
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment id
 *     responses:
 *       200:
 *         description: Payment status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Payment'
 *       400:
 *         description: Bad request - invoice not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:paymentId', paymentRateLimit, async (req: GetPaymentRequest, res: GetPaymentResponse) => {
  try {
    const { paymentId } = req.params;

    // Find invoice by hash
    const payment = await paymentRepository.get(paymentId);
    if (!payment) {
      return res.status(400).json({ error: 'Payment Record not found' });
    }

    // Check if already marked as paid
    if (payment.isPaid) {
      return res.json(toPaymentDto(payment, 'paid'));
    }

    if (payment.expiresAt < new Date()) {
      return res.json(toPaymentDto(payment, 'expired'));
    }

    // Check payment status with LightningService
    const paid = await lightningService.checkPaymentStatus(payment.lnHash);

    if (paid) {
      // Create or update user account with subscription
      const tierDetails = config.tiers[payment.tier];
      const subscription: AccountSubscription = {
        tier: payment.tier,
        billingCycle: payment.billingCycle,
        price: {
          priceCents: payment.priceCents,
          currency: 'USD',
        },
        entitlements: tierDetails.entitlements,
      };

      // Check if account exists
      let account = await accountRepository.getByPubKey(payment.pubkey);

      if (account) {
        // Update existing account
        //account.subscription = subscription;
        account.username = payment.username || account.username;
        account.updatedAt = new Date();
        account.tier = payment.tier;
        account.subscription = JSON.stringify(subscription)
        account.expiresAt = expiresAt(payment.billingCycle)
        account = await accountRepository.update(account);
      } else {
        // Create new account
        const now = new Date();

        account = await accountRepository.create({
          pubkey: payment.pubkey,
          username: payment.username,
          createdAt: now,
          updatedAt: now,
          tier: payment.tier,
          subscription: JSON.stringify(subscription),
          expiresAt: expiresAt(payment.billingCycle),
        });
      }
      // Mark invoice as paid
      const now = new Date();
      await paymentRepository.update({
        ...payment,
        isPaid: true,
        paidAt: now,
        updatedAt: now,
      })

      logger.info(`Payment completed for ${payment.pubkey}, tier: ${payment.tier}, creating/updating account`);

      return res.json(toPaymentDto(payment, 'paid'));
    }

    return res.json(toPaymentDto(payment, 'pending'));

  } catch (error) {
    logger.error('Error checking payment status:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
