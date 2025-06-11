import winston from 'winston';
import path from 'path';

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${message} ${stack || ''}`;
  })
);

// Configure the logger
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'test' ? 'warning' : process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    // Write to console
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    }),
    // Write all logs to notification service log file
    new winston.transports.File({
      filename: path.join(__dirname, '../../data/nostria-notification.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Write all notification events to a separate log file
    new winston.transports.File({
      filename: path.join(__dirname, '../../data/notification-events.log'),
      level: 'info',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  ],
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(__dirname, '../../data/exceptions.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 2,
    })
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(__dirname, '../../data/rejections.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 2,
    })
  ]
});

export default logger;
