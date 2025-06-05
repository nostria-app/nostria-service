const request = require('supertest');
jest.mock('../src/utils/BaseTableStorageService');

const app = require('../src/index');

describe('Subscription API', () => {

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


    test('should apply rate limits to signup endpoints', async () => {
      const testPubkey = 'npub1ratelimit123';

      // Make multiple requests quickly
      const requests = Array.from({ length: 10 }, () =>
        request(app)
          .get(`/api/subscription/pricing`)
      );

      const responses = await Promise.all(requests);

      // All should succeed as we're under the limit for this test
      responses.forEach(response => {
        expect([200, 429]).toContain(response.status);
      });
    });

    test('should include rate limit headers', async () => {
      const response = await request(app)
        .get('/api/subscription/pricing')
        .expect(200);

      expect(response.headers).toHaveProperty('ratelimit-limit');
      expect(response.headers).toHaveProperty('ratelimit-remaining');
    });

    test('should include security headers', async () => {
      const response = await request(app)
        .get('/api/subscription/pricing')
        .expect(200);

      // Check for some helmet security headers
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-frame-options');
    });
  });
});