const express = require('express');
const router = express.Router();
const tableStorage = require('../utils/enhancedTableStorage');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Public endpoint for new user signups
 * @route POST /api/signup
 */
router.post('/', async (req, res) => {
  try {
    const { pubkey, email, referralCode } = req.body;

    if (!pubkey) {
      return res.status(400).json({ error: 'Public key is required' });
    }

    // Check if user already exists
    const existingUser = await tableStorage.getEntity(pubkey, 'profile');
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Create user profile
    const userProfile = {
      pubkey,
      email: email || null,
      referralCode: referralCode || null,
      signupDate: new Date().toISOString(),
      status: 'active',
      tier: 'free'
    };

    await tableStorage.upsertEntity(pubkey, 'profile', userProfile);

    // Initialize free subscription
    const freeSubscription = {
      tier: 'free',
      isActive: true,
      startDate: new Date().toISOString(),
      expiryDate: null, // Free tier doesn't expire
      billingCycle: null,
      autoRenew: false,
      dailyNotificationLimit: parseInt(process.env.FREE_TIER_DAILY_LIMIT) || 5
    };

    await tableStorage.upsertSubscription(pubkey, freeSubscription);

    logger.info(`New user signup: ${pubkey.substring(0, 16)}... with email: ${email || 'none'}`);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        pubkey,
        tier: 'free',
        signupDate: userProfile.signupDate
      }
    });
  } catch (error) {
    logger.error(`Error during signup: ${error.message}`);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

/**
 * Get user profile (public endpoint with optional details based on authentication)
 * @route GET /api/signup/profile/:pubkey
 */
router.get('/profile/:pubkey', async (req, res) => {
  try {
    const targetPubkey = req.params.pubkey;

    if (!targetPubkey) {
      return res.status(400).json({ error: 'Public key is required' });
    }

    // Get user profile
    const profile = await tableStorage.getEntity(targetPubkey, 'profile');
    if (!profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get subscription status
    const subscriptionStatus = await tableStorage.getSubscriptionStatus(targetPubkey);

    // Public profile information
    const publicProfile = {
      pubkey: profile.pubkey,
      signupDate: profile.signupDate,
      tier: subscriptionStatus.tier,
      isActive: subscriptionStatus.isActive
    };

    res.status(200).json({
      success: true,
      profile: publicProfile
    });
  } catch (error) {
    logger.error(`Error getting user profile: ${error.message}`);
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

/**
 * Check if a public key is available for signup
 * @route GET /api/signup/check/:pubkey
 */
router.get('/check/:pubkey', async (req, res) => {
  try {
    const { pubkey } = req.params;

    if (!pubkey) {
      return res.status(400).json({ error: 'Public key is required' });
    }

    const existingUser = await tableStorage.getEntity(pubkey, 'profile');
    const isAvailable = !existingUser;

    res.status(200).json({
      success: true,
      pubkey,
      available: isAvailable,
      message: isAvailable ? 'Public key is available' : 'Public key is already registered'
    });
  } catch (error) {
    logger.error(`Error checking pubkey availability: ${error.message}`);
    res.status(500).json({ error: 'Failed to check pubkey availability' });
  }
});

/**
 * Get signup statistics (public endpoint)
 * @route GET /api/signup/stats
 */
router.get('/stats', async (req, res) => {
  try {
    // This is a simplified version - in production you might want to cache these stats
    // and update them periodically rather than querying in real-time
    
    const stats = {
      totalUsers: 'Coming soon', // Would require scanning all entities or maintaining counters
      freeUsers: 'Coming soon',
      premiumUsers: 'Coming soon',
      premiumPlusUsers: 'Coming soon',
      signupsToday: 'Coming soon',
      message: 'Detailed statistics will be available in a future update'
    };

    res.status(200).json({
      success: true,
      stats
    });
  } catch (error) {
    logger.error(`Error getting signup stats: ${error.message}`);
    res.status(500).json({ error: 'Failed to get signup statistics' });
  }
});

/**
 * Get subscription tiers and pricing (public endpoint)
 * @route GET /api/signup/pricing
 */
router.get('/pricing', (req, res) => {
  try {
    const pricing = {
      free: {
        tier: 'free',
        price: 0,
        dailyLimit: parseInt(process.env.FREE_TIER_DAILY_LIMIT) || 5,
        features: ['Basic notifications', 'Email support']
      },
      premium: {
        tier: 'premium',
        dailyLimit: parseInt(process.env.PREMIUM_TIER_DAILY_LIMIT) || 50,
        features: ['Increased notification limit', 'Priority support', 'Custom templates'],
        pricing: {
          monthly: {
            price: parseInt(process.env.PREMIUM_MONTHLY_PRICE) || 999,
            priceDisplay: '$9.99/month'
          },
          quarterly: {
            price: parseInt(process.env.PREMIUM_QUARTERLY_PRICE) || 2497,
            priceDisplay: '$24.97/quarter',
            savings: 'Save 17%'
          },
          yearly: {
            price: parseInt(process.env.PREMIUM_YEARLY_PRICE) || 9999,
            priceDisplay: '$99.99/year',
            savings: 'Save 17%'
          }
        }
      },
      premium_plus: {
        tier: 'premium_plus',
        dailyLimit: parseInt(process.env.PREMIUM_PLUS_TIER_DAILY_LIMIT) || 500,
        features: ['Unlimited notifications', 'Premium support', 'Custom integrations', 'Analytics'],
        pricing: {
          monthly: {
            price: parseInt(process.env.PREMIUM_PLUS_MONTHLY_PRICE) || 1999,
            priceDisplay: '$19.99/month'
          },
          quarterly: {
            price: parseInt(process.env.PREMIUM_PLUS_QUARTERLY_PRICE) || 4997,
            priceDisplay: '$49.97/quarter',
            savings: 'Save 17%'
          },
          yearly: {
            price: parseInt(process.env.PREMIUM_PLUS_YEARLY_PRICE) || 19999,
            priceDisplay: '$199.99/year',
            savings: 'Save 17%'
          }
        }
      }
    };

    res.json({
      success: true,
      pricing
    });
  } catch (error) {
    logger.error(`Pricing endpoint error: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
