const express = require('express');
const router = express.Router();
const { initializeTableClients } = require('../utils/enhancedTableStorage');
const logger = require('../utils/logger');

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const healthStatus = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.0.1',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      checks: {
        memory: checkMemoryUsage(),
        database: await checkDatabaseConnection(),
        environment: checkEnvironmentVariables()
      }
    };

    // Determine overall health
    const allHealthy = Object.values(healthStatus.checks).every(check => check.status === 'OK');
    
    if (!allHealthy) {
      healthStatus.status = 'DEGRADED';
    }

    const statusCode = allHealthy ? 200 : 503;
    res.status(statusCode).json(healthStatus);
    
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
});

// Ready check - simpler endpoint for load balancers
router.get('/ready', (req, res) => {
  res.status(200).json({
    status: 'READY',
    timestamp: new Date().toISOString()
  });
});

// Live check - simple ping endpoint
router.get('/live', (req, res) => {
  res.status(200).json({
    status: 'ALIVE',
    timestamp: new Date().toISOString()
  });
});

// Metrics endpoint for monitoring
router.get('/metrics', (req, res) => {
  const metrics = {
    timestamp: new Date().toISOString(),
    process: {
      pid: process.pid,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      version: process.version,
      platform: process.platform,
      arch: process.arch
    },
    system: {
      loadAverage: require('os').loadavg(),
      totalMemory: require('os').totalmem(),
      freeMemory: require('os').freemem(),
      cpus: require('os').cpus().length
    }
  };

  res.json(metrics);
});

function checkMemoryUsage() {
  const usage = process.memoryUsage();
  const totalMemory = require('os').totalmem();
  const memoryUsagePercent = (usage.rss / totalMemory) * 100;
  
  let status = 'OK';
  if (memoryUsagePercent > 90) {
    status = 'CRITICAL';
  } else if (memoryUsagePercent > 75) {
    status = 'WARNING';
  }

  return {
    status,
    details: {
      rss: usage.rss,
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      usagePercent: memoryUsagePercent.toFixed(2)
    }
  };
}

async function checkDatabaseConnection() {
  try {
    // Try to initialize table clients to verify Azure connection
    const tableClients = await initializeTableClients();
    
    // Simple check - try to list entities from accounts table (limit 1)
    if (tableClients.accounts) {
      const iterator = tableClients.accounts.listEntities({ 
        queryOptions: { filter: "PartitionKey ne ''", top: 1 }
      });
      
      // Just check if we can iterate (don't need to consume results)
      await iterator.next();
    }

    return {
      status: 'OK',
      details: {
        tablesInitialized: Object.keys(tableClients).length,
        connectionType: process.env.AZURE_STORAGE_CONNECTION_STRING ? 'connectionString' : 'managedIdentity'
      }
    };
  } catch (error) {
    logger.error('Database health check failed:', error);
    return {
      status: 'ERROR',
      details: {
        error: error.message
      }
    };
  }
}

function checkEnvironmentVariables() {
  const requiredVars = [
    'NODE_ENV',
    'PORT',
    'SERVICE_API_KEY'
  ];

  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  const status = missingVars.length === 0 ? 'OK' : 'WARNING';
  
  return {
    status,
    details: {
      required: requiredVars,
      missing: missingVars,
      present: requiredVars.filter(varName => !!process.env[varName])
    }
  };
}

module.exports = router;
