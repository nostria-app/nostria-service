const { userActivityService } = require('../utils/UserActivityTableService');

const logUserActivity = (req, res, next) => {
  const originalSend = res.send;
  res.send = function(data) {
    // Log the action after successful completion
    if (res.statusCode < 400 && req.authenticatedPubkey) {
      const action = `Account ${req.method} ${req.path}`;
      
      // Async log user activity (don't wait for it)
      userActivityService.logUserActivity(
        req.authenticatedPubkey,
        action,
        {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          timestamp: new Date().toISOString()
        }
      ).catch(error => {
        logger.error(`Failed to log user activity: ${error.message}`);
      });

      // Also log to main logger for immediate visibility
      logger.info(`User operation: ${req.authenticatedPubkey.substring(0, 16)}... performed ${action}`, {
        pubkey: req.authenticatedPubkey.substring(0, 16) + '...',
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
      });
    }
    
    originalSend.call(this, data);
  };
  
  next();
}

module.exports = logUserActivity;