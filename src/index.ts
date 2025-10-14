import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import PrismaClientSingleton from './database/prismaClient';
import RepositoryFactory from './database/RepositoryFactory';

// Import routes
import account from './routes/account';
import subscriptionRoutes from './routes/subscription';
import notificationRoutes from './routes/notification';
import statusRoutes from './routes/status';
import keyRoutes from './routes/key';
import paymentRoutes from './routes/payment';
import backupRoutes from './routes/backup';
import settingsRoutes from './routes/settings';
import swaggerRoutes from './routes/swagger';
import usersRoutes from './routes/users';

// Import middleware
import { apiKeyAuth } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import logger from './utils/logger';

// Database initialization function
async function initializeDatabases(): Promise<void> {
  logger.info('Initializing PostgreSQL database connection...');
  
  try {
    await PrismaClientSingleton.connect();
    const isHealthy = await RepositoryFactory.checkPostgresHealth();
    if (isHealthy) {
      logger.info('PostgreSQL connection established and healthy');
    } else {
      logger.warn('PostgreSQL connection established but health check failed');
    }
  } catch (error) {
    logger.error('Failed to connect to PostgreSQL:', error);
    throw error; // Fail startup if PostgreSQL connection fails
  }
}

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  logger.info('Created data directory for notification logs');
}

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;
// TODO: figure out correct number of proxies
// see: https://express-rate-limit.mintlify.app/guides/troubleshooting-proxy-issues
app.set('trust proxy', true);

// Middleware
app.use(helmet({ contentSecurityPolicy: false })); // Secure HTTP headers
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger UI
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
// Serve raw Swagger JSON
app.get('/openapi.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Expose raw OpenAPI JSON via dedicated routes
app.use('/', swaggerRoutes);

// Routes
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/notification', apiKeyAuth, notificationRoutes); // Protected route
app.use('/api/status', statusRoutes);
app.use('/api/key', keyRoutes);
app.use('/api/account', account);
app.use('/api/payment', paymentRoutes);
app.use('/api/backup', backupRoutes); // Backup management endpoints
app.use('/api/settings', settingsRoutes); // User settings endpoints
app.use('/api/users', apiKeyAuth, usersRoutes); // Protected users endpoint

// Error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

// Graceful shutdown handler
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  try {
    await PrismaClientSingleton.disconnect();
    logger.info('Database connections closed successfully');
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
  }
  
  process.exit(0);
}

// Register signal handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

if (process.env.NODE_ENV !== 'test') {
  // Initialize databases and start server
  initializeDatabases()
    .then(() => {
      app.listen(PORT, () => {
        logger.info(`Server is running on port ${PORT}`);
        logger.info(`Environment: ${process.env.NODE_ENV}`);
      });
    })
    .catch((error) => {
      logger.error('Failed to initialize databases:', error);
      process.exit(1);
    });
}

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', error);
  // Graceful shutdown
  gracefulShutdown('uncaughtException');
});

// Handle unhandled rejections
process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  logger.error('Unhandled Promise Rejection:', reason);
  gracefulShutdown('unhandledRejection');
});

export default app;
