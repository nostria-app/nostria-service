import express, { Request, Response } from 'express';
import RepositoryFactory from '../database/RepositoryFactory';
import logger from '../utils/logger';
import { nip98 } from 'nostr-tools';
import { UserSettingsUpdate, UserSettingsResponse } from '../models/userSettings';
import { createRateLimit } from '../utils/rateLimit';
import requireNIP98Auth from '../middleware/requireNIP98Auth';
import { now } from '../helpers/now';

// Get repository instance from factory
const userSettingsRepository = RepositoryFactory.getUserSettingsRepository();

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
 *         socialSharing:
 *           type: boolean
 *           description: Social sharing preference
 *           example: true
 *         created:
 *           type: number
 *           format: timestamp
 *           description: Settings creation timestamp
 *         updated:
 *           type: number
 *           format: timestamp
 *           description: Settings last update timestamp
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
 *       Validates social sharing preferences before saving.
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
 *             socialSharing: false
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

export default router;
