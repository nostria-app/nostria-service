import express, { Request, Response } from 'express';
import webPush from '../utils/webPush';
import logger from '../utils/logger';

const router = express.Router();

// Temporarily disable subscription endpoints during CosmosDB migration
// These were primarily for notification management, not core account/payment functionality

router.post('/subscribe', async (req: Request, res: Response) => {
  try {
    logger.info('Subscription request received (temporarily disabled during CosmosDB migration)');
    
    res.status(200).json({
      message: 'Subscription system temporarily disabled during CosmosDB migration',
      success: false
    });
  } catch (error) {
    logger.error('Error in subscription:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

router.get('/subscriptions', async (req: Request, res: Response) => {
  try {
    logger.info('Get subscriptions request received (temporarily disabled during CosmosDB migration)');
    
    res.status(200).json({
      message: 'Subscription system temporarily disabled during CosmosDB migration',
      subscriptions: []
    });
  } catch (error) {
    logger.error('Error getting subscriptions:', error);
    res.status(500).json({ error: 'Failed to get subscriptions' });
  }
});

router.delete('/unsubscribe', async (req: Request, res: Response) => {
  try {
    logger.info('Unsubscribe request received (temporarily disabled during CosmosDB migration)');
    
    res.status(200).json({
      message: 'Subscription system temporarily disabled during CosmosDB migration',
      success: false
    });
  } catch (error) {
    logger.error('Error unsubscribing:', error);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

export default router;
