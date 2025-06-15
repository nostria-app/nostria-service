import express, { Request, Response } from 'express';
import assert from 'node:assert';
import logger from '../utils/logger';
import { createRateLimit } from '../utils/rateLimit';
import requireNIP98Auth from '../middleware/requireNIP98Auth';
import accountService, { Account } from '../services/AccountService';
import { ErrorBody, NIP98AuthenticatedRequest } from './types';
import { isValidNpub } from '../utils/nostr';

/**
 * @openapi
 * components:
 *   securitySchemes:
 *     NIP98Auth:
 *       type: http
 *       scheme: bearer
 *       description: NIP-98 authentication using Nostr events
 */

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
 *     PublicAccountDto:
 *       type: object
 *       properties:
 *         pubkey:
 *           type: string
 *           description: User's public key
 *         signupDate:
 *           type: string
 *           format: date-time
 *           description: Account creation date
 *         tier:
 *           type: string
 *           description: User's subscription tier
 *         isActive:
 *           type: boolean
 *           description: Whether the account is active
 */
interface PublicAccountDto {
  pubkey: string;
  signupDate: Date;
  tier: string;
  isActive: boolean;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     AccountDto:
 *       type: object
 *       properties:
 *         pubkey:
 *           type: string
 *           description: User's public key
 *         email:
 *           type: string
 *           nullable: true
 *           description: User's email address
 *         username:
 *           type: string
 *           nullable: true
 *           description: User's username
 *         signupDate:
 *           type: string
 *           format: date-time
 *           description: Account creation date
 *         lastLoginDate:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: Last login date
 */
interface AccountDto {
  pubkey: string;
  email?: string;
  username?: string;
  signupDate: Date;
  lastLoginDate?: Date;
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
 *         email:
 *           type: string
 *           nullable: true
 *           description: User's email address
 */
type AddAccountRequest = Request<{}, any, { pubkey: string, email?: string }, any>
type AddAccountResponse = Response<AccountDto | ErrorBody>

type GetAccountRequest = NIP98AuthenticatedRequest;
type GetAccountResponse = Response<AccountDto | ErrorBody>

type ApiResponse<T> = { success: boolean, message?: string, result?: T }

type GetPublicAccountRequest = Request<{ pubkeyOrUsername: string}, any, any, any>

/**
 * @openapi
 * components:
 *   schemas:
 *     ApiResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Whether the request was successful
 *         message:
 *           type: string
 *           description: Optional message about the response
 *         result:
 *           $ref: '#/components/schemas/PublicAccountDto'
 */
type GetPublicAccountResponse = Response<ApiResponse<PublicAccountDto> | ErrorBody>

/**
 * @openapi
 * components:
 *   schemas:
 *     UpdateAccountRequest:
 *       type: object
 *       properties:
 *         email:
 *           type: string
 *           nullable: true
 *           description: User's email address
 *         username:
 *           type: string
 *           nullable: true
 *           description: User's username
 */
type UpdateAccountRequest = NIP98AuthenticatedRequest<{}, any, Partial<Account>, any>
type UpdateAccountResponse = Response<AccountDto | ErrorBody>

/**
 * @openapi
 * components:
 *   schemas:
 *     Error:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           description: Error message
 */

const toAccountDto = ({ pubkey, email, username, createdAt, lastLoginDate }: Account): AccountDto => ({
  pubkey,
  email,
  username,
  signupDate: createdAt,
  lastLoginDate,
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
 *               $ref: '#/components/schemas/AccountDto'
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
    const { pubkey, email } = req.body;

    if (!pubkey) {
      return res.status(400).json({ error: 'Public key is required' });
    }

    // Check if user already exists
    const existingAccount = await accountService.getAccount(pubkey);
    if (existingAccount) {
      return res.status(409).json({ error: 'Account already exists' });
    }

    const account = await accountService.addAccount({ pubkey, email });

    logger.info(`New account signup: ${pubkey.substring(0, 16)}... with email: ${email || 'none'}`);

    return res.status(201).json(toAccountDto(account));
  } catch (error: any) {
    logger.error(`Error during signup: ${error.message}`);
    return res.status(500).json({ error: 'Failed to register user' });
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
 *         description: User's public key in npub format or a username
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
    const needle = req.params.pubkeyOrUsername;

    if (!needle) {
      return res.status(400).json({ error: 'Public key or username is required' });
    }

    let account: Account | null;
    if (isValidNpub(needle)) {
      account = await accountService.getAccount(needle);
    } else {
      account = await accountService.getAccountByUsername(needle);
    }

    if (!account) {
      return res.status(200).json({ success: false, message: 'User not found' });
    }

    // Public profile information
    const publicProfile: PublicAccountDto = {
      pubkey: account.pubkey,
      signupDate: account.createdAt,
      tier: 'free',
      isActive: true,
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
 *               $ref: '#/components/schemas/AccountDto'
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

    const account = await accountService.getAccount(pubkey);
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
 *               $ref: '#/components/schemas/AccountDto'
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

    const { email, username } = req.body;

    // Get current account
    const currentAccount = await accountService.getAccount(pubkey);
    if (!currentAccount) {
      return res.status(404).json({ error: 'Account not found' });
    }

    try {
      // Update account with new data
      const updatedAccount = await accountService.updateAccount({
        ...currentAccount,
        email: email ?? currentAccount.email,
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

export default router; 