const request = require('supertest');
jest.mock('../src/utils/BaseTableStorageService');

const app = require('../src/index');

describe('Public API', () => {
  describe('GET /api/status', () => {
    test('should return service status', async () => {
      const response = await request(app)
        .get('/api/status')
        .expect(200);

      expect(response.body).toHaveProperty('service', 'Nostria Service');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('version');
    });

    test('should include rate limit headers', async () => {
      const response = await request(app)
        .get('/api/status')
        .expect(200);
  
      expect(response.headers).toHaveProperty('ratelimit-limit');
      expect(response.headers).toHaveProperty('ratelimit-remaining');
    });

    test('should include security headers', async () => {
      const response = await request(app)
        .get('/api/status')
        .expect(200);
  
      // Check for some helmet security headers
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-frame-options');
    });
  });
});
