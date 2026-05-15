// Mock ESM modules BEFORE anything else
jest.mock('@whiskeysockets/baileys', () => ({
  default: jest.fn(),
  downloadMediaMessage: jest.fn()
}));
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid')
}));

const db = require('../src/database/supabase');
const sender = require('../src/whatsapp/sender');
const { aiParseOrder } = require('../src/flow/aiParser');

// Mock other dependencies
jest.mock('../src/database/supabase');
jest.mock('../src/whatsapp/sender');
jest.mock('../src/lalamove/client');
jest.mock('../src/flow/aiParser');
jest.mock('../src/whatsapp/baileys', () => ({
  getSocket: jest.fn()
}));

// Now require the handler
const { handleCustomerMessage } = require('../src/flow/customerFlow');

describe('Customer Flow with AI & DB Sessions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default AI response (No intent)
    aiParseOrder.mockResolvedValue(null);
  });

  test('should initialize session with REGION_CHECK when idle and greeting', async () => {
    db.getSession.mockResolvedValue(null);
    db.getProducts.mockResolvedValue([{ id: 1, name: 'Roti', price: 10000, category: 'roti_pastry', stock_type: 'ready' }]);
    
    await handleCustomerMessage('628123', 'Zan', { text: { body: 'halo' } });
    
    expect(db.getSession).toHaveBeenCalledWith('628123');
    // Greeting sekarang masuk ke REGION_CHECK (tanya Jakarta / Luar Jakarta)
    expect(db.upsertSession).toHaveBeenCalledWith('628123', 'REGION_CHECK');
    expect(sender.sendText).toHaveBeenCalledWith('628123', expect.stringContaining('Yoyo Bakery'));
  });

  test('should transition to CATALOG when user selects Jakarta', async () => {
    db.getSession.mockResolvedValue({ state: 'REGION_CHECK', data: {} });
    db.getProducts.mockResolvedValue([{ id: 1, name: 'Roti', price: 10000, category: 'roti_pastry', stock_type: 'ready' }]);

    // Simulate keyword match for Jakarta
    aiParseOrder.mockResolvedValue({ intent: 'REGION_JAKARTA', items: [] });

    await handleCustomerMessage('628123', 'Zan', { text: { body: 'jakarta' } });

    expect(db.upsertSession).toHaveBeenCalledWith('628123', 'CATALOG');
    expect(sender.sendText).toHaveBeenCalledWith('628123', expect.stringContaining('Jakarta'));
  });

  test('should send Shopee link when user selects Luar Jakarta', async () => {
    db.getSession.mockResolvedValue({ state: 'REGION_CHECK', data: {} });

    // Simulate keyword match for Luar Jakarta
    aiParseOrder.mockResolvedValue({ intent: 'REGION_LUAR', items: [] });

    await handleCustomerMessage('628123', 'Zan', { text: { body: 'luar jakarta' } });

    expect(db.deleteSession).toHaveBeenCalledWith('628123');
    expect(sender.sendText).toHaveBeenCalledWith('628123', expect.stringContaining('Shopee'));
  });

  test('should call sendLocationRequest when in LOCATION state and message is not location', async () => {
    db.getSession.mockResolvedValue({ 
      state: 'LOCATION', 
      data: { name: 'Zan', items: [] } 
    });
    
    await handleCustomerMessage('628123', 'Zan', { text: { body: 'mau kirim ke sini' } });
    
    expect(db.getSession).toHaveBeenCalledWith('628123');
    // It should call sendLocationRequest instead of sendText
    expect(sender.sendLocationRequest).toHaveBeenCalledWith('628123', expect.any(String));
  });

  test('should go to REGION_CHECK when ORDER intent received from IDLE state', async () => {
    db.getSession.mockResolvedValue(null);
    db.getProducts.mockResolvedValue([{ id: 1, name: 'Roti', price: 10000, category: 'roti_pastry', stock_type: 'ready' }]);
    
    // Simulate AI detecting an order from IDLE state
    aiParseOrder.mockResolvedValue({
      intent: 'ORDER',
      items: [{ name: 'Roti', qty: 2 }]
    });

    await handleCustomerMessage('628123', 'Zan', { text: { body: 'Pesan roti 2' } });

    // Dari state IDLE, order intent akan diarahkan ke greeting (REGION_CHECK) dulu
    expect(db.upsertSession).toHaveBeenCalledWith('628123', 'REGION_CHECK');
    expect(sender.sendText).toHaveBeenCalledWith('628123', expect.any(String));
  });

  test('should respond with thanks message', async () => {
    db.getSession.mockResolvedValue(null);

    aiParseOrder.mockResolvedValue({
      intent: 'THANKS',
      items: [],
      answer: 'Sama-sama Kak! 😊 Senang bisa membantu. Jangan ragu hubungi kami lagi ya! 🍞'
    });

    await handleCustomerMessage('628123', 'Zan', { text: { body: 'makasih kak' } });

    expect(sender.sendText).toHaveBeenCalledWith('628123', expect.stringContaining('Sama-sama'));
  });

  test('should reject order if Lalamove fee is over Rp 70.000', async () => {
    const lalamove = require('../src/lalamove/client');
    db.getSession.mockResolvedValue({ 
      state: 'LOCATION', 
      data: { items: [{ name: 'Roti', qty: 1, price: 10000 }] } 
    });
    
    // Mock Lalamove with expensive fee
    lalamove.getQuotation.mockResolvedValue({
      total: "85000",
      distance: { value: 50000 },
      quotationId: 'q-123'
    });

    await handleCustomerMessage('628123', 'Zan', { 
      type: 'location',
      location: { latitude: -6.1, longitude: 106.8 } 
    });

    expect(sender.sendText).toHaveBeenCalledWith('628123', expect.stringContaining('terlalu mahal'));
    expect(db.upsertSession).not.toHaveBeenCalledWith('628123', 'CONFIRM', expect.any(Object));
  });

  test('should include special notes in order summary', async () => {
    db.getSession.mockResolvedValue({ 
      state: 'CATALOG', 
      data: { items: [] } 
    });
    
    // Simulate AI detecting order with notes
    aiParseOrder.mockResolvedValue({
      intent: 'ORDER',
      items: [{ name: 'Roti', qty: 2 }],
      notes: 'Jangan dikasih keju'
    });
    db.getProducts.mockResolvedValue([{ id: 1, name: 'Roti', price: 10000, category: 'roti_pastry', stock_type: 'ready' }]);

    await handleCustomerMessage('628123', 'Zan', { text: { body: 'Pesan roti 2 jangan pake keju' } });

    // Summary should contain the notes
    expect(sender.sendText).toHaveBeenCalledWith('628123', expect.stringContaining('Catatan Khusus'));
    expect(sender.sendText).toHaveBeenCalledWith('628123', expect.stringContaining('Jangan dikasih keju'));
  });
});
