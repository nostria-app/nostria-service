import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';

// Import routes
import subscriptionRoutes from './routes/subscription';
import notificationRoutes from './routes/notification';
import statusRoutes from './routes/status';
import keyRoutes from './routes/key';

// Import middleware
import { apiKeyAuth } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import logger from './utils/logger';

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  logger.info('Created data directory for notification logs');
}

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', true);

// Middleware
app.use(helmet({ contentSecurityPolicy: false })); // Secure HTTP headers
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/notification', apiKeyAuth, notificationRoutes); // Protected route
app.use('/api/status', statusRoutes);
app.use('/api/key', keyRoutes);

// Error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', error);
  // Graceful shutdown
  process.exit(1);
});

// Handle unhandled rejections
process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  logger.error('Unhandled Promise Rejection:', reason);
});

export default app;
