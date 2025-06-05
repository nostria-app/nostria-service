const request = require('supertest');
jest.mock('../src/utils/BaseTableStorageService');

const app = require('../src/index');

describe('General tests', () => {
  test('should return 404 for non-existent endpoints', async () => {
    const response = await request(app)
      .get('/api/non-existent-endpoint')
      .expect(404);

    expect(response.body).toHaveProperty('error');
  });
});
