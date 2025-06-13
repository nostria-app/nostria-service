import express, { Request, Response } from 'express';
import assert from 'node:assert';
import logger from '../utils/logger';
import { createRateLimit } from '../utils/rateLimit';
import requireNIP98Auth from '../middleware/requireNIP98Auth';
import accountService, { Account } from '../services/AccountService';
import { ErrorBody, NIP98AuthenticatedRequest } from './types';


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

interface PublicAccountDto {
  pubkey: string;
  signupDate: Date;
  tier: string;
  isActive: boolean;
}

interface AccountDto {
  pubkey: string;
  email?: string;
  username?: string;
  signupDate: Date;
  lastLoginDate?: Date;
}

type AddAccountRequest = Request<{}, any, { pubkey: string, email?: string }, any>
type AddAccountResponse = Response<AccountDto | ErrorBody>

type GetAccountRequest = NIP98AuthenticatedRequest;
type GetAccountResponse = Response<AccountDto | ErrorBody>

type GetPublicAccountRequest = Request<{ pubkey: string}, any, any, any>
type GetPublicAccountResponse = Response<PublicAccountDto | ErrorBody>

type UpdateAccountRequest = NIP98AuthenticatedRequest<{}, any, Partial<Account>, any>
type UpdateAccountResponse = Response<AccountDto | ErrorBody>

const toAccountDto = ({ pubkey, email, username, createdAt, lastLoginDate }: Account): AccountDto => ({
  pubkey,
  email,
  username,
  signupDate: createdAt,
  lastLoginDate,
});


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


router.get('/:pubkey', queryAccountRateLimit, async (req: GetPublicAccountRequest, res: GetPublicAccountResponse) => {
  try {
    const targetPubkey = req.params.pubkey;

    if (!targetPubkey) {
      return res.status(400).json({ error: 'Public key is required' });
    }

    // Get user profile
    const account = await accountService.getAccount(targetPubkey);

    if (!account) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Public profile information
    const publicProfile: PublicAccountDto = {
      pubkey: account.pubkey,
      signupDate: account.createdAt,
      tier: 'free',
      isActive: true,
    };

    return res.status(200).json(publicProfile);
  } catch (error: any) {
    logger.error(`Error getting user profile: ${error.message}`);
    return res.status(500).json({ error: 'Failed to get user profile' });
  }
});


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