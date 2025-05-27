const express = require('express');
const router = express.Router();
const tableStorage = require('../utils/enhancedTableStorage');
const logger = require('../utils/logger');
const { nip98Auth, extractTargetPubkey } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

/**
 * Get subscription pricing information (public endpoint)
 * @route GET /api/subscriptions/pricing
 */
router.get('/pricing', async (req, res) => {
  try {
    const pricing = {
      free: {
        tier: 'free',
        price: 0,
        features: [
          `${process.env.FREE_TIER_DAILY_LIMIT || 5} notifications per day`,
          'Basic web push notifications',
          'Community support'
        ]
      },
      premium: {
        tier: 'premium',
        monthly: {
          price: parseInt(process.env.PREMIUM_MONTHLY_PRICE) || 999,
          currency: 'USD',
          billingCycle: 'monthly'
        },
        quarterly: {
          price: parseInt(process.env.PREMIUM_QUARTERLY_PRICE) || 2497,
          currency: 'USD',
          billingCycle: 'quarterly'
        },
        yearly: {
          price: parseInt(process.env.PREMIUM_YEARLY_PRICE) || 9999,
          currency: 'USD',
          billingCycle: 'yearly'
        },
        features: [
          `${process.env.PREMIUM_TIER_DAILY_LIMIT || 50} notifications per day`,
          'Advanced notification filtering',
          'Priority support',
          'Custom notification templates'
        ]
      },
      premium_plus: {
        tier: 'premium_plus',
        monthly: {
          price: parseInt(process.env.PREMIUM_PLUS_MONTHLY_PRICE) || 1999,
          currency: 'USD',
          billingCycle: 'monthly'
        },
        quarterly: {
          price: parseInt(process.env.PREMIUM_PLUS_QUARTERLY_PRICE) || 4997,
          currency: 'USD',
          billingCycle: 'quarterly'
        },
        yearly: {
          price: parseInt(process.env.PREMIUM_PLUS_YEARLY_PRICE) || 19999,
          currency: 'USD',
          billingCycle: 'yearly'
        },
        features: [
          `${process.env.PREMIUM_PLUS_TIER_DAILY_LIMIT || 500} notifications per day`,
          'Advanced notification filtering',
          'Priority support',
          'Custom notification templates',
          'API access',
          'Webhook integrations',
          'Advanced analytics'
        ]
      }
    };

    res.status(200).json({
      success: true,
      pricing,
      currency: 'USD',
      note: 'Prices are in cents to avoid floating point precision issues'
    });
  } catch (error) {
    logger.error(`Error getting pricing information: ${error.message}`);
    res.status(500).json({ error: 'Failed to get pricing information' });
  }
});

/**
 * Get current subscription status (authenticated)
 * @route GET /api/subscriptions/status
 */
router.get('/status', nip98Auth, async (req, res) => {
  try {
    const targetPubkey = extractTargetPubkey(req);
    
    if (!targetPubkey) {
      return res.status(400).json({ error: 'Invalid or unauthorized access' });
    }

    const subscriptionStatus = await tableStorage.getSubscriptionStatus(targetPubkey);
    
    // Get usage statistics
    const notificationCount = await tableStorage.get24HourNotificationCount(targetPubkey);
    const devices = await tableStorage.getUserSubscriptions(targetPubkey);

    const response = {
      subscription: subscriptionStatus,
      usage: {
        notificationsLast24h: notificationCount,
        dailyLimit: subscriptionStatus.tier === 'free' 
          ? parseInt(process.env.FREE_TIER_DAILY_LIMIT) || 5
          : subscriptionStatus.tier === 'premium'
          ? parseInt(process.env.PREMIUM_TIER_DAILY_LIMIT) || 50
          : parseInt(process.env.PREMIUM_PLUS_TIER_DAILY_LIMIT) || 500,
        devicesRegistered: devices.length
      }
    };

    res.status(200).json({
      success: true,
      ...response
    });
  } catch (error) {
    logger.error(`Error getting subscription status: ${error.message}`);
    res.status(500).json({ error: 'Failed to get subscription status' });
  }
});

/**
 * Create payment intent for subscription upgrade
 * @route POST /api/subscriptions/create-payment-intent
 */
router.post('/create-payment-intent', nip98Auth, async (req, res) => {
  try {
    const { tier, billingCycle } = req.body;
    const pubkey = req.authenticatedPubkey;

    if (!tier || !['premium', 'premium_plus'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid subscription tier' });
    }

    if (!billingCycle || !['monthly', 'quarterly', 'yearly'].includes(billingCycle)) {
      return res.status(400).json({ error: 'Invalid billing cycle' });
    }

    // Get pricing
    const priceMap = {
      premium: {
        monthly: parseInt(process.env.PREMIUM_MONTHLY_PRICE) || 999,
        quarterly: parseInt(process.env.PREMIUM_QUARTERLY_PRICE) || 2497,
        yearly: parseInt(process.env.PREMIUM_YEARLY_PRICE) || 9999
      },
      premium_plus: {
        monthly: parseInt(process.env.PREMIUM_PLUS_MONTHLY_PRICE) || 1999,
        quarterly: parseInt(process.env.PREMIUM_PLUS_QUARTERLY_PRICE) || 4997,
        yearly: parseInt(process.env.PREMIUM_PLUS_YEARLY_PRICE) || 19999
      }
    };

    const amount = priceMap[tier][billingCycle];
    const paymentIntentId = `pi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // In a real implementation, you would integrate with a payment processor like Stripe
    // For now, we'll create a mock payment intent
    const paymentIntent = {
      id: paymentIntentId,
      amount,
      currency: 'USD',
      tier,
      billingCycle,
      pubkey,
      status: 'requires_payment_method',
      created: new Date().toISOString(),
      // In production, include client_secret for frontend
      metadata: {
        pubkey,
        tier,
        billingCycle
      }
    };

    // Store the payment intent temporarily (in production, this would be handled by the payment processor)
    await tableStorage.upsertEntity(pubkey, `payment-intent-${paymentIntentId}`, {
      ...paymentIntent,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 minutes
    });

    logger.info(`Payment intent created for user ${pubkey.substring(0, 16)}... - ${tier} ${billingCycle}`);

    res.status(201).json({
      success: true,
      paymentIntent,
      message: 'Payment intent created successfully. Complete payment to activate subscription.'
    });
  } catch (error) {
    logger.error(`Error creating payment intent: ${error.message}`);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

/**
 * Mock payment completion endpoint (in production, this would be a webhook from payment processor)
 * @route POST /api/subscriptions/complete-payment
 */
router.post('/complete-payment', nip98Auth, async (req, res) => {
  try {
    const { paymentIntentId, transactionId, method } = req.body;
    const pubkey = req.authenticatedPubkey;

    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Payment intent ID is required' });
    }

    // Get the payment intent
    const paymentIntent = await tableStorage.getEntity(pubkey, `payment-intent-${paymentIntentId}`);
    if (!paymentIntent) {
      return res.status(404).json({ error: 'Payment intent not found' });
    }

    // Check if payment intent has expired
    if (new Date() > new Date(paymentIntent.expiresAt)) {
      return res.status(400).json({ error: 'Payment intent has expired' });
    }

    // Record the payment
    const paymentData = {
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      method: method || 'card',
      tier: paymentIntent.tier,
      billingCycle: paymentIntent.billingCycle,
      transactionId: transactionId || `txn_${Date.now()}`,
      paymentIntentId,
      status: 'completed'
    };

    await tableStorage.recordPayment(pubkey, paymentData);

    // Calculate subscription expiry date
    const startDate = new Date();
    let expiryDate;
    
    switch (paymentIntent.billingCycle) {
      case 'monthly':
        expiryDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
        break;
      case 'quarterly':
        expiryDate = new Date(startDate.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days
        break;
      case 'yearly':
        expiryDate = new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000); // 365 days
        break;
    }

    // Update subscription
    const subscriptionData = {
      tier: paymentIntent.tier,
      billingCycle: paymentIntent.billingCycle,
      startDate: startDate.toISOString(),
      expiryDate: expiryDate.toISOString(),
      isActive: true,
      autoRenew: true,
      lastPaymentDate: new Date().toISOString(),
      dailyNotificationLimit: paymentIntent.tier === 'premium' 
        ? parseInt(process.env.PREMIUM_TIER_DAILY_LIMIT) || 50
        : parseInt(process.env.PREMIUM_PLUS_TIER_DAILY_LIMIT) || 500
    };

    await tableStorage.upsertSubscription(pubkey, subscriptionData);

    // Clean up payment intent
    // Note: In Azure Table Storage, you'd typically set a TTL or clean up expired entities with a background job

    logger.info(`Payment completed for user ${pubkey.substring(0, 16)}... - ${paymentIntent.tier} ${paymentIntent.billingCycle}`);

    res.status(200).json({
      success: true,
      message: 'Payment completed successfully. Subscription activated.',
      subscription: subscriptionData,
      payment: paymentData
    });
  } catch (error) {
    logger.error(`Error completing payment: ${error.message}`);
    res.status(500).json({ error: 'Failed to complete payment' });
  }
});

/**
 * Process subscription upgrade/change (authenticated)
 * @route POST /api/subscriptions/upgrade
 */
router.post('/upgrade', nip98Auth, async (req, res) => {
  try {
    const pubkey = req.authenticatedPubkey;
    const { tier, billingCycle, paymentMethod, paymentToken } = req.body;

    // Validate input
    const validTiers = ['premium', 'premium_plus'];
    const validCycles = ['monthly', 'quarterly', 'yearly'];

    if (!validTiers.includes(tier)) {
      return res.status(400).json({ error: 'Invalid subscription tier' });
    }

    if (!validCycles.includes(billingCycle)) {
      return res.status(400).json({ error: 'Invalid billing cycle' });
    }

    // Get current subscription
    const currentSubscription = await tableStorage.getCurrentSubscription(pubkey);
    const currentStatus = await tableStorage.getSubscriptionStatus(pubkey);

    // Calculate pricing
    let price;
    if (tier === 'premium') {
      switch (billingCycle) {
        case 'monthly':
          price = parseInt(process.env.PREMIUM_MONTHLY_PRICE) || 999;
          break;
        case 'quarterly':
          price = parseInt(process.env.PREMIUM_QUARTERLY_PRICE) || 2497;
          break;
        case 'yearly':
          price = parseInt(process.env.PREMIUM_YEARLY_PRICE) || 9999;
          break;
      }
    } else { // premium_plus
      switch (billingCycle) {
        case 'monthly':
          price = parseInt(process.env.PREMIUM_PLUS_MONTHLY_PRICE) || 1999;
          break;
        case 'quarterly':
          price = parseInt(process.env.PREMIUM_PLUS_QUARTERLY_PRICE) || 4997;
          break;
        case 'yearly':
          price = parseInt(process.env.PREMIUM_PLUS_YEARLY_PRICE) || 19999;
          break;
      }
    }

    // Calculate new expiry date
    const now = new Date();
    let expiryDate;
    switch (billingCycle) {
      case 'monthly':
        expiryDate = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
        break;
      case 'quarterly':
        expiryDate = new Date(now.getTime() + (90 * 24 * 60 * 60 * 1000));
        break;
      case 'yearly':
        expiryDate = new Date(now.getTime() + (365 * 24 * 60 * 60 * 1000));
        break;
    }

    // In a real implementation, you would process the payment here
    // For now, we'll simulate a successful payment
    const paymentData = {
      amount: price,
      currency: 'USD',
      tier,
      billingCycle,
      paymentMethod: paymentMethod || 'simulation',
      paymentToken: paymentToken || 'sim_' + uuidv4(),
      status: 'completed',
      transactionId: 'txn_' + uuidv4(),
      processedAt: new Date().toISOString()
    };

    // Record the payment
    await tableStorage.recordPayment(pubkey, paymentData);

    // Update subscription
    const newSubscription = {
      tier,
      isActive: true,
      startDate: currentStatus.isActive ? currentSubscription.startDate : now.toISOString(),
      expiryDate: expiryDate.toISOString(),
      billingCycle,
      autoRenew: true,
      upgradeDate: now.toISOString(),
      lastPaymentAmount: price,
      lastPaymentDate: now.toISOString(),
      dailyNotificationLimit: tier === 'premium' 
        ? parseInt(process.env.PREMIUM_TIER_DAILY_LIMIT) || 50
        : parseInt(process.env.PREMIUM_PLUS_TIER_DAILY_LIMIT) || 500
    };

    await tableStorage.upsertSubscription(pubkey, newSubscription);

    logger.info(`Subscription upgraded for user ${pubkey.substring(0, 16)}... to ${tier} (${billingCycle})`);

    res.json({
      success: true,
      message: 'Subscription upgraded successfully',
      subscription: newSubscription,
      payment: {
        amount: paymentData.amount,
        transactionId: paymentData.transactionId
      }
    });

  } catch (error) {
    logger.error(`Subscription upgrade error for ${req.authenticatedPubkey}: ${error.message}`);
    res.status(500).json({ error: 'Failed to upgrade subscription' });
  }
});

/**
 * Cancel subscription (authenticated)
 * @route POST /api/subscriptions/cancel
 */
router.post('/cancel', nip98Auth, async (req, res) => {
  try {
    const pubkey = req.authenticatedPubkey;
    const { immediate = false } = req.body;

    const currentSubscription = await tableStorage.getCurrentSubscription(pubkey);
    if (!currentSubscription) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    const cancelledSubscription = {
      ...currentSubscription,
      autoRenew: false,
      cancelledAt: new Date().toISOString(),
      cancelledBy: pubkey,
      isActive: immediate ? false : currentSubscription.isActive, // Keep active until expiry unless immediate
      cancellationType: immediate ? 'immediate' : 'end_of_period'
    };

    // If immediate cancellation, downgrade to free tier
    if (immediate) {
      cancelledSubscription.tier = 'free';
      cancelledSubscription.expiryDate = new Date().toISOString();
      cancelledSubscription.dailyNotificationLimit = parseInt(process.env.FREE_TIER_DAILY_LIMIT) || 5;
    }

    await tableStorage.upsertSubscription(pubkey, cancelledSubscription);

    logger.info(`Subscription cancelled for user ${pubkey.substring(0, 16)}... (${immediate ? 'immediate' : 'end of period'})`);

    res.json({
      success: true,
      message: immediate 
        ? 'Subscription cancelled immediately' 
        : 'Subscription will not renew and will expire on the current period end date',
      subscription: cancelledSubscription
    });

  } catch (error) {
    logger.error(`Subscription cancellation error for ${req.authenticatedPubkey}: ${error.message}`);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

/**
 * Get payment history (authenticated)
 * @route GET /api/subscriptions/payments
 */
router.get('/payments', nip98Auth, async (req, res) => {
  try {
    const pubkey = req.authenticatedPubkey;
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);

    const payments = await tableStorage.getPaymentHistory(pubkey, limit);

    res.json({
      success: true,
      payments: payments.map(payment => ({
        amount: payment.amount,
        currency: payment.currency,
        tier: payment.tier,
        billingCycle: payment.billingCycle,
        status: payment.status,
        transactionId: payment.transactionId,
        processedAt: payment.processedAt,
        createdAt: payment.createdAt
      }))
    });

  } catch (error) {
    logger.error(`Get payment history error for ${req.authenticatedPubkey}: ${error.message}`);
    res.status(500).json({ error: 'Failed to get payment history' });
  }
});

/**
 * Update subscription auto-renewal setting
 * @route PUT /api/subscriptions/auto-renew
 */
router.put('/auto-renew', nip98Auth, async (req, res) => {
  try {
    const targetPubkey = extractTargetPubkey(req);
    const { autoRenew } = req.body;
    
    if (!targetPubkey) {
      return res.status(400).json({ error: 'Invalid or unauthorized access' });
    }

    if (typeof autoRenew !== 'boolean') {
      return res.status(400).json({ error: 'Auto-renew must be a boolean value' });
    }

    const currentSubscription = await tableStorage.getCurrentSubscription(targetPubkey);
    if (!currentSubscription) {
      return res.status(404).json({ error: 'No subscription found' });
    }

    if (currentSubscription.tier === 'free') {
      return res.status(400).json({ error: 'Cannot set auto-renew for free tier' });
    }

    // Update auto-renew setting
    const updatedSubscription = {
      ...currentSubscription,
      autoRenew,
      autoRenewUpdatedAt: new Date().toISOString()
    };

    await tableStorage.upsertSubscription(targetPubkey, updatedSubscription);

    logger.info(`Auto-renew ${autoRenew ? 'enabled' : 'disabled'} for user ${targetPubkey.substring(0, 16)}...`);

    res.status(200).json({
      success: true,
      message: `Auto-renew ${autoRenew ? 'enabled' : 'disabled'} successfully`,
      autoRenew
    });
  } catch (error) {
    logger.error(`Error updating auto-renew setting: ${error.message}`);
    res.status(500).json({ error: 'Failed to update auto-renew setting' });
  }
});

// All routes with authentication require activity logging
router.use((req, res, next) => {
  // Skip logging for public routes (no authentication)
  if (!req.authenticatedPubkey) {
    return next();
  }

  const originalSend = res.send;
  res.send = function(data) {
    // Log the action after successful completion
    if (res.statusCode < 400 && req.authenticatedPubkey) {
      const action = `Subscription ${req.method} ${req.path}`;
      
      // Async log user activity (don't wait for it)
      tableStorage.logUserActivity(
        req.authenticatedPubkey,
        action,
        {
          method: req.method,
          path: req.path,
          body: req.body,
          statusCode: res.statusCode,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          timestamp: new Date().toISOString()
        }
      ).catch(error => {
        logger.error(`Failed to log subscription activity: ${error.message}`);
      });

      logger.info(`Subscription operation: ${req.authenticatedPubkey.substring(0, 16)}... performed ${action}`, {
        pubkey: req.authenticatedPubkey.substring(0, 16) + '...',
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        ipAddress: req.ip
      });
    }
    
    originalSend.call(this, data);
  };
  
  next();
});

module.exports = router;
