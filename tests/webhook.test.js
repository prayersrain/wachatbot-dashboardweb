const request = require('supertest');
const app = require('../src/app');
const db = require('../src/database/supabase');
const sender = require('../src/whatsapp/sender');
const { generateSignature } = require('../src/lalamove/auth');
const config = require('../src/config');

jest.mock('../src/database/supabase');
jest.mock('../src/whatsapp/sender');
jest.mock('@whiskeysockets/baileys', () => ({ default: jest.fn() }));
jest.mock('uuid', () => ({ v4: () => 'test' }));

describe('Lalamove Webhook Handler', () => {
  const path = '/webhook/lalamove';
  
  test('should return 401 if signature is missing', async () => {
    const response = await request(app).post(path).send({});
    expect(response.statusCode).toBe(401);
  });

  test('should return 401 if signature is invalid', async () => {
    const response = await request(app)
      .post(path)
      .set('Authorization', 'hmac key:123:wrong')
      .send({});
    expect(response.statusCode).toBe(401);
  });

  test('should process valid status change (PICKED_UP)', async () => {
    const body = {
      data: {
        order: {
          orderId: 'LALA123',
          status: 'PICKED_UP',
          shareLink: 'http://track.lala/123'
        }
      },
      eventType: 'ORDER_STATUS_CHANGED'
    };
    
    const timestamp = Date.now().toString();
    const sig = generateSignature(timestamp, 'POST', path, JSON.stringify(body));
    const auth = `hmac ${config.lalamove.apiKey}:${timestamp}:${sig}`;

    // Mock DB finding order by Lalamove ID
    db.supabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ 
            data: { id: 1, order_number: 10, wa_number: '628123', order_status: 'confirmed' }, 
            error: null 
          })
        })
      }),
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: {}, error: null })
      })
    });

    const response = await request(app)
      .post(path)
      .set('Authorization', auth)
      .send(body);

    expect(response.statusCode).toBe(200);
    expect(sender.sendText).toHaveBeenCalledWith('628123', expect.stringContaining('sedang membawa pesanan'));
  });
});
