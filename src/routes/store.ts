import express, { Request, Response } from 'express';

import { createRateLimit } from '../utils/rateLimit';
import logger from '../utils/logger';
import appleIapVerifier from '../services/AppleIapVerifier';
import googlePlayIapVerifier from '../services/GooglePlayIapVerifier';
import appleNotificationService from '../services/AppleNotificationService';
import { STORE_PRODUCTS } from '../services/storeProductCatalog';

/**
 * @openapi
 * tags:
 *   - name: Store
 *     description: Native app store (App Store / Play Store) purchase infrastructure
 */
const router = express.Router();

const notificationRateLimit = createRateLimit(
  60 * 1000,
  120,
  'Too many store notifications, please try again later'
);

const configRateLimit = createRateLimit(
  60 * 1000,
  30,
  'Too many store config requests, please try again later'
);

/**
 * @openapi
 * /store/config:
 *   get:
 *     operationId: "GetStoreConfig"
 *     summary: Store purchase configuration diagnostics
 *     description: |
 *       Returns non-secret information about the server's in-app purchase configuration.
 *       Used by the client debug panel to confirm the backend can verify App Store purchases.
 *     tags:
 *       - Store
 *     responses:
 *       '200':
 *         description: Configuration snapshot
 */
router.get('/config', configRateLimit, (_req: Request, res: Response) => {
  const apple = appleIapVerifier.getStatus();

  res.json({
    appStore: {
      configured: apple.configured,
      bundleId: apple.bundleId,
      appAppleId: apple.appAppleId,
      environment: apple.environment,
      hasIssuerId: apple.hasIssuerId,
      hasKeyId: apple.hasKeyId,
      hasPrivateKey: apple.hasPrivateKey,
      privateKeyLooksValid: apple.privateKeyLooksValid,
      allowUnverifiedDecode: apple.allowUnverifiedDecode,
      missing: apple.missing,
    },
    playStore: {
      configured: googlePlayIapVerifier.isConfigured(),
    },
    products: STORE_PRODUCTS.map(p => ({
      productId: p.productId,
      tier: p.tier,
      billingCycle: p.billingCycle,
      kind: p.kind,
    })),
    serverTime: Date.now(),
  });
});

/**
 * @openapi
 * /store/apple/notifications:
 *   post:
 *     operationId: "AppleServerNotification"
 *     summary: App Store Server Notifications V2 webhook
 *     description: |
 *       Receives App Store Server Notifications V2 from Apple. Renewals extend the
 *       subscription, refunds/revocations cut it short. Configure this URL in
 *       App Store Connect → App Information → App Store Server Notifications (V2).
 *     tags:
 *       - Store
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               signedPayload:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Notification accepted
 *       '400':
 *         description: Invalid payload
 */
router.post('/apple/notifications', notificationRateLimit, async (req: Request, res: Response) => {
  const signedPayload = (req.body as { signedPayload?: string } | undefined)?.signedPayload;

  if (!signedPayload) {
    return res.status(400).json({ error: 'signedPayload is required' });
  }

  try {
    const result = await appleNotificationService.handle(signedPayload);

    if (!result.handled) {
      logger.warn(
        `App Store notification not applied: type=${result.notificationType} reason=${result.reason || 'unknown'}`
      );
    }

    // Always 200 so Apple does not retry indefinitely for payloads we intentionally ignore.
    return res.status(200).json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to process App Store notification: ${message}`);
    // 500 makes Apple retry, which is the desired behaviour for transient failures.
    return res.status(500).json({ error: 'Failed to process notification' });
  }
});

export default router;
