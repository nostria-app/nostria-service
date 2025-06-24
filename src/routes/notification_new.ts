import express, { Request, Response } from 'express';
import logger from '../utils/logger';

const router = express.Router();

// POST /broadcast - Send a broadcast notification to specified users or all users
router.post('/broadcast', async (req: Request, res: Response) => {
  try {
    logger.info('Notification broadcast request received (temporarily disabled during CosmosDB migration)');
    
    res.status(200).json({
      message: 'Notification system temporarily disabled during CosmosDB migration',
      results: {
        sent: [],
        failed: [],
        limited: []
      }
    });
  } catch (error) {
    logger.error('Error in notification broadcast:', error);
    res.status(500).json({ error: 'Failed to send notifications' });
  }
});

// POST /send - Send a notification to a specific user
router.post('/send', async (req: Request, res: Response) => {
  try {
    logger.info('Individual notification request received (temporarily disabled during CosmosDB migration)');
    
    res.status(200).json({
      message: 'Notification system temporarily disabled during CosmosDB migration',
      success: false
    });
  } catch (error) {
    logger.error('Error sending individual notification:', error);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

export default router;
