const db = require('../src/database/supabase');

// Mock supabase client
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      upsert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({ data: { wa_number: '628123', state: 'ORDER' }, error: null }))
        }))
      })),
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({ data: { wa_number: '628123', state: 'ORDER', data: { items: [] } }, error: null }))
        }))
      })),
      delete: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: null }))
      }))
    }))
  }))
}));

describe('Database Sessions', () => {
  test('upsertSession should save session data', async () => {
    const res = await db.upsertSession('628123', 'ORDER', { items: [] });
    expect(res).toBeDefined();
    expect(res.state).toBe('ORDER');
  });

  test('getSession should retrieve session data', async () => {
    const res = await db.getSession('628123');
    expect(res).toBeDefined();
    expect(res.state).toBe('ORDER');
    expect(res.data).toBeDefined();
  });

  test('deleteSession should remove session', async () => {
    const res = await db.deleteSession('628123');
    expect(res).toBe(true);
  });
});
