import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { createRateLimit } from '../utils/rateLimit';
import { ErrorBody, NIP98AuthenticatedRequest } from './types';
import lightningService from '../services/LightningService';
import { Tier, BillingCycle } from '../config/types';
import RepositoryFactory from '../database/RepositoryFactory';
import config from '../config';
import { INVOICE_TTL, Payment } from '../models/payment';
import { now } from '../helpers/now';
import requireNIP98Auth from '../middleware/requireNIP98Auth';

// Get repository instance from factory
const paymentRepository = RepositoryFactory.getPaymentRepository();

const paymentRateLimit = createRateLimit(
  1 * 60 * 1000, // 1 minute
  30, // limit each IP to 30 payment requests per minute
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
 *         - billingCycle
 *         - pubkey
 *       properties:
 *         tierName:
 *           type: string
 *           enum: [free, premium, premium_plus]
 *           description: Subscription tier name
 *         billingCycle:
 *           type: string
 *           enum: [monthly, quarterly, yearly]
 *           description: Billing cycle
 *         pubkey:
 *           type: string
 *           description: User's public key in hex format (64 lowercase hex chars, not npub)
 */
interface CreatePaymentRequest {
  tierName: Tier;
  billingCycle: BillingCycle;
  pubkey: string; // hex format
}

/**
 * @openapi
 * components:
 *   schemas:
 *     Payment:
 *       type: object
 *       required:
 *         - id
 *         - type
 *         - paymentType
 *         - lnHash
 *         - lnInvoice
 *         - lnAmountSat
 *         - tier
 *         - billingCycle
 *         - priceCents
 *         - pubkey
 *         - isPaid
 *         - expires
 *         - status
 *         - created
 *         - modified
 *       properties:
 *         id:
 *           type: string
 *           description: Payment ID
 *         type:
 *           type: string
 *           enum: [payment]
 *           description: Document type
 *         paymentType:
 *           type: string
 *           enum: [ln]
 *           description: Payment type (Lightning Network)
 *         lnHash:
 *           type: string
 *           description: Lightning payment hash
 *         lnInvoice:
 *           type: string
 *           description: Lightning Network invoice
 *         lnAmountSat:
 *           type: number
 *           description: Lightning amount in satoshis
 *         tier:
 *           type: string
 *           enum: [free, premium, premium_plus]
 *           description: Subscription tier
 *         billingCycle:
 *           type: string
 *           enum: [monthly, quarterly, yearly]
 *           description: Billing cycle
 *         priceCents:
 *           type: number
 *           description: Price in cents (USD)
 *         pubkey:
 *           type: string
 *           description: User's public key in hex format
 *         isPaid:
 *           type: boolean
 *           description: Whether the payment has been completed
 *         paid:
 *           type: number
 *           format: timestamp
 *           description: Timestamp when payment was completed (optional)
 *           nullable: true
 *         expires:
 *           type: number
 *           format: timestamp
 *           description: Payment expiry timestamp
 *         status:
 *           type: string
 *           enum: [pending, expired, paid]
 *           description: Calculated payment status
 *         created:
 *           type: number
 *           format: timestamp
 *           description: Creation timestamp
 *         modified:
 *           type: number
 *           format: timestamp
 *           description: Last modification timestamp
 */
interface PaymentDto {
  id: string;
  type: 'payment';
  paymentType: 'ln';
  lnHash: string;
  lnInvoice: string;
  lnAmountSat: number;
  tier: Tier;
  billingCycle: BillingCycle;
  priceCents: number;
  pubkey: string;
  isPaid: boolean;
  paid?: number;
  expires: number;
  status: PaymentStatus;
  created: number;
  modified: number;
}

type CreatePaymentRequestType = Request<{}, any, CreatePaymentRequest, any>;
type CreatePaymentResponseType = Response<PaymentDto | ErrorBody>;

type GetPaymentRequest = Request<{ pubkey: string, paymentId: string }, any, any, any>;
type GetPaymentResponse = Response<PaymentDto | ErrorBody>;

const toPaymentDto = (payment: Payment, status: PaymentStatus): PaymentDto => ({
  id: payment.id,
  type: payment.type,
  paymentType: payment.paymentType,
  lnHash: payment.lnHash,
  lnInvoice: payment.lnInvoice,
  lnAmountSat: payment.lnAmountSat,
  tier: payment.tier,
  billingCycle: payment.billingCycle,
  priceCents: payment.priceCents,
  pubkey: payment.pubkey,
  isPaid: payment.isPaid,
  paid: payment.paid,
  expires: payment.expires,
  status,
  created: payment.created,
  modified: payment.modified,
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
    const { tierName, billingCycle, pubkey } = req.body;

    // Validate tier
    if (!config.tiers[tierName]) {
      return res.status(400).json({ error: 'Invalid tier name' });
    }

    // Validate billing cycle
    if (!['monthly', 'quarterly', 'yearly'].includes(billingCycle)) {
      return res.status(400).json({ error: 'Invalid billing cycle' });
    }

    // Validate pubkey format (basic npub check)
    if (pubkey.startsWith('npub')) {
      return res.status(400).json({ error: 'Invalid pubkey format. Must be hex format' });
    }

    // Get USD to BTC rate using LightningService
    let usdRate = await lightningService.getUsdBtcRate();

    if (!usdRate || typeof usdRate !== 'number') {
      logger.error('Invalid rate data received:', usdRate);
      return res.status(500).json({ error: 'Invalid exchange rate data' });
    }

    const priceCents = config.tiers[tierName]?.pricing?.[billingCycle]?.priceCents;

    if (priceCents === undefined) {
      return res.status(400).json({ error: 'Invalid tier or billing cycle' });
    }

    // Convert USD cents to satoshis
    const usdAmount = priceCents / 100; // Convert cents to dollars
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

    const ts = now();

    // Store invoice in database
    const payment = await paymentRepository.create({
      id: 'payment-' + invoiceId,
      type: 'payment',
      paymentType: 'ln',
      lnHash: hash,
      lnInvoice: invoice,
      lnAmountSat: amountSat,
      tier: tierName,
      billingCycle,
      priceCents,
      pubkey,
      isPaid: false,
      expires: ts + INVOICE_TTL,
      created: ts,
      modified: ts,
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
 * /payment/{pubkey}/{paymentId}:
 *   get:
 *     operationId: "GetPayment" 
 *     summary: Get payment
 *     description: Get payment by id
 *     tags: [Payment]
 *     parameters:
 *       - in: path
 *         name: pubkey
 *         required: true
 *         schema:
 *           type: string
 *         description: pubkey
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
router.get('/:pubkey/:paymentId', paymentRateLimit, async (req: GetPaymentRequest, res: GetPaymentResponse) => {
  try {
    const { paymentId, pubkey } = req.params;

    // Find invoice by hash
    const payment = await paymentRepository.get(paymentId, pubkey);

    console.log('Payment record found:', paymentId, payment);

    if (!payment) {
      return res.status(404).json({ error: 'Payment Record not found' });
    }

    // Check if already marked as paid
    if (payment.isPaid) {
      return res.json(toPaymentDto(payment, 'paid'));
    }

    if (payment.expires < now()) {
      return res.json(toPaymentDto(payment, 'expired'));
    }

    // Check payment status with LightningService
    let paid = await lightningService.checkPaymentStatus(payment.lnHash);

    if (config.env === 'development' && process.env.DEV_AUTO_PAYMENT === 'true') {
      paid = paid || now() - payment.created > 10000;
    }

    console.log('Paid status:', paid);

    if (paid) {
      // Mark invoice as paid
      const ts = now();

      const item = {
        ...payment,
        isPaid: true,
        paid: ts,
        modified: ts,
      };

      console.log('Updating payment status to paid:', item);

      await paymentRepository.update(item);

      logger.info(`Payment completed for ${payment.pubkey}, tier: ${payment.tier}, creating/updating account`);

      return res.json(toPaymentDto(payment, 'paid'));
    }

    return res.json(toPaymentDto(payment, 'pending'));

  } catch (error) {
    logger.error('Error checking payment status:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /payment:
 *   get:
 *     operationId: "ListPayments"
 *     summary: List all payments
 *     description: Get a list of all payment records (requires NIP-98 authentication)
 *     tags: [Payment]
 *     security:
 *       - NIP98Auth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 1000
 *           default: 100
 *         description: Maximum number of payments to return
 *     responses:
 *       200:
 *         description: List of payments retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Payment'
 *       401:
 *         description: Unauthorized - NIP-98 authentication required
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
router.get('/', requireNIP98Auth, async (req: NIP98AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    
    // Validate limit
    if (limit < 1 || limit > 1000) {
      return res.status(400).json({ error: 'Limit must be between 1 and 1000' });
    }

    const payments = await paymentRepository.getAllPayments(limit);

    // Convert payments to DTOs with status calculation
    const paymentDtos = payments.map(payment => {
      let status: PaymentStatus;
      
      if (payment.isPaid) {
        status = 'paid';
      } else if (payment.expires < now()) {
        status = 'expired';
      } else {
        status = 'pending';
      }

      return toPaymentDto(payment, status);
    });

    logger.info(`Retrieved ${paymentDtos.length} payments for authenticated user ${req.authenticatedPubkey?.substring(0, 16)}...`);

    return res.json(paymentDtos);
  } catch (error) {
    logger.error('Error retrieving payments:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
