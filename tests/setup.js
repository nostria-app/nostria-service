// Global test setup
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce log noise during tests

// Mock environment variables
process.env.SERVICE_API_KEY = 'test-api-key-123';
process.env.ADMIN_PUBKEYS = 'npub1testadmin1,npub1testadmin2';
process.env.PREMIUM_MONTHLY_PRICE = '999';
process.env.PREMIUM_QUARTERLY_PRICE = '2497';
process.env.PREMIUM_YEARLY_PRICE = '9999';
process.env.PREMIUM_PLUS_MONTHLY_PRICE = '1999';
process.env.PREMIUM_PLUS_QUARTERLY_PRICE = '4997';
process.env.PREMIUM_PLUS_YEARLY_PRICE = '19999';

// Increase timeout for async operations
jest.setTimeout(10000);
