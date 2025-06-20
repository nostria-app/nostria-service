import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { createRateLimit } from '../utils/rateLimit';
import accountService from '../services/AccountService';
import { ErrorBody } from './types';
import lightningService from '../services/LightningService';
import { Tier, BillingCycle } from '../config/types';
import paymentService, { PaymentInvoice } from '../services/PaymentService';
import config from '../config';

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
 *         - hash
 *         - amountSat
 *         - invoice
 *         - status
 *         - expiresAt
 *       properties:
 *         id:
 *           type: string
 *           description: Invoice ID
 *         hash:
 *           type: string
 *           description: Payment hash
 *         amountSat:
 *           type: number
 *           description: Amount in satoshis
 *         invoice:
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
  hash: string;
  amountSat: number;
  invoice: string;
  status: PaymentStatus;
  expiresAt: Date;
}

type CreatePaymentRequestType = Request<{}, any, CreatePaymentRequest, any>;
type CreatePaymentResponseType = Response<PaymentDto | ErrorBody>;

type GetPaymentRequest = Request<{ hash: string }, any, any, any>;
type GetPaymentResponse = Response<PaymentDto | ErrorBody>;

const toPaymentDto = ({ id, hash, invoice, amountSat, expiresAt }: PaymentInvoice, status: PaymentStatus): PaymentDto => ({
  id,
  hash,
  invoice,
  amountSat,
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

    // Store invoice in database
    const paymentInvoice = await paymentService.createInvoice({
      id: invoiceId,
      hash,
      invoice,
      amountSat,
      tier: tierName,
      billingCycle,
      priceCents: price,
      pubkey,
      username,
    });

    logger.info(`Payment invoice created for ${pubkey}, tier: ${tierName}, amount: ${amountSat} sats`);

    return res.json(toPaymentDto(paymentInvoice, 'pending'));
  } catch (error) {
    logger.error('Error creating payment invoice:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /payment/{hash}:
 *   get:
 *     operationId: "GetPayment" 
 *     summary: Get payment
 *     description: Get payment by hash
 *     tags: [Payment]
 *     parameters:
 *       - in: path
 *         name: hash
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment hash returned by invoice creation
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
router.get('/:hash', paymentRateLimit, async (req: GetPaymentRequest, res: GetPaymentResponse) => {
  try {
    const { hash } = req.params;

    // Find invoice by hash
    const invoice = await paymentService.getInvoiceByHash(hash);
    if (!invoice) {
      return res.status(400).json({ error: 'Invoice not found' });
    }

    // Check if already marked as paid
    if (invoice.isPaid) {
      return res.json(toPaymentDto(invoice, 'paid'));
    }

    if (invoice.expiresAt < new Date()) {
      return res.json(toPaymentDto(invoice, 'expired'));
    }

    // Check payment status with LightningService
    const paid = await lightningService.checkPaymentStatus(hash);

    if (paid) {
      
      

      // Create or update user account with subscription
      const tierDetails = config.tiers[invoice.tier];
      const subscription = {
        tier: invoice.tier,
        billingCycle: invoice.billingCycle,
        price: {
          priceCents: invoice.priceCents,
          currency: 'USD',
        },
        entitlements: tierDetails.entitlements,
      };

      // Check if account exists
      console.log(invoice);
      let account = await accountService.getAccount(invoice.pubkey);

      console.log(account);
      if (account) {
        // Update existing account
        account.subscription = subscription;
        account.username = invoice.username || account.username;
        account = await accountService.updateAccount(account);
      } else {
        console.log(JSON.stringify({
          pubkey: invoice.pubkey,
          username: invoice.username,
          subscription,
        }, null, 2));
        // Create new account
        account = await accountService.addAccount({
          pubkey: invoice.pubkey,
          username: invoice.username,
          subscription,
        });
      }
      // Mark invoice as paid
      const updatedInvoice = await paymentService.markInvoiceAsPaid(invoice.id);

      logger.info(`Payment completed for ${invoice.pubkey}, tier: ${invoice.tier}, creating/updating account`);

      return res.json(toPaymentDto(invoice, 'paid'));
    }

    return res.json(toPaymentDto(invoice, 'pending'));

  } catch (error) {
    logger.error('Error checking payment status:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
