const BaseTableStorageService = require('./BaseTableStorageService');
const logger = require('./logger');

class SubscriptionsTableService extends BaseTableStorageService {
  constructor() {
    super(process.env.SUBSCRIPTIONS_TABLE_NAME || "subscriptions");
  }

  async upsertSubscription(pubkey, subscriptionData) {
    const entity = {
      ...subscriptionData,
      updatedAt: new Date().toISOString()
    };

    return this.upsertEntity(pubkey, 'current', entity);
  }

  async getCurrentSubscription(pubkey) {
    return this.getEntity(pubkey, 'current');
  }

  async getSubscriptionStatus(pubkey) {
    try {
      const subscription = await this.getCurrentSubscription(pubkey);

      if (!subscription) {
        return {
          hasSubscription: false,
          isPremium: false,
          isPremiumPlus: false,
          isActive: false,
          tier: 'free',
          expiryDate: null
        };
      }

      const now = new Date();
      const expiryDate = new Date(subscription.expiryDate);
      const isActive = expiryDate > now;

      return {
        hasSubscription: true,
        isPremium: subscription.tier === 'premium',
        isPremiumPlus: subscription.tier === 'premiumplus',
        isActive,
        tier: subscription.tier,
        expiryDate: subscription.expiryDate
      };
    } catch (error) {
      logger.error(`Error getting subscription status for ${pubkey}: ${error.message}`);
      throw error;
    }
  }

  async hasPremiumSubscription(pubkey) {
    try {
      const status = await this.getSubscriptionStatus(pubkey);
      return status.isActive && (status.isPremium || status.isPremiumPlus);
    } catch (error) {
      logger.error(`Error checking premium subscription for ${pubkey}: ${error.message}`);
      return false;
    }
  }
}

module.exports = {
  SubscriptionsTableService,
  subscriptionsService: new SubscriptionsTableService(),
}