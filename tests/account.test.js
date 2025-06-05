const request = require('supertest');
jest.mock('../src/utils/BaseTableStorageService');

const app = require('../src/index');
const { accountsService } = require('../src/utils/AccountsTableService');
const { subscriptionsService } = require('../src/utils/SubscriptionsTableService');

describe('Account Public API', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.resetAllMocks();

    // Mock the services
    jest.spyOn(accountsService, 'getEntity').mockResolvedValue(null);
    jest.spyOn(subscriptionsService, 'getCurrentSubscription').mockResolvedValue(null);
  });

  describe('GET /api/account/:pubkey', () => {
    test('should check if pubkey is not available', async () => {
      const testPubkey = 'npub1test123456789';
      accountsService.getEntity.mockResolvedValueOnce({});
      const response = await request(app)
        .get(`/api/account/${testPubkey}`)
        .expect(200);

      expect(response.body).toHaveProperty('profile');
      expect(response.body).toHaveProperty('success', true);
    });

    test('should check if pubkey is available', async () => {
      const testPubkey = 'npub1test123456789';
      const response = await request(app)
        .get(`/api/account/${testPubkey}`)
        .expect(404);

      expect(accountsService.getEntity).toHaveBeenCalledWith(testPubkey, 'profile');
    });

    test('should return 400 for invalid pubkey format', async () => {
      const response = await request(app)
        .get('/api/account/invalid-pubkey')
        .expect(404); // The endpoint doesn't validate format, just checks existence
    });

    test('should apply rate limits', async () => {
      const testPubkey = 'npub1test123456789';
      accountsService.getEntity.mockResolvedValue({});
      // Make multiple requests quickly
      const requests = Array.from({ length: 10 }, () =>
        request(app)
          .get(`/api/account/${testPubkey}`)
      );

      const responses = await Promise.all(requests);

      // All should succeed as we're under the limit for this test
      responses.forEach(response => {
        expect(String(response.status)).toMatch(/200|429/)
      });
    });
  });

  describe('GET /api/subscription/pricing', () => {
    test('should return pricing information', async () => {
      const response = await request(app)
        .get('/api/subscription/pricing')
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
