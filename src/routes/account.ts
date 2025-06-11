import express, { Request, Response } from 'express';
import logger from '../utils/logger';
import { createRateLimit } from '../utils/rateLimit';
import requireNIP98Auth from '../middleware/requireNIP98Auth';
import accountService from '../services/AccountService';
import assert from 'node:assert';

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

interface PublicProfile {
  pubkey: string;
  signupDate: Date;
  tier: string;
  isActive: boolean;
}

interface AccountInfo {
  pubkey: string;
  email: string | null;
  signupDate: string;
  lastLoginDate?: string;
  status: string;
  tier: string;
  subscription: any;
  recentPayments: any[];
  totalNotificationsSent: number;
}

/**
 * Public endpoint for new user signups
 * @route POST /api/account
 */
router.post('/', signupRateLimit, async (req: Request, res: Response) => {
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

    return res.status(201).json({
      success: true,
      account
    });
  } catch (error: any) {
    logger.error(`Error during signup: ${error.message}`);
    return res.status(500).json({ error: 'Failed to register user' });
  }
});

/**
 * Public endpoint to get user profile
 * @route GET /api/account/:pubkey
 */
router.get('/:pubkey', queryAccountRateLimit, async (req: Request, res: Response) => {
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
    const publicProfile: PublicProfile = {
      pubkey: account.pubkey,
      signupDate: account.createdAt,
      tier: 'free',
      isActive: true,
    };

    return res.status(200).json({
      success: true,
      profile: publicProfile
    });
  } catch (error: any) {
    logger.error(`Error getting user profile: ${error.message}`);
    return res.status(500).json({ error: 'Failed to get user profile' });
  }
});

/**
 * Get own account information
 * @route GET /api/account
 */
router.get('/', authUser, async (req: Request, res: Response) => {
  try {
    const pubkey = req.authenticatedPubkey;
    assert(pubkey, "Pubkey should be present for authenticated user");

    const account = await accountService.getAccount(pubkey);
    if (!account) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    return res.json({
      success: true,
      account,
    });

  } catch (error: any) {
    logger.error(`Get profile error for ${req.authenticatedPubkey || 'unknown'}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to get account information' });
  }
});

export default router; 