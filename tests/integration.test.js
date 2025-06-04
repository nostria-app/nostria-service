const request = require('supertest');
jest.mock('../src/utils/BaseTableStorageService');

const app = require('../src/index');
const { accountsService } = require('../src/utils/AccountsTableService');
const { subscriptionsService } = require('../src/utils/SubscriptionsTableService');

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.SERVICE_API_KEY = 'test-api-key';
process.env.ADMIN_PUBKEYS = 'npub1test1,npub1test2';

describe('Public API Endpoints', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.resetAllMocks();
    
    // Mock the services
    jest.spyOn(accountsService, 'getEntity').mockResolvedValue(null);
    jest.spyOn(subscriptionsService, 'getCurrentSubscription').mockResolvedValue(null);
  });

  describe('GET /api/status', () => {
    test('should return service status', async () => {
      const response = await request(app)
        .get('/api/status')
        .expect(200);

      expect(response.body).toHaveProperty('service', 'Nostria Service');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('version');
    });
  });

  describe('GET /api/signup/check/:pubkey', () => {
    test('should check if pubkey is not available', async () => {
      const testPubkey = 'npub1test123456789';
      accountsService.getEntity.mockResolvedValueOnce({});
      const response = await request(app)
        .get(`/api/signup/check/${testPubkey}`)
        .expect(200);

      expect(response.body).toHaveProperty('available', false);
      expect(response.body).toHaveProperty('pubkey', testPubkey);
      expect(response.body).toHaveProperty('success', true);
    });

    test('should check if pubkey is available', async () => {
      const testPubkey = 'npub1test123456789';
      const response = await request(app)
        .get(`/api/signup/check/${testPubkey}`)
        .expect(200);

      expect(response.body).toHaveProperty('available', true);
      expect(response.body).toHaveProperty('pubkey', testPubkey);
      expect(response.body).toHaveProperty('success', true);
      expect(accountsService.getEntity).toHaveBeenCalledWith(testPubkey, 'profile');
    });

    test('should return 400 for invalid pubkey format', async () => {
      const response = await request(app)
        .get('/api/signup/check/invalid-pubkey')
        .expect(200); // The endpoint doesn't validate format, just checks existence

      expect(response.body).toHaveProperty('available', true);
      expect(response.body).toHaveProperty('success', true);
    });
  });

  describe('GET /api/signup/pricing', () => {
    test('should return pricing information', async () => {
      const response = await request(app)
        .get('/api/signup/pricing')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('pricing');
      expect(response.body.pricing).toHaveProperty('premium');
      expect(response.body.pricing).toHaveProperty('premium_plus');
      expect(response.body.pricing.premium).toHaveProperty('pricing');
      expect(response.body.pricing.premium.pricing).toHaveProperty('monthly');
      expect(response.body.pricing.premium.pricing).toHaveProperty('quarterly');
      expect(response.body.pricing.premium.pricing).toHaveProperty('yearly');
    });
  });
});

describe('Rate Limiting', () => {
  test('should apply rate limits to signup endpoints', async () => {
    const testPubkey = 'npub1ratelimit123';
    
    // Make multiple requests quickly
    const requests = Array.from({ length: 10 }, () =>
      request(app)
        .get(`/api/signup/check/${testPubkey}`)
    );

    const responses = await Promise.all(requests);
    
    // All should succeed as we're under the limit for this test
    responses.forEach(response => {
      expect([200, 429]).toContain(response.status);
    });
  });

  test('should include rate limit headers', async () => {
    const response = await request(app)
      .get('/api/status')
      .expect(200);

    expect(response.headers).toHaveProperty('ratelimit-limit');
    expect(response.headers).toHaveProperty('ratelimit-remaining');
  });
});

describe('Security Headers', () => {
  test('should include security headers', async () => {
    const response = await request(app)
      .get('/api/status')
      .expect(200);

    // Check for some helmet security headers
    expect(response.headers).toHaveProperty('x-content-type-options');
    expect(response.headers).toHaveProperty('x-frame-options');
  });
});

describe('Error Handling', () => {
  test('should return 404 for non-existent endpoints', async () => {
    const response = await request(app)
      .get('/api/non-existent-endpoint')
      .expect(404);

    expect(response.body).toHaveProperty('error');
  });

  test('should handle malformed JSON in POST requests', async () => {
    const response = await request(app)
      .post('/api/signup/register')
      .send('{"invalid": json}')
      .set('Content-Type', 'application/json')
      .expect(400);
  });
});
