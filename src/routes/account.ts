import express, { Request, Response } from 'express';
import assert from 'node:assert';
import logger from '../utils/logger';
import { createRateLimit } from '../utils/rateLimit';
import requireNIP98Auth from '../middleware/requireNIP98Auth';
import { ErrorBody, NIP98AuthenticatedRequest } from './types';
import { isPotentiallyPubkey, isValidNpub } from '../utils/nostr';
import config from '../config';
import { features } from '../config/features';
import RepositoryFactory from '../database/RepositoryFactory';
import { Account } from '../models/account';
import { AccountSubscription, DEFAULT_SUBSCRIPTION, expiresAt } from '../models/accountSubscription';
import { Entitlements, Tier } from '../config/types';
import { now } from '../helpers/now';
import validateUsername from './account/validateUsername';

// Get repository instances from factory
const accountRepository = RepositoryFactory.getAccountRepository();
const paymentRepository = RepositoryFactory.getPaymentRepository();

const authRateLimit = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  500, // limit each IP to 500 requests per windowMs
  'Too many authenticated requests from this IP, please try again later.'
);

// Key lookup endpoint
const queryAccountRateLimit = createRateLimit(
  1 * 60 * 1000, // 1 minute
  30, // limit each IP to 30 lookup attempts in minute
  'Too many signup attempts from this IP, please try again later.',
);

// List endpoints - moderate limits for administrative use
const listRateLimit = createRateLimit(
  1 * 60 * 1000, // 1 minute
  100, // limit each IP to 100 list requests per minute
  'Too many list requests from this IP, please try again later.',
);

// Signup endpoints - very restrictive to prevent abuse
const signupRateLimit = createRateLimit(
  60 * 60 * 1000, // 1 hour
  20, // limit each IP to 20 signup attempts per hour
  'Too many signup attempts from this IP, please try again later.',
);

const router = express.Router();

// combined middleware to be used for routes requiring
// authenticated user
const authUser = [authRateLimit, requireNIP98Auth];

/**
 * @openapi
 * components:
 *   schemas:
 *     PublicAccount:
 *       type: object
 *       properties:
 *         pubkey:
 *           type: string
 *           description: User's public key
 *         signupDate:
 *           type: number
 *           format: timestamp
 *           description: Account creation date
 *         tier:
 *           type: string
 *           description: User's subscription tier
 *         isActive:
 *           type: boolean
 *           description: Whether the account is active
 *         username:
 *           type: string
 *           nullable: true
 *           description: User's username
 */
interface PublicAccountDto {
  pubkey: string;
  username: string;
  signupDate: number;
  tier: string;
  isActive: boolean;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     Account:
 *       type: object
 *       properties:
 *         pubkey:
 *           type: string
 *           description: User's public key
 *         username:
 *           type: string
 *           nullable: true
 *           description: User's username
 *         signupDate:
 *           type: number
 *           format: timestamp
 *           description: Account creation date
 *         lastLoginDate:
 *           type: number
 *           format: timestamp
 *           nullable: true
 *           description: Last login date
 *         expires:
 *           type: number
 *           format: timestamp
 *           nullable: true
 *           description: Subscription expiry date
 *         tier:
 *           $ref: '#/components/schemas/Tier'
 *         entitlements:
 *           $ref: '#/components/schemas/Entitlements'
*/
interface AccountDto {
  pubkey: string;
  username?: string;
  signupDate: number;
  lastLoginDate?: number;
  expires?: number;
  tier: Tier;
  entitlements: Entitlements;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     AccountList:
 *       type: object
 *       required:
 *         - id
 *         - type
 *         - pubkey
 *         - tier
 *         - created
 *         - modified
 *       properties:
 *         id:
 *           type: string
 *           description: Account ID (same as pubkey)
 *         type:
 *           type: string
 *           enum: [account]
 *           description: Document type
 *         pubkey:
 *           type: string
 *           description: User's public key in hex format
 *         username:
 *           type: string
 *           nullable: true
 *           description: User's username
 *         tier:
 *           type: string
 *           enum: [free, premium, premium_plus]
 *           description: Subscription tier
 *         subscription:
 *           type: object
 *           description: Account subscription details
 *         expires:
 *           type: number
 *           format: timestamp
 *           nullable: true
 *           description: Subscription expiry timestamp
 *         created:
 *           type: number
 *           format: timestamp
 *           description: Account creation timestamp
 *         modified:
 *           type: number
 *           format: timestamp
 *           description: Last modification timestamp
 *         lastLoginDate:
 *           type: number
 *           format: timestamp
 *           nullable: true
 *           description: Last login timestamp
 */
interface AccountListDto {
  id: string;
  type: 'account';
  pubkey: string;
  username?: string;
  tier: Tier;
  subscription: AccountSubscription;
  expires?: number;
  created: number;
  modified: number;
  lastLoginDate?: number;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     AddAccountRequest:
 *       type: object
 *       required:
 *         - pubkey
 *       properties:
 *         pubkey:
 *           type: string
 *           description: User's public key
 *         username:
 *           type: string
 *           nullable: true
 *           description: User's username
 *         paymentId:
 *           type: string
 *           nullable: true
 *           description: Payment Id for the premium payment
 */
type AddAccountRequest = Request<{}, any, { pubkey: string, username?: string, paymentId?: string }, any>
type AddAccountResponse = Response<AccountDto | ErrorBody>

type GetAccountRequest = NIP98AuthenticatedRequest;
type GetAccountResponse = Response<AccountDto | ErrorBody>

type ApiResponse<T> = { success: boolean, message?: string, result?: T }

type GetPublicAccountRequest = Request<{ pubkeyOrUsername: string }, any, any, any>

/**
 * @openapi
 * components:
 *   schemas:
 *     ApiResponse:
 *       type: object
 *       required:
 *         - success
 *       properties:
 *         success:
 *           type: boolean
 *           description: Whether the request was successful
 *         message:
 *           type: string
 *           description: Optional message about the response
 *         result:
 *           $ref: '#/components/schemas/PublicAccount'
 */
type GetPublicAccountResponse = Response<ApiResponse<PublicAccountDto> | ErrorBody>

type CheckUsernameRequest = Request<{ username: string }, any, any, any>
type CheckUsernameResponse = Response<ApiResponse<{}> | ErrorBody>

/**
 * @openapi
 * components:
 *   schemas:
 *     UpdateAccountRequest:
 *       type: object
 *       properties:
 *         username:
 *           type: string
 *           nullable: true
 *           description: User's username
 */
type UpdateAccountRequest = NIP98AuthenticatedRequest<{}, any, Pick<Account, 'username'>, any>
type UpdateAccountResponse = Response<AccountDto | ErrorBody>

const toAccountDto = ({ pubkey, username, created, tier, expires, subscription, lastLoginDate }: Account): AccountDto => ({
  pubkey,
  username,
  signupDate: created,
  lastLoginDate,
  tier,
  expires,
  entitlements: subscription?.entitlements,
});

/**
 * @openapi
 * components:
 *   schemas:
 *     Feature:
 *       type: string
 *       description: Subscription feature
 *       enum:
 *         - BASIC_WEBPUSH
 *         - COMMUNITY_SUPPORT
 *         - USERNAME
 *         - ADVANCED_FILTERING
 *         - PRIORITY_SUPPORT
 *         - CUSTOM_TEMPLATES
 *         - API_ACCESS
 *         - WEBHOOK
 *         - ANALYTICS
 *     FeatureWithLabel:
 *       type: object
 *       required:  # List the required properties here
 *         - key
 *       properties:
 *         key:
 *           $ref: '#/components/schemas/Feature'
 *         label:
 *           type: string
 *           description: Human-readable description of the feature
 *     Price:
 *       type: object
 *       properties:
 *         priceCents:
 *           type: integer
 *           description: Price in cents
 *         currency:
 *           type: string
 *           description: Currency code (e.g., USD)
 *     BillingCycle:
 *       type: string
 *       enum: [monthly, quarterly, yearly]
 *     Pricing:
 *       type: object
 *       properties:
 *         monthly:
 *           $ref: '#/components/schemas/Price'
 *         quarterly:
 *           $ref: '#/components/schemas/Price'
 *         yearly:
 *           $ref: '#/components/schemas/Price'
 *     Entitlements:
 *       type: object
 *       properties:
 *         notificationsPerDay:
 *           type: integer
 *         features:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/FeatureWithLabel'
 *     Tier:
 *       type: string
 *       enum: [free, premium, premium_plus]
 *     TierDetails:
 *       type: object
 *       required:
 *         - tier
 *         - name
 *         - pricing
 *         - entitlements
 *       properties:
 *         tier:
 *           $ref: '#/components/schemas/Tier'
 *         name:
 *           type: string
 *         pricing:
 *           $ref: '#/components/schemas/Pricing'
 *         entitlements:
 *           $ref: '#/components/schemas/Entitlements'
 *
 * /account/tiers:
 *   get:
 *     operationId: "GetTiers"
 *     summary: Get available subscription tiers
 *     description: Retrieve all available subscription tiers and their details
 *     tags:
 *       - Account
 *     responses:
 *       '200':
 *         description: List of subscription tiers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties:
 *                 $ref: '#/components/schemas/TierDetails'
 *       '500':
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/tiers', (req: Request, res: Response) => {
  try {

    // Map features to include human-readable labels
    const tiersWithLabels = Object.fromEntries(
      Object.entries(config.tiers)
        .filter(([tierKey]) => tierKey !== 'free')
        .map(([tierKey, tierValue]) => [
          tierKey,
          {
            ...tierValue,
            entitlements: {
              ...tierValue.entitlements,
              features: tierValue.entitlements.features.map((feature) => ({
                key: feature,
                label: features[feature].label,
              })),
            },
          },
        ])
    );
    return res.status(200).json(tiersWithLabels);
  } catch (error: any) {
    logger.error(`Error getting tiers: ${error.message}`);
    return res.status(500).json({ error: 'Failed to get tiers' });
  }
});

/**
 * @openapi
 * /account:
 *   post:
 *     operationId: "AddAccount"
 *     summary: Create a new account
 *     description: Register a new user account
 *     tags:
 *       - Account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddAccountRequest'
 *     responses:
 *       '201':
 *         description: Account created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Account'
 *       '400':
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '409':
 *         description: Account already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '429':
 *         description: Too many requests
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', signupRateLimit, async (req: AddAccountRequest, res: AddAccountResponse) => {
  try {
    console.log('Received signup request:', req.body);

    const { pubkey, username, paymentId } = req.body;

    console.log(`Received signup request for pubkey: ${pubkey}, username: ${username}, paymentId: ${paymentId}`);

    if (!pubkey) {
      return res.status(400).json({ error: 'Public key is required' });
    }

    const trimmedUsername = username?.trim();
    if (trimmedUsername) {
      const usernameError = validateUsername(trimmedUsername);
      if (usernameError) {
        return res.status(400).json({ error: usernameError });
      }
      
      const existingAccountByUsername = await accountRepository.getByUsername(trimmedUsername);
      if (existingAccountByUsername) {
        return res.status(409).json({ error: 'Username is already taken' });
      }
    }

    // Check if user already exists
    const existingAccount = await accountRepository.getByPubkey(pubkey);

    if (existingAccount) {
      return res.status(409).json({ error: 'Account already exists' });
    }

    let subscription: AccountSubscription = DEFAULT_SUBSCRIPTION;

    if (paymentId) {
      const payment = await paymentRepository.get(paymentId, pubkey);

      console.log(`Payment found for ID: ${paymentId}`, payment);

      if (!payment) {
        console.log(`No payment found for ID: ${paymentId}`);
        return res.status(400).json({ error: 'No such payment' });
      }

      if (payment.pubkey !== pubkey) {
        return res.status(400).json({ error: 'Payment is for different pubkey' });
      }

      // Create or update user account with subscription
      const tierDetails = config.tiers[payment.tier as Tier];

      subscription = {
        tier: payment.tier,
        billingCycle: payment.billingCycle,
        price: {
          priceCents: payment.priceCents,
          currency: 'USD',
        },
        entitlements: tierDetails.entitlements,
      };

      console.log(`Creating account with subscription:`, subscription);
    }

    const ts = now();

    const canHaveUsername = subscription.entitlements.features.includes('USERNAME');

    const account: Account = {
      id: `account-${pubkey}`,
      type: 'account',
      pubkey,
      username: canHaveUsername ? trimmedUsername : undefined,
      created: ts,
      modified: ts,
      tier: subscription.tier,
      subscription,
      expires: expiresAt(subscription.billingCycle),
    };

    console.log(`Creating account:`, account);

    await accountRepository.create(account);

    logger.info(`New account signup: ${pubkey.substring(0, 16)}... with username: ${username || 'none'}`);

    return res.status(201).json(toAccountDto(account));
  } catch (error: any) {
    logger.error(`Error during signup: ${error.message}`);
    return res.status(500).json({ error: 'Failed to register user' });
  }
});

/**
 * @openapi
 * /account/check/{username}:
 *   get:
 *     operationId: "CheckUsername"
 *     summary: Check username can be used
 *     description: Checks the given username is correct and is not taken
 *     tags:
 *       - Account
 *     parameters:
 *       - name: username
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Username
 *     responses:
 *       '200':
 *         description: Check result
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       '400':
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '429':
 *         description: Too many requests
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/check/:username', queryAccountRateLimit, async (req: CheckUsernameRequest, res: CheckUsernameResponse) => {
  const username = req.params.username?.trim();

  if (!username) {
    return res.status(200).json({ success: false, error: 'Public key or username is required' });
  }

  const usernameError = validateUsername(username);
  if (usernameError) {
    return res.status(200).json({ success: false, message: usernameError });
  }

  const account = await accountRepository.getByUsername(username);

  if (account) {
    return res.status(200).json({ success: false, message: 'Username is taken' });
  }

  return res.status(200).json({ success: true });
});

/**
 * @openapi
 * /account/list:
 *   get:
 *     operationId: "ListAccounts"
 *     summary: List all accounts
 *     description: Get a list of all account records (requires NIP-98 authentication)
 *     tags: [Account]
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
 *         description: Maximum number of accounts to return
 *     responses:
 *       200:
 *         description: List of accounts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/AccountList'
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
router.get('/list', requireNIP98Auth, async (req: NIP98AuthenticatedRequest, res: Response) => {
  try {
    console.log('Account list endpoint reached with auth:', req.authenticatedPubkey);
    const limit = parseInt(req.query.limit as string) || 100;
    
    // Validate limit
    if (limit < 1 || limit > 1000) {
      return res.status(400).json({ error: 'Limit must be between 1 and 1000' });
    }

    const accounts = await accountRepository.getAllAccounts(limit);

    // Convert accounts to DTOs
    const accountDtos = accounts.map(account => toAccountListDto(account));

    logger.info(`Retrieved ${accountDtos.length} accounts for authenticated user ${req.authenticatedPubkey?.substring(0, 16)}...`);

    return res.json(accountDtos);
  } catch (error) {
    logger.error('Error retrieving accounts:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /account/{pubkeyOrUsername}:
 *   get:
 *     operationId: "GetPublicAccount"
 *     summary: Get public account information
 *     description: Retrieve public information about a user account
 *     tags:
 *       - Account
 *     parameters:
 *       - name: pubkeyOrUsername
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: User's public key in pubkey format or a username
 *     responses:
 *       '200':
 *         description: Public account information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       '400':
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '429':
 *         description: Too many requests
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:pubkeyOrUsername', queryAccountRateLimit, async (req: GetPublicAccountRequest, res: GetPublicAccountResponse) => {
  try {
    console.log('PubkeyOrUsername endpoint reached with param:', req.params.pubkeyOrUsername);
    const needle = req.params.pubkeyOrUsername;

    if (!needle) {
      return res.status(400).json({ error: 'Public key or username is required' });
    }

    let account: Account | null;
    if (isPotentiallyPubkey(needle)) {
      account = await accountRepository.getByPubkey(needle);
    } else {
      account = await accountRepository.getByUsername(needle);
    }

    if (!account) {
      return res.status(200).json({ success: false, message: 'User not found' });
    }

    // Public profile information
    const publicProfile: PublicAccountDto = {
      username: account.username!,
      pubkey: account.pubkey,
      signupDate: account.created,
      tier: account.tier,
      isActive: !account.expires || account.expires > now(),
    };

    return res.status(200).json({
      success: true,
      result: publicProfile,
    });
  } catch (error: any) {
    logger.error(`Error getting user profile: ${error.message}`);
    return res.status(500).json({ error: 'Failed to get user profile' });
  }
});

/**
 * @openapi
 * /account:
 *   get:
 *     operationId: "GetAccount"
 *     summary: Get authenticated user's account
 *     description: Retrieve the authenticated user's account information
 *     tags:
 *       - Account
 *     security:
 *       - NIP98Auth: []
 *     responses:
 *       '200':
 *         description: Account information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Account'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Account not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '429':
 *         description: Too many requests
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', authUser, async (req: GetAccountRequest, res: GetAccountResponse) => {
  try {
    const pubkey = req.authenticatedPubkey;
    assert(pubkey, "Pubkey should be present for authenticated user");

    console.log(`Getting account for authenticated user: ${pubkey}`);

    const account = await accountRepository.getByPubkey(pubkey);
    if (!account) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    return res.json(toAccountDto(account));

  } catch (error: any) {
    logger.error(`Get profile error for ${req.authenticatedPubkey || 'unknown'}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to get account information' });
  }
});

/**
 * @openapi
 * /account:
 *   put:
 *     operationId: "UpdateAccount"
 *     summary: Update authenticated user's account
 *     description: Update the authenticated user's account information
 *     tags:
 *       - Account
 *     security:
 *       - NIP98Auth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateAccountRequest'
 *     responses:
 *       '200':
 *         description: Account updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Account'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Account not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '409':
 *         description: Username already taken
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '429':
 *         description: Too many requests
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put('/', authUser, async (req: UpdateAccountRequest, res: UpdateAccountResponse) => {
  try {
    const pubkey = req.authenticatedPubkey;
    assert(pubkey, "Pubkey should be present for authenticated user");

    const { username } = req.body;

    // Get current account
    const currentAccount = await accountRepository.getByPubkey(pubkey);
    if (!currentAccount) {
      return res.status(404).json({ error: 'Account not found' });
    }

    try {
      // Update account with new data
      const updatedAccount = await accountRepository.update({
        ...currentAccount,
        username: username ?? currentAccount.username,
      });

      return res.json(toAccountDto(updatedAccount));
    } catch (error: any) {
      if (error.message === 'Username is already taken') {
        return res.status(409).json({ error: 'Username is already taken' });
      }
      throw error;
    }

  } catch (error: any) {
    logger.error(`Update account error for ${req.authenticatedPubkey || 'unknown'}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to update account information' });
  }
});

// Helper function to convert Account to AccountListDto
const toAccountListDto = (account: Account): AccountListDto => ({
  id: account.id,
  type: account.type as 'account',
  pubkey: account.pubkey,
  username: account.username,
  tier: account.tier,
  subscription: account.subscription,
  expires: account.expires,
  created: account.created,
  modified: account.modified,
  lastLoginDate: account.lastLoginDate,
});

export default router; 