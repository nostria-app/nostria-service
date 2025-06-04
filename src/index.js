// Early error handling setup before any other imports
process.on('uncaughtException', (error) => {
  console.error('💥 FATAL: Uncaught Exception during startup!');
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
  console.error('This error occurred before the logger could be initialized.');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 FATAL: Unhandled Promise Rejection during startup!');
  console.error('Reason:', reason);
  console.error('Promise:', promise);
  console.error('This error occurred before the logger could be initialized.');
  process.exit(1);
});

// Load environment variables first
try {
  require('dotenv').config();
  console.log('Environment variables loaded successfully');
} catch (error) {
  console.error('Failed to load environment variables:', error);
  process.exit(1);
}

// Core Node.js modules
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const { accountsService } = require('./utils/AccountsTableService');

// Import routes with error handling
let subscriptionRoutes, notificationRoutes, statusRoutes, keyRoutes;
let signupRoutes, adminRoutes, subscriptionManagementRoutes, accountRoutes;

try {
  console.log('Loading route modules...');
  subscriptionRoutes = require('./routes/subscription');
  notificationRoutes = require('./routes/notification');
  statusRoutes = require('./routes/status');
  keyRoutes = require('./routes/key');
  signupRoutes = require('./routes/signup');
  adminRoutes = require('./routes/admin');
  subscriptionManagementRoutes = require('./routes/subscriptionManagement');
  accountRoutes = require('./routes/account');
  console.log('Route modules loaded successfully');
} catch (error) {
  console.error('Failed to load route modules:', error);
  console.error('Stack:', error.stack);
  process.exit(1);
}

// Import middleware with error handling
let apiKeyAuth, errorHandler, notFoundHandler;
let publicApiLimiter, signupLimiter, authenticatedLimiter, adminLimiter, paymentLimiter;
let logger;

try {
  console.log('Loading middleware modules...');
  ({ apiKeyAuth } = require('./middleware/auth'));
  ({ errorHandler, notFoundHandler } = require('./middleware/errorHandler'));
  ({ 
    publicApiLimiter, 
    signupLimiter, 
    authenticatedLimiter, 
    adminLimiter, 
    paymentLimiter 
  } = require('./middleware/rateLimiting'));
  logger = require('./utils/logger');
  console.log('Middleware modules loaded successfully');
} catch (error) {
  console.error('Failed to load middleware modules:', error);
  console.error('Stack:', error.stack);
  process.exit(1);
}

// Startup validation and initialization
async function validateStartupEnvironment() {
  const errors = [];
  const warnings = [];

  try {
    logger.info('Starting Nostria Service...');
    logger.info('Validating startup environment...');

    // Check required environment variables
    const requiredEnvVars = ['SERVICE_API_KEY'];
    const optionalEnvVars = [
      'AZURE_STORAGE_CONNECTION_STRING',
      'TABLE_NAME',
      'SUBSCRIPTIONS_TABLE_NAME',
      'PAYMENTS_TABLE_NAME',
      'ADMIN_AUDIT_TABLE_NAME',
      'SUBSCRIPTION_HISTORY_TABLE_NAME',
      'USER_ACTIVITY_TABLE_NAME',
      'ADMIN_PUBKEYS'
    ];

    // Check required variables
    requiredEnvVars.forEach(varName => {
      if (!process.env[varName]) {
        errors.push(`Missing required environment variable: ${varName}`);
      }
    });

    // Check optional variables and warn if missing
    optionalEnvVars.forEach(varName => {
      if (!process.env[varName]) {
        warnings.push(`Optional environment variable not set: ${varName}`);
      }
    });

    // Validate Azure Storage configuration
    if (!process.env.AZURE_STORAGE_CONNECTION_STRING && !process.env.AZURE_TENANT_ID) {
      errors.push('Azure Storage configuration missing: Either AZURE_STORAGE_CONNECTION_STRING or AZURE_TENANT_ID must be set');
    }

    // Validate admin configuration
    if (process.env.ADMIN_PUBKEYS) {
      const adminPubkeys = process.env.ADMIN_PUBKEYS.split(',').map(key => key.trim()).filter(Boolean);
      if (adminPubkeys.length === 0) {
        warnings.push('ADMIN_PUBKEYS is set but contains no valid public keys');
      } else {
        logger.info(`Configured ${adminPubkeys.length} admin public keys`);
      }
    } else {
      warnings.push('No admin public keys configured - admin functionality will be disabled');
    }    // Test Azure Table Storage initialization
    try {
      logger.info('Testing Azure Table Storage connection...');
      
      // Test a simple operation on the accounts table      
      logger.info('Testing connection to accounts table...');
      const testIterator = accountsService.tableClient.listEntities({ 
        queryOptions: { filter: "PartitionKey ne ''", top: 1 }
      });
      await testIterator.next();
      logger.info('Azure Table Storage connection test successful');

    } catch (storageError) {
      errors.push(`Azure Table Storage initialization failed: ${storageError.message}`);
      logger.error('Azure Table Storage test failed:', storageError);
      logger.error('Storage error stack:', storageError.stack);
    }

    // Log warnings
    if (warnings.length > 0) {
      warnings.forEach(warning => logger.warn(warning));
    }

    // Return validation results
    if (errors.length > 0) {
      return { success: false, errors, warnings };
    }

    logger.info('Startup environment validation completed successfully');
    return { success: true, errors: [], warnings };

  } catch (error) {
    logger.error('Startup validation failed with unexpected error:', error);
    return { 
      success: false, 
      errors: [`Startup validation failed: ${error.message}`], 
      warnings 
    };
  }
}

// Create data directory if it doesn't exist
function ensureDataDirectory() {
  try {
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      logger.info('Created data directory for logs');
    }
    return true;
  } catch (error) {
    logger.error('Failed to create data directory:', error);
    return false;
  }
}

// Initialize Express app
function initializeExpressApp() {
  try {
    const app = express();
    const PORT = process.env.PORT || 3000;
    
    // Configure trust proxy based on environment
    if (process.env.NODE_ENV === 'test') {
      // In test environment, don't trust proxy to avoid rate limiting warnings
      app.set('trust proxy', false);
    } else {
      // In production, configure trust proxy appropriately
      app.set('trust proxy', true);
    }

    // Middleware
    app.use(helmet({ contentSecurityPolicy: false })); // Secure HTTP headers
    app.use(cors());
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Static files
    app.use(express.static(path.join(__dirname, 'public')));    // Routes
    app.use('/api/subscription', publicApiLimiter, subscriptionRoutes);
    app.use('/api/notification', authenticatedLimiter, notificationRoutes); // Protected route
    app.use('/api/status', publicApiLimiter, statusRoutes);
    app.use('/api/key', publicApiLimiter, keyRoutes);
    app.use('/api/signup', signupLimiter, signupRoutes); // Public signup route with strict limiting
    app.use('/api/admin', adminLimiter, adminRoutes); // Protected admin routes
    app.use('/api/subscription-management', paymentLimiter, subscriptionManagementRoutes); // Protected subscription management
    app.use('/api/account', authenticatedLimiter, accountRoutes); // Protected account management

    // Error handling middleware
    app.use(notFoundHandler);
    app.use(errorHandler);

    return { app, PORT };
  } catch (error) {
    logger.error('Failed to initialize Express app:', error);
    throw error;
  }
}

// Graceful shutdown handler
function setupGracefulShutdown(server) {
  const gracefulShutdown = (signal) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    
    server.close((err) => {
      if (err) {
        logger.error('Error during server shutdown:', err);
        process.exit(1);
      }
      
      logger.info('Server closed successfully');
      process.exit(0);
    });

    // Force shutdown after 30 seconds
    setTimeout(() => {
      logger.error('Forcing shutdown after timeout');
      process.exit(1);
    }, 30000);
  };

  // Handle various shutdown signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));
}

// Main startup function
async function startServer() {
  try {
    // Ensure data directory exists
    if (!ensureDataDirectory()) {
      logger.error('Failed to create data directory. Exiting...');
      process.exit(1);
    }

    // Validate startup environment
    const validation = await validateStartupEnvironment();
    if (!validation.success) {
      logger.error('Startup validation failed with the following errors:');
      validation.errors.forEach(error => logger.error(`  - ${error}`));
      
      if (validation.warnings.length > 0) {
        logger.warn('Additional warnings:');
        validation.warnings.forEach(warning => logger.warn(`  - ${warning}`));
      }
      
      logger.error('Cannot start server due to validation errors. Please fix the above issues and try again.');
      process.exit(1);
    }

    // Initialize Express app
    const { app, PORT } = initializeExpressApp();

    // Start server
    const server = app.listen(PORT, () => {
      logger.info('='.repeat(50));
      logger.info(`🚀 Nostria Service started successfully!`);
      logger.info(`📍 Server running on port ${PORT}`);
      logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`⏰ Started at: ${new Date().toISOString()}`);
      
      if (validation.warnings.length > 0) {
        logger.warn(`⚠️  ${validation.warnings.length} warning(s) detected during startup`);
      }
      
      logger.info('='.repeat(50));
    });

    // Handle server startup errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use. Please choose a different port or stop the process using this port.`);
      } else if (error.code === 'EACCES') {
        logger.error(`Permission denied to bind to port ${PORT}. Try using a port number above 1024 or run with elevated privileges.`);
      } else {
        logger.error('Server startup error:', error);
      }
      process.exit(1);
    });

    // Setup graceful shutdown
    setupGracefulShutdown(server);

    return app;

  } catch (error) {
    logger.error('Fatal error during server startup:', error);
    logger.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Enhanced global error handlers
process.on('uncaughtException', (error) => {
  const logFunction = logger ? logger.error : console.error;
  logFunction('💥 FATAL: Uncaught Exception detected!');
  logFunction('Error:', error.message);
  logFunction('Stack:', error.stack);
  logFunction('This is a fatal error. The process will exit.');
  
  // Give the logger time to write before exiting
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  const logFunction = logger ? logger.error : console.error;
  logFunction('💥 FATAL: Unhandled Promise Rejection detected!');
  logFunction('Reason:', reason);
  logFunction('Promise:', promise);
  logFunction('This indicates a programming error. Please review the code.');
  
  // Don't exit immediately for unhandled rejections, just log
  // The process can continue but this should be investigated
});

process.on('warning', (warning) => {
  const logFunction = logger ? logger.warn : console.warn;
  logFunction('Node.js Warning:', warning.message);
  if (warning.stack) {
    logFunction('Stack:', warning.stack);
  }
});

// Create the Express app for export (needed for testing)
let appInstance;

try {
  const { app } = initializeExpressApp();
  appInstance = app;
} catch (error) {
  console.error('Failed to create app instance for export:', error);
  process.exit(1);
}

// Start the server only if not in test mode
if (process.env.NODE_ENV !== 'test') {
  startServer().catch((error) => {
    const logFunction = logger ? logger.error : console.error;
    logFunction('Failed to start server:', error);
    logFunction('Stack:', error.stack);
    process.exit(1);
  });
}

module.exports = appInstance;
