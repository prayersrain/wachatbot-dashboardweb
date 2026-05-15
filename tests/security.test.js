// Mock Baileys BEFORE anything else
jest.mock('@whiskeysockets/baileys', () => ({
  default: jest.fn(),
  downloadMediaMessage: jest.fn()
}));
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid')
}));

const request = require('supertest');
const app = require('../src/app');

describe('Security Middleware', () => {
  test('should rate limit requests to /webhook/lalamove', async () => {
    const responses = [];
    for (let i = 0; i < 25; i++) {
      responses.push(request(app).post('/webhook/lalamove').send({}));
    }
    
    const results = await Promise.all(responses);
    const throttled = results.filter(r => r.statusCode === 429);
    
    expect(throttled.length).toBeGreaterThan(0);
  });
});
