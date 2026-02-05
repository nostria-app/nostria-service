// Test setup file to configure environment variables for testing
process.env.NODE_ENV = 'test';
// Valid VAPID keys for testing (these are test keys, not for production use)
// The public key and private key pair must be valid EC P-256 keys
process.env.PUBLIC_VAPID_KEY = 'BM1L1YgTXwlCqTKkqMtlXKWNbztKc1FEt4P8-HvjM1lNgJTY8AwX9R-9S1Cxd8bYtqI7vZ2pHXnGjGVUaWwLBBQ';
process.env.PRIVATE_VAPID_KEY = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY';  // Valid base64 URL encoded 32 bytes
process.env.VAPID_SUBJECT = 'mailto:test@example.com';
process.env.SERVICE_API_KEY = 'test-api-key';
