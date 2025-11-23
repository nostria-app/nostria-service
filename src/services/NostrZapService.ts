import { SimplePool, Filter, Event, getPublicKey, finalizeEvent, nip19 } from 'nostr-tools';
import config from '../config';
import { Tier } from '../config/types';
import RepositoryFactory from '../database/RepositoryFactory';
import { Account } from '../models/account';
import { AccountSubscription, expiresAt } from '../models/accountSubscription';
import { now } from '../helpers/now';
import logger from '../utils/logger';
import lightningService from './LightningService';
import PrismaClientSingleton from '../database/prismaClient';
import notificationService from '../database/notificationService';
import webPush from '../utils/webPush';

const NOSTRIA_PREMIUM_PUBKEY = '3e5b8d197f4a9279278fd61d9d033058e13d62f6652e3f868dcab54fac8c9658';

interface ZapRequestContent {
  recipientPubkey: string;
  subscriptionType: 'premium' | 'premium-plus';
  months: number;
  message?: string;
}

interface ParsedZapRequest {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  pubkey: string;
  id: string;
  sig: string;
}

class NostrZapService {
  private pool: SimplePool;
  private relays: string[];
  private accountRepository = RepositoryFactory.getAccountRepository();
  private prisma = PrismaClientSingleton.getInstance();
  private isRunning = false;
  private btcUsdRate: number | null = null;
  private lastBtcUpdate: number = 0;

  constructor() {
    this.pool = new SimplePool();
    
    // Get relays from config
    this.relays = config.nostrZap?.relays || [
      'wss://ribo.eu.nostria.app',
      'wss://ribo.af.nostria.app',
      'wss://ribo.us.nostria.app',
      'wss://relay.damus.io',
      'wss://relay.primal.net'
    ];

    logger.info(`NostrZapService configured with relays: ${this.relays.join(', ')}`);
  }

  /**
   * Start listening for zap receipt events
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('NostrZapService is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting NostrZapService...');

    // Fetch initial BTC price
    try {
      await this.updateBtcPrice();
    } catch (error) {
      logger.error('Failed to fetch initial BTC price:', error);
      logger.warn('Will retry fetching BTC price when needed');
    }

    // Get all user pubkeys to listen for zaps
    let userPubkeys: string[] = [];
    try {
      userPubkeys = await notificationService.getAllUserPubkeys();
      logger.info(`Found ${userPubkeys.length} users to listen for zaps`);
    } catch (error) {
      logger.error('Failed to fetch user pubkeys:', error);
    }

    // Combine premium pubkey with user pubkeys
    // We limit the number of pubkeys to avoid overwhelming the filter if there are too many
    // In a production environment with many users, this would need a different architecture
    const pubkeysToListen = [NOSTRIA_PREMIUM_PUBKEY, ...userPubkeys];
    
    // If there are too many pubkeys, we might need to split subscriptions or use a wildcard if supported/appropriate
    // For now, we'll just log a warning if it's very large
    if (pubkeysToListen.length > 1000) {
      logger.warn(`Listening for ${pubkeysToListen.length} pubkeys, this might be too large for some relays`);
    }

    // Set start date to Nov 22, 2025 to avoid processing old zaps on initial deployment
    // User requested 1 day before Nov 23, 2025
    const SINCE_TIMESTAMP = Math.floor(new Date('2025-11-22T00:00:00Z').getTime() / 1000);

    const filter: Filter = {
      kinds: [9735], // Zap receipt events
      '#p': pubkeysToListen, // Listen for zaps to premium pubkey AND our users
      since: SINCE_TIMESTAMP,
    };

    try {
      const sub = this.pool.subscribeMany(
        this.relays,
        [filter],
        {
          onevent: async (event: Event) => {
            try {
              await this.handleZapEvent(event);
            } catch (error) {
              logger.error('Error handling zap event:', error);
            }
          },
          oneose: () => {
            logger.info('NostrZapService subscription established (EOSE received)');
          }
        }
      );

      logger.info('NostrZapService started successfully');
    } catch (error) {
      logger.error('Failed to start NostrZapService:', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping NostrZapService...');
    this.pool.close(this.relays);
    this.isRunning = false;
    logger.info('NostrZapService stopped');
  }

  /**
   * Handle a zap receipt event
   */
  private async handleZapEvent(event: Event): Promise<void> {
    logger.info(`Received zap receipt event ${event.id} from ${event.pubkey}`);

    // Check if we've already processed this event
    const alreadyProcessed = await this.isEventProcessed(event.id);
    if (alreadyProcessed) {
      logger.info(`Zap event ${event.id} already processed, skipping`);
      return;
    }

    try {
      // Extract bolt11 invoice and description from tags
      const bolt11Tag = event.tags.find(tag => tag[0] === 'bolt11');
      const descriptionTag = event.tags.find(tag => tag[0] === 'description');

      if (!bolt11Tag || !descriptionTag) {
        logger.warn(`Zap event ${event.id} missing bolt11 or description tag`);
        return;
      }

      const bolt11 = bolt11Tag[1];
      const descriptionJson = descriptionTag[1];

      // Parse the description (which contains the zap request)
      // The description is a JSON string that may need cleanup for control characters
      let zapRequest: ParsedZapRequest;
      try {
        // Try to parse directly first
        zapRequest = JSON.parse(descriptionJson);
      } catch (firstError) {
        // If parsing fails, it might be due to unescaped control characters (newlines, etc.)
        // Replace control characters with their escape sequences
        try {
          const cleanedJson = descriptionJson.replace(/[\u0000-\u001F\u007F-\u009F]/g, (match) => {
            // Convert to \uXXXX format
            const hex = match.charCodeAt(0).toString(16).padStart(4, '0');
            return `\\u${hex}`;
          });
          zapRequest = JSON.parse(cleanedJson);
          logger.info('Successfully parsed zap request after escaping control characters');
        } catch (secondError) {
          logger.error(`Failed to parse zap request description: ${firstError}`);
          logger.error(`Also failed after cleanup: ${secondError}`);
          logger.debug(`Description substring around error: ${descriptionJson.substring(Math.max(0, 251 - 50), Math.min(descriptionJson.length, 251 + 50))}`);
          return;
        }
      }

      // Verify it's a kind 9734 zap request
      if (zapRequest.kind !== 9734) {
        logger.warn(`Expected kind 9734 zap request, got kind ${zapRequest.kind}`);
        return;
      }

      // Check if this is a gift subscription (recipient is NOSTRIA_PREMIUM_PUBKEY)
      const pTags = event.tags.filter(tag => tag[0] === 'p');
      const isGiftSubscription = pTags.some(tag => tag[1] === NOSTRIA_PREMIUM_PUBKEY);

      if (isGiftSubscription) {
        await this.handleGiftSubscription(event, zapRequest);
      } else {
        await this.handleUserZapNotification(event, zapRequest);
      }

    } catch (error) {
      logger.error(`Error processing zap event ${event.id}:`, error);
    }
  }

  /**
   * Handle a zap that is a gift subscription
   */
  private async handleGiftSubscription(event: Event, zapRequest: ParsedZapRequest): Promise<void> {
      // Parse the content to extract subscription details
      const contentDetails = this.parseZapContent(zapRequest.content);
      if (!contentDetails) {
        logger.warn(`Failed to parse zap content: ${zapRequest.content}`);
        return;
      }

      // Extract and validate the amount from zap request tags
      const amountTag = zapRequest.tags.find(tag => tag[0] === 'amount');
      if (!amountTag) {
        logger.warn(`Zap request missing amount tag`);
        return;
      }

      const amountMillisats = parseInt(amountTag[1], 10);
      if (isNaN(amountMillisats)) {
        logger.warn(`Invalid amount in zap request: ${amountTag[1]}`);
        return;
      }

      const amountSats = Math.floor(amountMillisats / 1000);

      // Validate the payment amount
      const validationResult = await this.validatePaymentAmount(
        contentDetails.subscriptionType, 
        contentDetails.months, 
        amountSats
      );
      
      if (!validationResult.isValid) {
        logger.warn(
          `Invalid payment amount for ${contentDetails.subscriptionType} ${contentDetails.months} month(s): ` +
          `${amountSats} sats received. ${validationResult.message}`
        );
        
        // Save as underpaid for manual review
        await this.markEventProcessed(
          event.id,
          contentDetails.recipientPubkey,
          zapRequest.pubkey,
          contentDetails.subscriptionType,
          contentDetails.months,
          amountSats,
          'underpaid',
          validationResult.message
        );
        
        logger.info(`Saved underpaid zap ${event.id} for manual review`);
        return;
      }

      // Activate the subscription
      try {
        await this.activateSubscription(
          contentDetails.recipientPubkey,
          contentDetails.subscriptionType,
          contentDetails.months,
          event.id,
          zapRequest.pubkey,
          amountSats
        );

        // Mark event as successfully processed
        await this.markEventProcessed(
          event.id,
          contentDetails.recipientPubkey,
          zapRequest.pubkey,
          contentDetails.subscriptionType,
          contentDetails.months,
          amountSats,
          'success'
        );

        // Post notification to Nostr
        await this.postGiftNotification(
          contentDetails.recipientPubkey,
          contentDetails.subscriptionType,
          contentDetails.months,
          zapRequest.pubkey,
          zapRequest
        );

        logger.info(
          `Successfully activated ${contentDetails.subscriptionType} subscription ` +
          `for ${contentDetails.months} month(s) for pubkey ${contentDetails.recipientPubkey}`
        );
      } catch (error) {
        // Mark event as failed
        await this.markEventProcessed(
          event.id,
          contentDetails.recipientPubkey,
          zapRequest.pubkey,
          contentDetails.subscriptionType,
          contentDetails.months,
          amountSats,
          'failed',
          error instanceof Error ? error.message : 'Unknown error during subscription activation'
        );
        
        logger.error(`Failed to activate subscription for zap ${event.id}:`, error);
      }
  }

  /**
   * Handle a normal zap to a user (send push notification)
   */
  private async handleUserZapNotification(event: Event, zapRequest: ParsedZapRequest): Promise<void> {
    try {
      // Identify the recipient
      // The 'p' tag in the zap receipt (event) is the recipient
      const pTag = event.tags.find(tag => tag[0] === 'p');
      if (!pTag) {
        logger.warn(`Zap event ${event.id} missing p tag`);
        return;
      }
      const recipientPubkey = pTag[1];

      // Check if we have subscriptions for this user
      const subscriptions = await notificationService.getUserSubscriptions(recipientPubkey);
      if (subscriptions.length === 0) {
        logger.debug(`No push subscriptions for recipient ${recipientPubkey}, skipping notification`);
        return;
      }

      // Extract amount
      const amountTag = zapRequest.tags.find(tag => tag[0] === 'amount');
      let amountSats = 0;
      if (amountTag) {
        const amountMillisats = parseInt(amountTag[1], 10);
        if (!isNaN(amountMillisats)) {
          amountSats = Math.floor(amountMillisats / 1000);
        }
      }

      // Determine the link
      // 1. Link to the event that user received zaps for (e tag in zap request)
      // 2. If no reference to the event, link to the profile of the user who sent the zap (P tag in receipt)
      // 3. If no P tag, simply open the user's own profile

      let link = `nostr:${recipientPubkey}`; // Default to own profile
      
      const eTag = zapRequest.tags.find(tag => tag[0] === 'e');
      // Check P tag in the receipt event (not the request)
      const PTag = event.tags.find(tag => tag[0] === 'P');
      const senderPubkey = zapRequest.pubkey;

      if (eTag) {
        link = `nostr:${eTag[1]}`;
      } else if (PTag) {
        link = `nostr:${PTag[1]}`;
      }

      // Construct notification payload
      const title = 'Zap Received! ⚡';
      const body = `You received ${amountSats} sats${PTag ? ' from a fan' : ''}!`;

      // Send to all user devices
      const promises = subscriptions.map(async (sub) => {
        try {
          const pushSubscription = JSON.parse(sub.subscription);
          const result = await webPush.sendNotification(pushSubscription, {
            title,
            body,
            url: link,
            data: {
              type: 'zap',
              amount: amountSats,
              sender: senderPubkey,
              eventId: event.id
            }
          });

          if (result && result.error === 'expired_subscription') {
            logger.info(`Removing expired subscription for device ${sub.rowKey}`);
            await notificationService.deleteEntity(recipientPubkey, sub.rowKey);
          }
        } catch (err: any) {
          logger.error(`Failed to send push notification to device ${sub.rowKey}:`, err);
          
          if (err.statusCode === 410 || err.statusCode === 404) {
            logger.info(`Removing expired subscription for device ${sub.rowKey} (caught error)`);
            await notificationService.deleteEntity(recipientPubkey, sub.rowKey);
          }
        }
      });

      await Promise.all(promises);
      logger.info(`Sent zap notifications to ${subscriptions.length} devices for user ${recipientPubkey}`);

      // We don't need to mark these as processed in the database as strictly as gift subscriptions
      // but we could if we wanted to avoid duplicate notifications on restart.
      // For now, we rely on the in-memory check or maybe we should add a simple record.
      // Since isEventProcessed checks the DB, we should probably save it.
      
      await this.markEventProcessed(
        event.id,
        recipientPubkey,
        senderPubkey,
        'zap', // Use 'zap' as tier for generic zaps
        0,
        amountSats,
        'success'
      );

    } catch (error) {
      logger.error(`Error handling user zap notification for ${event.id}:`, error);
    }
  }

  /**
   * Parse the zap request content to extract subscription details
   * Example content:
   * 🎁 Nostria Premium Gift
   * d1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b
   * premium
   * 1
   * Enjoy!
   */
  private parseZapContent(content: string): ZapRequestContent | null {
    try {
      const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);

      if (lines.length < 4) {
        logger.warn(`Zap content has insufficient lines: ${lines.length}`);
        return null;
      }

      // Skip the first line (title like "🎁 Nostria Premium Gift")
      const recipientPubkey = lines[1];
      const subscriptionType = lines[2];
      const months = parseInt(lines[3], 10);

      // Validate pubkey format (64 hex characters)
      if (!/^[a-fA-F0-9]{64}$/.test(recipientPubkey)) {
        logger.warn(`Invalid recipient pubkey format: ${recipientPubkey}`);
        return null;
      }

      // Validate subscription type
      if (subscriptionType !== 'premium' && subscriptionType !== 'premium-plus') {
        logger.warn(`Invalid subscription type: ${subscriptionType}`);
        return null;
      }

      // Validate months
      if (isNaN(months) || months < 1 || months > 12) {
        logger.warn(`Invalid months value: ${months}`);
        return null;
      }

      return {
        recipientPubkey: recipientPubkey.toLowerCase(),
        subscriptionType: subscriptionType as 'premium' | 'premium-plus',
        months,
        message: lines.length > 4 ? lines.slice(4).join('\n') : undefined
      };
    } catch (error) {
      logger.error('Error parsing zap content:', error);
      return null;
    }
  }

  /**
   * Update the BTC price from the external service
   * Updates the btcUsdRate and lastBtcUpdate properties
   */
  private async updateBtcPrice(): Promise<void> {
    const now = Date.now();
    // Update if never updated or older than 10 minutes
    if (!this.btcUsdRate || now - this.lastBtcUpdate > 10 * 60 * 1000) {
      try {
        const rate = await lightningService.getUsdBtcRate();
        this.btcUsdRate = rate;
        this.lastBtcUpdate = now;
        logger.info(`Updated BTC/USD rate: $${rate.toLocaleString()}`);
      } catch (error) {
        logger.error('Failed to fetch BTC rate:', error);
        // If we have a stale rate, keep using it but log error
        if (this.btcUsdRate) {
          logger.warn(`Using stale BTC rate: $${this.btcUsdRate.toLocaleString()}`);
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Validate that the payment amount is sufficient for the subscription
   */
  private async validatePaymentAmount(
    subscriptionType: 'premium' | 'premium-plus',
    months: number,
    amountSats: number
  ): Promise<{ isValid: boolean; message?: string }> {
    const tier = subscriptionType === 'premium' ? 'premium' : 'premium_plus';
    const tierConfig = config.tiers[tier];

    if (!tierConfig.pricing) {
      logger.error(`No pricing configuration for tier: ${tier}`);
      return { isValid: false, message: 'No pricing configuration available' };
    }

    // Calculate expected price in cents for the number of months
    const monthlyPriceCents = tierConfig.pricing.monthly.priceCents;
    const expectedPriceCents = monthlyPriceCents * months;

    // Get current BTC/USD rate
    try {
      await this.updateBtcPrice();
    } catch (error) {
      logger.error('Failed to fetch BTC price for validation:', error);
      return { isValid: false, message: 'Failed to fetch BTC price' };
    }
    
    const btcUsdRate = this.btcUsdRate!;

    // Convert sats to USD cents
    // 1 BTC = btcUsdRate USD = btcUsdRate * 100 cents
    // 1 BTC = 100,000,000 sats
    // So 1 sat = (btcUsdRate * 100) / 100,000,000 cents
    const satToCents = (btcUsdRate * 100) / 100_000_000;
    const estimatedPriceCents = amountSats * satToCents;

    // Allow 10% tolerance for price fluctuations
    const minAcceptableCents = expectedPriceCents * 0.9;

    const logMessage = `Payment validation: expected ${expectedPriceCents} cents, ` +
      `received ~${estimatedPriceCents.toFixed(2)} cents (${amountSats} sats at $${btcUsdRate.toLocaleString()}/BTC)`;
    
    logger.info(logMessage);

    if (estimatedPriceCents < minAcceptableCents) {
      const shortfall = expectedPriceCents - estimatedPriceCents;
      return { 
        isValid: false, 
        message: `Underpaid by ~${shortfall.toFixed(2)} cents (expected ${expectedPriceCents} cents minimum ${minAcceptableCents.toFixed(2)} cents, received ${estimatedPriceCents.toFixed(2)} cents)` 
      };
    }

    return { isValid: true };
  }

  /**
   * Activate or extend a premium subscription for a user
   */
  private async activateSubscription(
    pubkey: string,
    subscriptionType: 'premium' | 'premium-plus',
    months: number,
    zapEventId: string,
    giftedBy: string,
    amountSats: number
  ): Promise<void> {
    // Get or create account
    let account = await this.accountRepository.getByPubkey(pubkey);

    const tier: Tier = subscriptionType === 'premium' ? 'premium' : 'premium_plus';
    const tierConfig = config.tiers[tier];

    // Calculate subscription duration in milliseconds (using 31 days per month)
    const durationMs = months * 31 * 24 * 60 * 60 * 1000;
    const currentTime = now();

    let newExpiryDate: number;
    
    if (account) {
      // If user has an existing subscription that hasn't expired, extend it
      if (account.expires && account.expires > currentTime) {
        newExpiryDate = account.expires + durationMs;
        logger.info(
          `Extending existing subscription for ${pubkey} from ${account.expires} to ${newExpiryDate}`
        );
      } else {
        // Subscription expired or didn't exist, start from now
        newExpiryDate = currentTime + durationMs;
        logger.info(
          `Creating new subscription for ${pubkey} expiring at ${newExpiryDate}`
        );
      }

      // Update the account (upgrade tier if needed)
      const shouldUpgradeTier = 
        (tier === 'premium_plus' && account.tier !== 'premium_plus') ||
        (tier === 'premium' && account.tier === 'free');

      if (shouldUpgradeTier) {
        logger.info(`Upgrading tier from ${account.tier} to ${tier}`);
      }

      const subscription: AccountSubscription = {
        tier,
        expiryDate: newExpiryDate,
        entitlements: tierConfig.entitlements
      };

      account.tier = tier;
      account.subscription = subscription;
      account.expires = newExpiryDate;

      await this.accountRepository.update(account);
    } else {
      // Create a new account without username (gifted subscription)
      newExpiryDate = currentTime + durationMs;

      const subscription: AccountSubscription = {
        tier,
        expiryDate: newExpiryDate,
        entitlements: tierConfig.entitlements
      };

      const newAccount: Account = {
        id: pubkey,
        type: 'account',
        pubkey,
        username: undefined, // No username for gifted subscriptions
        tier,
        subscription,
        expires: newExpiryDate,
        created: currentTime,
        modified: currentTime
      };

      await this.accountRepository.create(newAccount);
      
      logger.info(
        `Created new account with gifted ${tier} subscription for ${pubkey}, ` +
        `expires at ${newExpiryDate}`
      );
    }

    logger.info(
      `Subscription activated: ${tier} for ${months} month(s), ` +
      `${amountSats} sats, gifted by ${giftedBy}, zap event: ${zapEventId}`
    );
  }

  /**
   * Check if a zap event has already been processed
   */
  private async isEventProcessed(eventId: string): Promise<boolean> {
    try {
      const existing = await this.prisma.processedZapEvent.findUnique({
        where: { eventId }
      });
      return existing !== null;
    } catch (error) {
      logger.error(`Error checking if event ${eventId} is processed:`, error);
      return false; // On error, allow processing to continue
    }
  }

  /**
   * Mark a zap event as processed
   */
  private async markEventProcessed(
    eventId: string,
    recipientPubkey: string,
    giftedBy: string,
    tier: string,
    months: number,
    amountSats: number,
    status: 'success' | 'underpaid' | 'failed',
    errorMessage?: string
  ): Promise<void> {
    try {
      const currentTime = now();
      await this.prisma.processedZapEvent.create({
        data: {
          id: eventId,
          eventId,
          recipientPubkey,
          giftedBy,
          tier,
          months,
          amountSats,
          status,
          errorMessage,
          processed: BigInt(currentTime),
          created: BigInt(currentTime)
        }
      });
      logger.info(`Marked zap event ${eventId} as processed with status: ${status}`);
    } catch (error) {
      logger.error(`Error marking event ${eventId} as processed:`, error);
      // Don't throw - this is not critical
    }
  }

  /**
   * Post a kind 1 notification event to Nostr when a gift subscription is activated
   */
  private async postGiftNotification(
    recipientPubkey: string,
    subscriptionType: 'premium' | 'premium-plus',
    months: number,
    giftedBy: string,
    zapRequest: ParsedZapRequest
  ): Promise<void> {
    try {
      const privateKey = config.nostrZap?.notificationPrivateKey;
      
      if (!privateKey) {
        logger.warn('NOSTR_PREMIUM_NOTIFICATION_PRIVATE_KEY not configured, skipping notification post');
        return;
      }

      // Decode private key if it's in nsec format
      let privateKeyBytes: Uint8Array;
      if (privateKey.startsWith('nsec')) {
        const decoded = nip19.decode(privateKey);
        if (decoded.type !== 'nsec') {
          throw new Error('Invalid nsec format');
        }
        privateKeyBytes = decoded.data;
      } else {
        // Assume it's hex
        privateKeyBytes = new Uint8Array(
          privateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
        );
      }

      const publicKey = getPublicKey(privateKeyBytes);
      
      // Extract relays from the zap request
      const relaysTag = zapRequest.tags.find(tag => tag[0] === 'relays');
      const zapRequestRelays = relaysTag ? relaysTag.slice(1) : [];
      
      // Combine zap request relays with Nostria relays
      const nostriaRelays = [
        'wss://ribo.eu.nostria.app',
        'wss://ribo.af.nostria.app',
        'wss://ribo.us.nostria.app'
      ];
      
      // Deduplicate relays
      const allRelays = [...new Set([...zapRequestRelays, ...nostriaRelays])];
      
      logger.info(`Publishing gift notification to ${allRelays.length} relays: ${allRelays.join(', ')}`);
      
      // Format the gifted by pubkey for display
      const npubGiftedBy = nip19.npubEncode(giftedBy);
      const nostrLinkFrom = `nostr:${npubGiftedBy}`;

      const npubGiftedTo = nip19.npubEncode(recipientPubkey);
      const nostrLinkTo = `nostr:${npubGiftedTo}`;

      // Create the notification content
      const tierName = subscriptionType === 'premium' ? 'Premium' : 'Premium+';
      const duration = months === 1 ? '1 month' : `${months} months`;

      const content = `🎁 Congratulations ${nostrLinkTo} ! You've received a Nostria ${tierName} subscription as a gift!

Duration: ${duration}
Gifted by: ${nostrLinkFrom}

Your premium subscription is now active! As a premium member, you can claim your unique username.

👉 Set up your username here: https://nostria.app/premium

Enjoy your premium features! 🚀`;

      // Create the event
      const unsignedEvent = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['p', recipientPubkey], // Tag the recipient
          ['p', giftedBy], // Tag the gifter
        ],
        content,
        pubkey: publicKey,
      };

      // Sign and finalize the event
      const signedEvent = finalizeEvent(unsignedEvent, privateKeyBytes);

      // Publish to all relays with error handling
      // Note: pool.publish returns an array of promises when given multiple relays
      const publishPromises = this.pool.publish(allRelays, signedEvent);
      
      // Add error handling to each promise to prevent unhandled rejections
      const wrappedPromises = publishPromises.map((promise, index) => 
        promise.catch((error: Error) => {
          const relay = allRelays[index];
          logger.warn(`Failed to publish to relay ${relay}: ${error.message}`);
          return null; // Return null to indicate failure
        })
      );

      const results = await Promise.allSettled(wrappedPromises);
      
      // Count successful publishes
      const successCount = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
      const failCount = results.length - successCount;
      
      logger.info(
        `Posted gift notification to Nostr for ${recipientPubkey} ` +
        `(event ${signedEvent.id}) to ${allRelays.length} relays ` +
        `(${successCount} succeeded, ${failCount} failed)`
      );
    } catch (error) {
      logger.error('Failed to post gift notification to Nostr:', error);
      // Don't throw - notification failure shouldn't break the subscription activation
    }
  }
}

export default NostrZapService;
