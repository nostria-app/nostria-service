const express = require('express');
const router = express.Router();
const { accountsService } = require('../utils/AccountsTableService');
const { subscriptionsService } = require('../utils/SubscriptionsTableService');
const { paymentsService } = require('../utils/PaymentsTableService');
const logger = require('../utils/logger');
const { nip98Auth } = require('../middleware/auth');
const logUserActivity = require('../middleware/logUserActivity');
const {
  signupLimiter,
  authenticatedLimiter,
} = require('../middleware/rateLimiting')

// combined middleware to be used for routes requiring
// authenticated user
const authUser = [authenticatedLimiter, nip98Auth, logUserActivity]
const publicApi = [signupLimiter]

/**
 * Public endpoint for new user signups
 * @route POST /api/account
 */
router.post('/', publicApi, async (req, res) => {
  try {
    const { pubkey, email, referralCode } = req.body;

    if (!pubkey) {
      return res.status(400).json({ error: 'Public key is required' });
    }

    // Check if user already exists
    const existingUser = await accountsService.getEntity(pubkey, 'profile');
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

    await accountsService.upsertEntity(pubkey, 'profile', userProfile);

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

    await subscriptionsService.upsertSubscription(pubkey, freeSubscription);

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
 * Public endpoint to get user profile
 * @route GET /api/account/:pubkey
 */
router.get('/:pubkey', publicApi, async (req, res) => {
  try {
    const targetPubkey = req.params.pubkey;

    if (!targetPubkey) {
      return res.status(400).json({ error: 'Public key is required' });
    }

    // Get user profile
    const profile = await accountsService.getEntity(targetPubkey, 'profile');
    if (!profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get subscription status
    const subscriptionStatus = await subscriptionsService.getSubscriptionStatus(targetPubkey);

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
 * Get own account information
 * @route GET /api/account
 */
router.get('/', authUser, async (req, res) => {
  try {
    const pubkey = req.authenticatedPubkey;

    // Get user profile
    const profile = await accountsService.getEntity(pubkey, 'profile');
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Get subscription status
    const subscriptionStatus = await subscriptionsService.getSubscriptionStatus(pubkey);

    // Get recent payment history (limited)
    const paymentHistory = await paymentsService.getPaymentHistory(pubkey, 5);

    const accountInfo = {
      pubkey: profile.pubkey,
      email: profile.email,
      signupDate: profile.signupDate,
      lastLoginDate: profile.lastLoginDate,
      status: profile.status,
      tier: subscriptionStatus.tier,
      subscription: subscriptionStatus,
      recentPayments: paymentHistory.slice(0, 3), // Only show last 3
      totalNotificationsSent: profile.totalNotificationsSent || 0
    };

    res.json({
      success: true,
      account: accountInfo
    });

  } catch (error) {
    logger.error(`Get profile error for ${req.authenticatedPubkey}: ${error.message}`);
    res.status(500).json({ error: 'Failed to get account information' });
  }
});

/**
 * Update account profile
 * @route PUT /api/account
 */
router.put('/', authUser, async (req, res) => {
  try {
    const pubkey = req.authenticatedPubkey;
    const { email, metadata } = req.body;

    // Get existing profile
    const existingProfile = await accountsService.getEntity(pubkey, 'profile');
    if (!existingProfile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Update profile with new data
    const updatedProfile = {
      ...existingProfile,
      email: email !== undefined ? email : existingProfile.email,
      metadata: metadata !== undefined ? { ...existingProfile.metadata, ...metadata } : existingProfile.metadata,
      lastUpdated: new Date().toISOString()
    };

    await accountsService.upsertEntity(pubkey, 'profile', updatedProfile);

    logger.info(`Profile updated by user ${pubkey.substring(0, 16)}...`);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      profile: {
        email: updatedProfile.email,
        lastUpdated: updatedProfile.lastUpdated
      }
    });

  } catch (error) {
    logger.error(`Update profile error for ${req.authenticatedPubkey}: ${error.message}`);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * Get subscription details
 * @route GET /api/account/subscription
 */
router.get('/subscription', authUser, async (req, res) => {
  try {
    const pubkey = req.authenticatedPubkey;

    const subscription = await subscriptionsService.getCurrentSubscription(pubkey);
    const subscriptionStatus = await subscriptionsService.getSubscriptionStatus(pubkey);

    if (!subscription) {
      return res.status(404).json({ error: 'No subscription found' });
    }

    res.json({
      success: true,
      subscription: {
        ...subscription,
        status: subscriptionStatus
      }
    });

  } catch (error) {
    logger.error(`Get subscription error for ${req.authenticatedPubkey}: ${error.message}`);
    res.status(500).json({ error: 'Failed to get subscription details' });
  }
});

/**
 * Get payment history
 * @route GET /api/account/payments
 */
router.get('/payments', authUser, async (req, res) => {
  try {
    const pubkey = req.authenticatedPubkey;
    const limit = parseInt(req.query.limit) || 25;

    const payments = await paymentsService.getPaymentHistory(pubkey, Math.min(limit, 100));

    res.json({
      success: true,
      payments: payments.map(payment => ({
        ...payment,
        // Remove sensitive internal data
        partitionKey: undefined,
        rowKey: payment.rowKey
      }))
    });

  } catch (error) {
    logger.error(`Get payments error for ${req.authenticatedPubkey}: ${error.message}`);
    res.status(500).json({ error: 'Failed to get payment history' });
  }
});

/**
 * Update subscription preferences
 * @route PUT /api/account/subscription/preferences
 */
router.put('/subscription/preferences', authUser, async (req, res) => {
  try {
    const pubkey = req.authenticatedPubkey;
    const { autoRenew, billingCycle } = req.body;

    const currentSubscription = await subscriptionsService.getCurrentSubscription(pubkey);
    if (!currentSubscription) {
      return res.status(404).json({ error: 'No subscription found' });
    }

    // Validate billing cycle if provided
    const validCycles = ['monthly', 'quarterly', 'yearly'];
    if (billingCycle && !validCycles.includes(billingCycle)) {
      return res.status(400).json({ error: 'Invalid billing cycle' });
    }

    const updatedSubscription = {
      ...currentSubscription,
      autoRenew: autoRenew !== undefined ? autoRenew : currentSubscription.autoRenew,
      billingCycle: billingCycle || currentSubscription.billingCycle,
      updatedAt: new Date().toISOString()
    };

    await subscriptionsService.upsertSubscription(pubkey, updatedSubscription);

    logger.info(`Subscription preferences updated by user ${pubkey.substring(0, 16)}...`);

    res.json({
      success: true,
      message: 'Subscription preferences updated',
      preferences: {
        autoRenew: updatedSubscription.autoRenew,
        billingCycle: updatedSubscription.billingCycle
      }
    });

  } catch (error) {
    logger.error(`Update subscription preferences error for ${req.authenticatedPubkey}: ${error.message}`);
    res.status(500).json({ error: 'Failed to update subscription preferences' });
  }
});

/**
 * Get notification usage statistics
 * @route GET /api/account/usage
 */
router.get('/usage', authUser, async (req, res) => {
  try {
    const pubkey = req.authenticatedPubkey;

    // Get current subscription to check limits
    const subscriptionStatus = await subscriptionsService.getSubscriptionStatus(pubkey);

    // Get 24-hour notification count
    const count24h = await subscriptionsService.get24HourNotificationCount(pubkey);

    // Get profile for total notifications
    const profile = await accountsService.getEntity(pubkey, 'profile');

    const usage = {
      current24Hours: count24h,
      dailyLimit: subscriptionStatus.tier === 'free'
        ? parseInt(process.env.FREE_TIER_DAILY_LIMIT) || 5
        : subscriptionStatus.tier === 'premium'
          ? parseInt(process.env.PREMIUM_TIER_DAILY_LIMIT) || 50
          : parseInt(process.env.PREMIUM_PLUS_TIER_DAILY_LIMIT) || 500,
      totalAllTime: profile?.totalNotificationsSent || 0,
      percentageUsed: Math.round((count24h / (subscriptionStatus.tier === 'free'
        ? parseInt(process.env.FREE_TIER_DAILY_LIMIT) || 5
        : subscriptionStatus.tier === 'premium'
          ? parseInt(process.env.PREMIUM_TIER_DAILY_LIMIT) || 50
          : parseInt(process.env.PREMIUM_PLUS_TIER_DAILY_LIMIT) || 500)) * 100),
      tier: subscriptionStatus.tier
    };

    res.json({
      success: true,
      usage
    });

  } catch (error) {
    logger.error(`Get usage error for ${req.authenticatedPubkey}: ${error.message}`);
    res.status(500).json({ error: 'Failed to get usage statistics' });
  }
});

/**
 * Delete account (self-deletion)
 * @route DELETE /api/account
 */
router.delete('/', authUser, async (req, res) => {
  try {
    const pubkey = req.authenticatedPubkey;
    const { confirmPubkey } = req.body;

    // Double-check confirmation
    if (confirmPubkey !== pubkey) {
      return res.status(400).json({ error: 'Confirmation pubkey does not match' });
    }

    // Note: In a real implementation, you might want to:
    // 1. Cancel active subscriptions
    // 2. Process any pending refunds
    // 3. Delete user data according to GDPR/privacy requirements
    // 4. Send confirmation email

    // For now, we'll just mark the profile as deleted
    const profile = await accountsService.getEntity(pubkey, 'profile');
    if (profile) {
      const deletedProfile = {
        ...profile,
        status: 'deleted',
        deletedAt: new Date().toISOString(),
        email: null, // Remove PII
        metadata: {} // Clear metadata
      };

      await accountsService.upsertEntity(pubkey, 'profile', deletedProfile);
    }

    // Cancel subscription
    const subscription = await subscriptionsService.getCurrentSubscription(pubkey);
    if (subscription) {
      const cancelledSubscription = {
        ...subscription,
        isActive: false,
        cancelledAt: new Date().toISOString(),
        autoRenew: false
      };

      await subscriptionsService.upsertSubscription(pubkey, cancelledSubscription);
    }

    logger.warn(`Account deletion requested by user ${pubkey.substring(0, 16)}...`);

    res.json({
      success: true,
      message: 'Account deletion initiated. Your account has been deactivated.'
    });

  } catch (error) {
    logger.error(`Delete account error for ${req.authenticatedPubkey}: ${error.message}`);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

module.exports = router;
