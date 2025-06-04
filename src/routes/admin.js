const express = require('express');
const router = express.Router();
const { accountsService } = require('../utils/AccountsTableService');
const { subscriptionsService } = require('../utils/SubscriptionsTableService');
const { paymentsService } = require('../utils/PaymentsTableService');
const { adminAuditService } = require('../utils/AdminAuditTableService');
const { userActivityService } = require('../utils/UserActivityTableService');
const { subscriptionHistoryService } = require('../utils/SubscriptionHistoryTableService');
const logger = require('../utils/logger');
const { nip98Auth, adminAuth, extractTargetPubkey } = require('../middleware/auth');

// All admin routes require NIP-98 authentication and admin privileges
router.use(nip98Auth);
router.use(adminAuth);

// Middleware to log all admin actions
router.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function(data) {
    // Log the action after successful completion
    if (res.statusCode < 400) {
      const action = `${req.method} ${req.path}`;
      const details = {
        method: req.method,
        path: req.path,
        body: req.body,
        params: req.params,
        query: req.query,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      };
      
      const targetPubkey = extractTargetPubkey(req);
      
      // Async log (don't wait for it)
      adminAuditService.logAdminAction(
        req.authenticatedPubkey,
        action,
        details,
        targetPubkey
      ).catch(error => {
        logger.error(`Failed to log admin action: ${error.message}`);
      });
    }
    
    originalSend.call(this, data);
  };
  
  next();
});

/**
 * Get all users with pagination
 * @route GET /api/admin/users
 */
router.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Max 100 per page
    const search = req.query.search;

    // This is a simplified implementation - in production you'd want proper pagination
    // For Azure Table Storage, you'd typically use continuation tokens
    let query = '';
    if (search) {
      query = `PartitionKey ge '${search}' and PartitionKey lt '${search}z'`;
    }

    const allEntities = await accountsService.queryEntities(query);
    
    // Filter to only profile entities and paginate
    const profiles = allEntities
      .filter(entity => entity.rowKey === 'profile')
      .slice((page - 1) * limit, page * limit);

    // Enrich with subscription data
    const enrichedProfiles = await Promise.all(
      profiles.map(async (profile) => {
        const subscriptionStatus = await subscriptionsService.getSubscriptionStatus(profile.partitionKey);
        return {
          pubkey: profile.partitionKey,
          email: profile.email,
          signupDate: profile.signupDate,
          status: profile.status,
          tier: subscriptionStatus.tier,
          isActive: subscriptionStatus.isActive,
          expiryDate: subscriptionStatus.expiryDate
        };
      })
    );

    res.status(200).json({
      success: true,
      users: enrichedProfiles,
      pagination: {
        page,
        limit,
        hasMore: allEntities.filter(e => e.rowKey === 'profile').length > page * limit
      }
    });
  } catch (error) {
    logger.error(`Error getting users list: ${error.message}`);
    res.status(500).json({ error: 'Failed to get users list' });
  }
});

/**
 * Get detailed user information
 * @route GET /api/admin/users/:pubkey
 */
router.get('/users/:pubkey', async (req, res) => {
  try {
    const { pubkey } = req.params;

    // Get user profile
    const profile = await accountsService.getEntity(pubkey, 'profile');
    if (!profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get subscription status
    const subscriptionStatus = await subscriptionsService.getSubscriptionStatus(pubkey);
    
    // Get payment history
    const paymentHistory = await paymentsService.getPaymentHistory(pubkey, 10);
    
    // Get notification count for last 24 hours
    const notificationCount = await subscriptionsService.get24HourNotificationCount(pubkey);
    
    // Get user's devices
    const devices = await subscriptionsService.getUserSubscriptions(pubkey);

    const userDetails = {
      profile: {
        pubkey: profile.pubkey,
        email: profile.email,
        signupDate: profile.signupDate,
        status: profile.status,
        referralCode: profile.referralCode
      },
      subscription: subscriptionStatus,
      recentPayments: paymentHistory,
      usage: {
        notificationsLast24h: notificationCount,
        devicesRegistered: devices.length
      },
      devices: devices.map(device => ({
        deviceKey: device.rowKey,
        createdAt: device.createdAt,
        updatedAt: device.updatedAt
      }))
    };

    res.status(200).json({
      success: true,
      user: userDetails
    });
  } catch (error) {
    logger.error(`Error getting user details: ${error.message}`);
    res.status(500).json({ error: 'Failed to get user details' });
  }
});

/**
 * Update user subscription
 * @route PUT /api/admin/users/:pubkey/subscription
 */
router.put('/users/:pubkey/subscription', async (req, res) => {
  try {
    const { pubkey } = req.params;
    const { tier, billingCycle, expiryDate, autoRenew } = req.body;

    if (!tier || !['free', 'premium', 'premium_plus'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid subscription tier' });
    }

    if (tier !== 'free' && !billingCycle) {
      return res.status(400).json({ error: 'Billing cycle required for paid subscriptions' });
    }

    // Get current subscription
    const currentSubscription = await subscriptionsService.getCurrentSubscription(pubkey);
    if (!currentSubscription) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Calculate daily notification limit based on tier
    let dailyNotificationLimit;
    switch (tier) {
      case 'premium':
        dailyNotificationLimit = parseInt(process.env.PREMIUM_TIER_DAILY_LIMIT) || 50;
        break;
      case 'premium_plus':
        dailyNotificationLimit = parseInt(process.env.PREMIUM_PLUS_TIER_DAILY_LIMIT) || 500;
        break;
      default:
        dailyNotificationLimit = parseInt(process.env.FREE_TIER_DAILY_LIMIT) || 5;
    }

    const updatedSubscription = {
      tier,
      billingCycle: tier === 'free' ? null : billingCycle,
      expiryDate: tier === 'free' ? null : expiryDate,
      autoRenew: tier === 'free' ? false : (autoRenew || false),
      isActive: true,
      dailyNotificationLimit,
      updatedBy: req.authenticatedPubkey,
      adminUpdate: true
    };

    await subscriptionsService.upsertSubscription(pubkey, updatedSubscription);

    logger.info(`Admin ${req.authenticatedPubkey.substring(0, 16)}... updated subscription for user ${pubkey.substring(0, 16)}... to ${tier}`);

    res.status(200).json({
      success: true,
      message: 'Subscription updated successfully',
      subscription: updatedSubscription
    });
  } catch (error) {
    logger.error(`Error updating user subscription: ${error.message}`);
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

/**
 * Record a manual payment (for admin use)
 * @route POST /api/admin/users/:pubkey/payments
 */
router.post('/users/:pubkey/payments', async (req, res) => {
  try {
    const { pubkey } = req.params;
    const { amount, currency, method, tier, billingCycle, transactionId, notes } = req.body;

    if (!amount || !currency || !method || !tier) {
      return res.status(400).json({ error: 'Amount, currency, method, and tier are required' });
    }

    const paymentData = {
      amount: parseInt(amount), // Store in cents to avoid floating point issues
      currency: currency.toUpperCase(),
      method,
      tier,
      billingCycle,
      transactionId: transactionId || `admin-${Date.now()}`,
      status: 'completed',
      notes: notes || 'Manual payment recorded by admin',
      recordedBy: req.authenticatedPubkey,
      adminRecorded: true
    };

    const payment = await paymentsService.recordPayment(pubkey, paymentData);

    logger.info(`Admin ${req.authenticatedPubkey.substring(0, 16)}... recorded payment for user ${pubkey.substring(0, 16)}... - ${amount} ${currency}`);

    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      payment
    });
  } catch (error) {
    logger.error(`Error recording payment: ${error.message}`);
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

/**
 * Deactivate/suspend user account
 * @route PUT /api/admin/users/:pubkey/status
 */
router.put('/users/:pubkey/status', async (req, res) => {
  try {
    const { pubkey } = req.params;
    const { status, reason } = req.body;

    if (!status || !['active', 'suspended', 'banned'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be: active, suspended, or banned' });
    }

    // Get current profile
    const profile = await accountsService.getEntity(pubkey, 'profile');
    if (!profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update profile status
    const updatedProfile = {
      ...profile,
      status,
      statusReason: reason || null,
      statusUpdatedAt: new Date().toISOString(),
      statusUpdatedBy: req.authenticatedPubkey
    };

    await accountsService.upsertEntity(pubkey, 'profile', updatedProfile);

    logger.info(`Admin ${req.authenticatedPubkey.substring(0, 16)}... updated status for user ${pubkey.substring(0, 16)}... to ${status}`);

    res.status(200).json({
      success: true,
      message: 'User status updated successfully',
      status: {
        pubkey,
        status,
        reason,
        updatedAt: updatedProfile.statusUpdatedAt
      }
    });
  } catch (error) {
    logger.error(`Error updating user status: ${error.message}`);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

/**
 * Get admin audit logs
 * @route GET /api/admin/audit
 */
router.get('/audit', async (req, res) => {
  try {
    const adminPubkey = req.query.admin; // Optional filter by specific admin
    const limit = Math.min(parseInt(req.query.limit) || 100, 500); // Max 500 logs

    const auditLogs = await adminAuditService.getAdminAuditLogs(adminPubkey, limit);

    res.status(200).json({
      success: true,
      logs: auditLogs,
      count: auditLogs.length
    });
  } catch (error) {
    logger.error(`Error getting audit logs: ${error.message}`);
    res.status(500).json({ error: 'Failed to get audit logs' });
  }
});

/**
 * Get system statistics
 * @route GET /api/admin/stats
 */
router.get('/stats', async (req, res) => {
  try {
    // This is a placeholder for system statistics
    // In production, you'd implement proper analytics and caching
    const stats = {
      message: 'System statistics will be implemented in a future update',
      timestamp: new Date().toISOString(),
      requestedBy: req.authenticatedPubkey.substring(0, 16) + '...'
    };

    res.status(200).json({
      success: true,
      stats
    });
  } catch (error) {
    logger.error(`Error getting system stats: ${error.message}`);
    res.status(500).json({ error: 'Failed to get system statistics' });
  }
});

/**
 * Get user activity logs (admin only)
 * @route GET /api/admin/users/:pubkey/activity
 */
router.get('/users/:pubkey/activity', async (req, res) => {
  try {
    const { pubkey } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const activityType = req.query.type || null;

    if (!pubkey) {
      return res.status(400).json({ error: 'Public key is required' });
    }

    const activities = await userActivityService.getUserActivity(pubkey, limit, activityType);
    const analytics = await userActivityService.getUserActivityAnalytics(pubkey, 30);

    res.json({
      success: true,
      activities,
      analytics,
      pubkey: pubkey.substring(0, 16) + '...'
    });

  } catch (error) {
    logger.error(`Admin get user activity error: ${error.message}`);
    res.status(500).json({ error: 'Failed to get user activity' });
  }
});

/**
 * Get user subscription history (admin only)
 * @route GET /api/admin/users/:pubkey/subscription-history
 */
router.get('/users/:pubkey/subscription-history', async (req, res) => {
  try {
    const { pubkey } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);

    if (!pubkey) {
      return res.status(400).json({ error: 'Public key is required' });
    }

    const history = await subscriptionHistoryService.getSubscriptionHistory(pubkey, limit);

    res.json({
      success: true,
      history,
      pubkey: pubkey.substring(0, 16) + '...'
    });

  } catch (error) {
    logger.error(`Admin get subscription history error: ${error.message}`);
    res.status(500).json({ error: 'Failed to get subscription history' });
  }
});

/**
 * Manually adjust user subscription (admin only)
 * @route PUT /api/admin/users/:pubkey/subscription
 */
router.put('/users/:pubkey/subscription', async (req, res) => {
  try {
    const { pubkey } = req.params;
    const { tier, billingCycle, expiryDate, reason } = req.body;

    if (!pubkey) {
      return res.status(400).json({ error: 'Public key is required' });
    }

    const validTiers = ['free', 'premium', 'premium_plus'];
    const validCycles = ['monthly', 'quarterly', 'yearly'];

    if (!validTiers.includes(tier)) {
      return res.status(400).json({ error: 'Invalid subscription tier' });
    }

    if (tier !== 'free' && !validCycles.includes(billingCycle)) {
      return res.status(400).json({ error: 'Invalid billing cycle for paid tier' });
    }

    // Calculate daily notification limit
    let dailyNotificationLimit;
    switch (tier) {
      case 'free':
        dailyNotificationLimit = parseInt(process.env.FREE_TIER_DAILY_LIMIT) || 5;
        break;
      case 'premium':
        dailyNotificationLimit = parseInt(process.env.PREMIUM_TIER_DAILY_LIMIT) || 50;
        break;
      case 'premium_plus':
        dailyNotificationLimit = parseInt(process.env.PREMIUM_PLUS_TIER_DAILY_LIMIT) || 500;
        break;
    }

    const subscriptionData = {
      tier,
      isActive: tier !== 'free',
      startDate: new Date().toISOString(),
      expiryDate: tier === 'free' ? null : (expiryDate || null),
      billingCycle: tier === 'free' ? null : billingCycle,
      autoRenew: false, // Manual adjustments don't auto-renew
      dailyNotificationLimit,
      adminAdjusted: true,
      adminAdjustedBy: req.authenticatedPubkey,
      adminAdjustedAt: new Date().toISOString(),
      adminReason: reason || 'Manual admin adjustment'
    };

    const updatedSubscription = await subscriptionsService.upsertSubscriptionWithHistory(
      pubkey, 
      subscriptionData, 
      `Admin adjustment: ${reason || 'Manual change'}`
    );

    logger.info(`Admin ${req.authenticatedPubkey.substring(0, 16)}... adjusted subscription for ${pubkey.substring(0, 16)}... to ${tier}`);

    res.json({
      success: true,
      message: 'Subscription updated successfully',
      subscription: updatedSubscription
    });

  } catch (error) {
    logger.error(`Admin subscription adjustment error: ${error.message}`);
    res.status(500).json({ error: 'Failed to adjust subscription' });
  }
});

/**
 * Get payment history for a user (admin only)
 * @route GET /api/admin/users/:pubkey/payments
 */
router.get('/users/:pubkey/payments', async (req, res) => {
  try {
    const { pubkey } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    if (!pubkey) {
      return res.status(400).json({ error: 'Public key is required' });
    }

    const payments = await paymentsService.getPaymentHistory(pubkey, limit);

    res.json({
      success: true,
      payments,
      pubkey: pubkey.substring(0, 16) + '...'
    });

  } catch (error) {
    logger.error(`Admin get payments error: ${error.message}`);
    res.status(500).json({ error: 'Failed to get payment history' });
  }
});

/**
 * Get system-wide statistics (admin only)
 * @route GET /api/admin/statistics
 */
router.get('/statistics', async (req, res) => {
  try {
    // In a production system, these statistics would likely be pre-computed
    // and cached for performance. For this implementation, we'll return
    // placeholder data and note that real implementation would require
    // more sophisticated queries or separate analytics tables.

    const stats = {
      timestamp: new Date().toISOString(),
      users: {
        total: 'N/A - requires full table scan',
        active: 'N/A - requires activity analysis',
        new_today: 'N/A - requires date-based query',
        new_this_month: 'N/A - requires date-based query'
      },
      subscriptions: {
        free: 'N/A - requires subscription analysis',
        premium: 'N/A - requires subscription analysis',
        premium_plus: 'N/A - requires subscription analysis',
        total_revenue_this_month: 'N/A - requires payment analysis'
      },
      notifications: {
        sent_today: 'N/A - requires notification log analysis',
        sent_this_month: 'N/A - requires notification log analysis'
      },
      note: 'Full statistics implementation requires pre-computed analytics tables for performance at scale'
    };

    res.json({
      success: true,
      statistics: stats
    });

  } catch (error) {
    logger.error(`Admin statistics error: ${error.message}`);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

/**
 * Issue refund or credit (admin only)
 * @route POST /api/admin/users/:pubkey/refund
 */
router.post('/users/:pubkey/refund', async (req, res) => {
  try {
    const { pubkey } = req.params;
    const { amount, reason, transactionId } = req.body;

    if (!pubkey || !amount || !reason) {
      return res.status(400).json({ error: 'Public key, amount, and reason are required' });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: 'Refund amount must be positive' });
    }

    // Record the refund as a negative payment
    const refundData = {
      amount: -Math.abs(amount), // Ensure negative value
      currency: 'USD',
      tier: 'refund',
      billingCycle: 'refund',
      paymentMethod: 'admin_refund',
      status: 'completed',
      transactionId: transactionId || `refund_${Date.now()}`,
      reason,
      processedBy: req.authenticatedPubkey,
      processedAt: new Date().toISOString(),
      isRefund: true
    };

    await paymentsService.recordPayment(pubkey, refundData);

    logger.info(`Admin ${req.authenticatedPubkey.substring(0, 16)}... issued refund of ${amount} cents to ${pubkey.substring(0, 16)}... for: ${reason}`);

    res.json({
      success: true,
      message: 'Refund processed successfully',
      refund: {
        amount: refundData.amount,
        transactionId: refundData.transactionId,
        reason: refundData.reason
      }
    });

  } catch (error) {
    logger.error(`Admin refund error: ${error.message}`);
    res.status(500).json({ error: 'Failed to process refund' });
  }
});

module.exports = router;
