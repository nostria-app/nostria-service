// Test setup file to configure environment variables for testing
process.env.NODE_ENV = 'test';
process.env.AZURE_COSMOSDB_CONNECTION_STRING = 'AccountEndpoint=https://test.documents.azure.com:443/;AccountKey=test;';
process.env.AZURE_COSMOSDB_DATABASE_NAME = 'NostriaDB';
process.env.AZURE_COSMOSDB_CONTAINER_NAME = 'Documents';
// Valid VAPID keys for testing (these are test keys, not for production use)
process.env.PUBLIC_VAPID_KEY = 'BM1L1YgTXwlCqTKkqMtlXKWNbztKc1FEt4P8-HvjM1lNgJTY8AwX9R-9S1Cxd8bYtqI7vZ2pHXnGjGVUaWwLBBQ';
process.env.PRIVATE_VAPID_KEY = 'abcdefghijklmnopqrstuvwxyz1234567890ABCDEF';
process.env.VAPID_SUBJECT = 'mailto:test@example.com';
process.env.NOTIFICATION_API_KEY = 'test-api-key';
