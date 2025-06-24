import express, { Request, Response } from 'express';
import userSettingsRepository from '../database/userSettingsRepository';
import logger from '../utils/logger';
import { nip98 } from 'nostr-tools';
import { UserSettingsUpdate, UserSettingsResponse } from '../models/userSettings';
import { createRateLimit } from '../utils/rateLimit';
import requireNIP98Auth from '../middleware/requireNIP98Auth';
import { now } from '../helpers/now';

const authRateLimit = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  500, // limit each IP to 500 requests per windowMs
  'Too many authenticated requests from this IP, please try again later.'
);

// combined middleware to be used for routes requiring
// authenticated user
const authUser = [authRateLimit, requireNIP98Auth];

/**
 * @openapi
 * components:
 *   schemas:
 *     UserSettingsUpdate:
 *       type: object
 *       properties:
 *         releaseChannel:
 *           type: string
 *           enum: [stable, beta, alpha]
 *           description: Release channel preference for app updates
 *           example: "stable"
 *         socialSharing:
 *           type: boolean
 *           description: Whether social sharing features are enabled
 *           example: true
 *     UserSettingsResponse:
 *       type: object
 *       properties:
 *         pubkey:
 *           type: string
 *           description: User's public key
 *           example: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
 *         releaseChannel:
 *           type: string
 *           enum: [stable, beta, alpha]
 *           description: Release channel preference
 *           example: "stable"
 *         socialSharing:
 *           type: boolean
 *           description: Social sharing preference
 *           example: true
 *         created:
 *           type: string
 *           format: date-time
 *           description: Settings creation timestamp
 *         updated:
 *           type: string
 *           format: date-time
 *           description: Settings last update timestamp
 *     UsersByReleaseChannel:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Operation success status
 *         message:
 *           type: string
 *           description: Operation result message
 *         data:
 *           type: object
 *           properties:
 *             releaseChannel:
 *               type: string
 *               description: The queried release channel
 *             userCount:
 *               type: integer
 *               description: Number of users in this channel
 *             users:
 *               type: array
 *               items:
 *                 type: string
 *               description: Array of user public keys
 *     SuccessResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Operation success status
 *         message:
 *           type: string
 *           description: Success message
 *         data:
 *           $ref: '#/components/schemas/UserSettingsResponse'
 *   securitySchemes:
 *     NIP98Auth:
 *       type: http
 *       scheme: bearer
 *       description: NIP-98 authentication using Nostr events
 * tags:
 *   - name: Settings
 *     description: User settings management and preferences
 */

const router = express.Router();

/**
 * Validate NIP-98 authorization token
 * @param authHeader - Authorization header
 * @param url - Request URL
 * @param method - HTTP method
 * @returns Promise<boolean>
 */
// async function validateNIP98(authHeader: string | undefined, url: string, method: string): Promise<boolean> {
//   if (!authHeader) {
//     return false;
//   }
  
//   try {
//     return await nip98.validateToken(authHeader, url, method);
//   } catch (error) {
//     logger.warn(`NIP-98 validation error: ${(error as Error).message}`);
//     return false;
//   }
// }

/**
 * Transform UserSettings entity to API response format
 * @param settings - User settings entity
 * @returns UserSettingsResponse
 */
function transformToResponse(settings: any): UserSettingsResponse {
  return {
    pubkey: settings.pubkey,
    releaseChannel: settings.releaseChannel,
    socialSharing: settings.socialSharing,
    created: settings.created,
    modified: settings._ts
  };
}

/**
 * @openapi
 * /settings/{pubkey}:
 *   post:
 *     summary: Create or update user settings
 *     description: |
 *       Create new user settings or update existing ones. Requires NIP-98 authentication.
 *       Validates release channel and social sharing preferences before saving.
 *     tags:
 *       - Settings
 *     security:
 *       - NIP98Auth: []
 *     parameters:
 *       - name: pubkey
 *         in: path
 *         required: true
 *         description: User's public key (hexadecimal format)
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{64}$'
 *           example: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserSettingsUpdate'
 *           example:
 *             releaseChannel: "stable"
 *             socialSharing: true
 *     responses:
 *       '200':
 *         description: Settings saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '400':
 *         description: Invalid request data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 message:
 *                   type: string
 *       '401':
 *         description: Unauthorized - Invalid NIP-98 token
 *       '500':
 *         description: Internal server error
 */
router.post('/:pubkey', authUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const { pubkey } = req.params;
    const settingsData: UserSettingsUpdate = req.body;

    // Validate pubkey parameter
    if (!pubkey || typeof pubkey !== 'string') {
      res.status(400).json({ 
        error: 'Invalid pubkey parameter',
        message: 'Pubkey must be a valid string'
      });
      return;
    }

    // Validate request body
    if (!settingsData || typeof settingsData !== 'object') {
      res.status(400).json({ 
        error: 'Invalid request body',
        message: 'Settings data must be a valid object'
      });
      return;
    }

    // Validate release channel if provided
    if (settingsData.releaseChannel && !['stable', 'beta', 'alpha'].includes(settingsData.releaseChannel)) {
      res.status(400).json({ 
        error: 'Invalid release channel',
        message: 'Release channel must be one of: stable, beta, alpha'
      });
      return;
    }

    // Validate social sharing if provided
    if (settingsData.socialSharing !== undefined && typeof settingsData.socialSharing !== 'boolean') {
      res.status(400).json({ 
        error: 'Invalid social sharing setting',
        message: 'Social sharing must be a boolean value'
      });
      return;
    }

    // Create or update settings
    const settings = await userSettingsRepository.upsertUserSettings(pubkey, settingsData);
    const response = transformToResponse(settings);

    logger.info(`User settings created/updated for user ${pubkey}`);
    res.status(200).json({
      success: true,
      message: 'User settings saved successfully',
      data: response
    });
  } catch (error) {
    logger.error(`Error creating/updating user settings: ${(error as Error).message}`);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to save user settings'
    });
  }
});

/**
 * @openapi
 * /settings/{pubkey}:
 *   get:
 *     summary: Get user settings
 *     description: |
 *       Retrieve user settings for a specific public key. Requires NIP-98 authentication
 *       to ensure users can only access their own settings.
 *     tags:
 *       - Settings
 *     security:
 *       - NIP98Auth: []
 *     parameters:
 *       - name: pubkey
 *         in: path
 *         required: true
 *         description: User's public key (hexadecimal format)
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{64}$'
 *           example: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
 *     responses:
 *       '200':
 *         description: Settings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '400':
 *         description: Invalid pubkey parameter
 *       '401':
 *         description: Unauthorized - Invalid NIP-98 token
 *       '404':
 *         description: Settings not found for the specified user
 *       '500':
 *         description: Internal server error
 */
router.get('/:pubkey', authUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const { pubkey } = req.params;

    // Validate NIP-98 authorization
    // const isValid = await validateNIP98(req.headers.authorization, url, 'GET');
    // if (!isValid) {
    //   res.status(401).json({ 
    //     error: 'Invalid or missing authorization token',
    //     message: 'NIP-98 authorization required'
    //   });
    //   return;
    // }

    // Validate pubkey parameter
    if (!pubkey || typeof pubkey !== 'string') {
      res.status(400).json({ 
        error: 'Invalid pubkey parameter',
        message: 'Pubkey must be a valid string'
      });
      return;
    }

    const ts = now();

    // Get user settings
    const settings = await userSettingsRepository.getUserSettings(pubkey);
    
    if (!settings) {
      // Return default settings if none exist
      const defaultSettings = userSettingsRepository.getDefaultSettings();
      const response: UserSettingsResponse = {
        pubkey,
        releaseChannel: defaultSettings.releaseChannel,
        socialSharing: defaultSettings.socialSharing,
        created: ts,
        modified: ts,
      };
      
      res.status(200).json({
        success: true,
        message: 'Default user settings returned (no custom settings found)',
        data: response,
        default: true
      });
      return;
    }

    const response = transformToResponse(settings);
    
    res.status(200).json({
      success: true,
      message: 'User settings retrieved successfully',
      data: response
    });
  } catch (error) {
    logger.error(`Error getting user settings: ${(error as Error).message}`);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to retrieve user settings'
    });
  }
});

/**
 * @openapi
 * /settings/{pubkey}:
 *   patch:
 *     summary: Update specific user settings fields
 *     description: |
 *       Partially update user settings by providing only the fields that need to be changed.
 *       Requires NIP-98 authentication and validates all provided fields.
 *     tags:
 *       - Settings
 *     security:
 *       - NIP98Auth: []
 *     parameters:
 *       - name: pubkey
 *         in: path
 *         required: true
 *         description: User's public key (hexadecimal format)
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{64}$'
 *           example: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserSettingsUpdate'
 *           example:
 *             releaseChannel: "beta"
 *     responses:
 *       '200':
 *         description: Settings updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       '400':
 *         description: Invalid request data or empty update
 *       '401':
 *         description: Unauthorized - Invalid NIP-98 token
 *       '500':
 *         description: Internal server error
 */
router.patch('/:pubkey', authUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const { pubkey } = req.params;
    const updates: UserSettingsUpdate = req.body;

    // Validate NIP-98 authorization
    // const isValid = await validateNIP98(req.headers.authorization, url, 'PATCH');
    // if (!isValid) {
    //   res.status(401).json({ 
    //     error: 'Invalid or missing authorization token',
    //     message: 'NIP-98 authorization required'
    //   });
    //   return;
    // }

    // Validate pubkey parameter
    if (!pubkey || typeof pubkey !== 'string') {
      res.status(400).json({ 
        error: 'Invalid pubkey parameter',
        message: 'Pubkey must be a valid string'
      });
      return;
    }

    // Validate request body
    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      res.status(400).json({ 
        error: 'Invalid request body',
        message: 'Updates must be a non-empty object'
      });
      return;
    }

    // Validate release channel if provided
    if (updates.releaseChannel && !['stable', 'beta', 'alpha'].includes(updates.releaseChannel)) {
      res.status(400).json({ 
        error: 'Invalid release channel',
        message: 'Release channel must be one of: stable, beta, alpha'
      });
      return;
    }

    // Validate social sharing if provided
    if (updates.socialSharing !== undefined && typeof updates.socialSharing !== 'boolean') {
      res.status(400).json({ 
        error: 'Invalid social sharing setting',
        message: 'Social sharing must be a boolean value'
      });
      return;
    }

    // Update settings
    const settings = await userSettingsRepository.updateUserSettings(pubkey, updates);
    const response = transformToResponse(settings);

    logger.info(`User settings updated for user ${pubkey}`);
    res.status(200).json({
      success: true,
      message: 'User settings updated successfully',
      data: response
    });
  } catch (error) {
    logger.error(`Error updating user settings: ${(error as Error).message}`);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to update user settings'
    });
  }
});

/**
 * @openapi
 * /settings/{pubkey}:
 *   delete:
 *     summary: Delete user settings
 *     description: |
 *       Permanently delete all user settings for a specific public key.
 *       Requires NIP-98 authentication and verifies settings exist before deletion.
 *     tags:
 *       - Settings
 *     security:
 *       - NIP98Auth: []
 *     parameters:
 *       - name: pubkey
 *         in: path
 *         required: true
 *         description: User's public key (hexadecimal format)
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{64}$'
 *           example: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
 *     responses:
 *       '200':
 *         description: Settings deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       '400':
 *         description: Invalid pubkey parameter
 *       '401':
 *         description: Unauthorized - Invalid NIP-98 token
 *       '404':
 *         description: Settings not found for the specified user
 *       '500':
 *         description: Internal server error
 */
router.delete('/:pubkey', authUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const { pubkey } = req.params;

    // Validate NIP-98 authorization
    // const isValid = await validateNIP98(req.headers.authorization, url, 'DELETE');
    // if (!isValid) {
    //   res.status(401).json({ 
    //     error: 'Invalid or missing authorization token',
    //     message: 'NIP-98 authorization required'
    //   });
    //   return;
    // }

    // Validate pubkey parameter
    if (!pubkey || typeof pubkey !== 'string') {
      res.status(400).json({ 
        error: 'Invalid pubkey parameter',
        message: 'Pubkey must be a valid string'
      });
      return;
    }

    // Check if settings exist
    const existingSettings = await userSettingsRepository.getUserSettings(pubkey);
    if (!existingSettings) {
      res.status(404).json({ 
        error: 'Settings not found',
        message: 'No user settings found for the specified pubkey'
      });
      return;
    }

    // Delete settings
    await userSettingsRepository.deleteUserSettings(pubkey);

    logger.info(`User settings deleted for user ${pubkey}`);
    res.status(200).json({
      success: true,
      message: 'User settings deleted successfully'
    });
  } catch (error) {
    logger.error(`Error deleting user settings: ${(error as Error).message}`);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to delete user settings'
    });
  }
});

/**
 * @openapi
 * /settings/admin/release-channel/{channel}:
 *   get:
 *     summary: Get users by release channel (admin endpoint)
 *     description: |
 *       Administrative endpoint to retrieve all users subscribed to a specific release channel.
 *       Returns user count and list of public keys for marketing or deployment purposes.
 *     tags:
 *       - Settings
 *     parameters:
 *       - name: channel
 *         in: path
 *         required: true
 *         description: Release channel to query
 *         schema:
 *           type: string
 *           enum: [stable, beta, alpha]
 *           example: "stable"
 *     responses:
 *       '200':
 *         description: Users retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UsersByReleaseChannel'
 *             example:
 *               success: true
 *               message: "Users with release channel 'stable' retrieved successfully"
 *               data:
 *                 releaseChannel: "stable"
 *                 userCount: 150
 *                 users: ["pubkey1", "pubkey2", "pubkey3"]
 *       '400':
 *         description: Invalid release channel parameter
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 message:
 *                   type: string
 *       '500':
 *         description: Internal server error
 */
router.get('/admin/release-channel/:channel', async (req: Request, res: Response): Promise<void> => {
  try {
    const { channel } = req.params;

    // Validate release channel parameter
    if (!['stable', 'beta', 'alpha'].includes(channel)) {
      res.status(400).json({ 
        error: 'Invalid release channel',
        message: 'Release channel must be one of: stable, beta, alpha'
      });
      return;
    }

    // Get users by release channel
    const userPubkeys = await userSettingsRepository.getUsersByReleaseChannel(channel as 'stable' | 'beta' | 'alpha');

    res.status(200).json({
      success: true,
      message: `Users with release channel '${channel}' retrieved successfully`,
      data: {
        releaseChannel: channel,
        userCount: userPubkeys.length,
        users: userPubkeys
      }
    });
  } catch (error) {
    logger.error(`Error getting users by release channel: ${(error as Error).message}`);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to retrieve users by release channel'
    });
  }
});

export default router;
