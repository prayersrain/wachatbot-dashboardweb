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
const { geocodeAddress } = require('../src/utils/geocoder');
const lalamove = require('../src/lalamove/client');

// Mock dependencies
jest.mock('../src/database/supabase');
jest.mock('../src/whatsapp/sender');
jest.mock('../src/lalamove/client');
jest.mock('../src/flow/aiParser');
jest.mock('../src/utils/geocoder');
jest.mock('../src/whatsapp/baileys', () => ({
  getSocket: jest.fn()
}));

// Now require the handler
const { handleCustomerMessage } = require('../src/flow/customerFlow');

describe('Simplified Customer Flow (4 States)', () => {
  beforeEach(() => {
    jest.resetAllMocks();

    // Re-setup db.supabase chain which gets reset by resetAllMocks
    db.supabase = {
      from: jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { order_number: 42, id: 'order-123' }, error: null })
          })
        })
      })
    };

    // Setup default mock values
    db.getSession.mockResolvedValue(null);
    db.upsertSession.mockResolvedValue(null);
    db.deleteSession.mockResolvedValue(null);
    db.getLastOrder.mockResolvedValue(null);
    db.upsertCustomer.mockResolvedValue(null);
    db.updateOrder.mockResolvedValue(null);

    db.getProducts.mockResolvedValue([
      { id: 1, name: 'Bolen Coklat', price: 34000, stock_type: 'ready' },
      { id: 2, name: 'Nastar Classic', price: 40000, stock_type: 'ready' }
    ]);

    aiParseOrder.mockResolvedValue(null);
    geocodeAddress.mockResolvedValue(null);
    lalamove.getQuotation.mockResolvedValue(null);
  });

  test('Scenario 1: Happy path — Kirim (template)', async () => {
    // Step 1: First message "Halo" -> transition to REGION_SELECT
    db.getSession.mockResolvedValueOnce(null);
    await handleCustomerMessage('cust_1', 'Budi', { text: { body: 'Halo' } });
    
    expect(db.upsertSession).toHaveBeenCalledWith('cust_1', 'REGION_SELECT', expect.any(Object));
    expect(sender.sendText).toHaveBeenCalledWith('cust_1', expect.stringContaining('wilayah'));

    // Step 2: "Jakarta" -> transition to WAITING_ORDER, send menu + template
    db.getSession.mockResolvedValueOnce({ state: 'REGION_SELECT', data: { customerName: 'Budi' } });
    aiParseOrder.mockResolvedValueOnce({ intent: 'REGION_MATCH', region: 'jakarta', answer: 'Siap Jakarta!' });
    
    await handleCustomerMessage('cust_1', 'Budi', { text: { body: 'Jakarta' } });
    expect(db.upsertSession).toHaveBeenCalledWith('cust_1', 'WAITING_ORDER', expect.any(Object));
    expect(sender.sendText).toHaveBeenCalledWith('cust_1', expect.stringContaining('FORMAT PESANAN'));

    // Step 3: Filled template -> geocode, calculate shipping, finalize -> transition to PAYMENT
    db.getSession.mockResolvedValueOnce({ 
      state: 'WAITING_ORDER', 
      data: { customerName: 'Budi' } 
    });
    
    geocodeAddress.mockResolvedValueOnce({ lat: -6.1, lng: 106.8, formattedAddress: 'Jl. Raya Bogor No 1, Jakarta' });
    lalamove.getQuotation.mockResolvedValueOnce({
      total: "15000",
      distance: { value: 5000 },
      quotationId: 'q-123'
    });

    const filledTemplate = `Nama: Budi\nPesanan: Bolen Coklat 2\nPengiriman: Kirim\nAlamat: Jl. Raya Bogor No 1\nNo HP: 081234567890\nCatatan: -`;
    await handleCustomerMessage('cust_1', 'Budi', { text: { body: filledTemplate } });

    expect(db.upsertSession).toHaveBeenCalledWith('cust_1', 'PAYMENT', expect.objectContaining({
      orderNumber: 42,
      orderId: 'order-123',
      totalPrice: 83000 // (34k * 2) + 15k shipping
    }));
    expect(sender.sendText).toHaveBeenCalledWith('cust_1', expect.stringContaining('BCA'));
    expect(sender.sendText).toHaveBeenCalledWith('cust_1', expect.stringContaining('BUKTI TRANSFER'));
  });

  test('Scenario 2: Happy path — Pickup (template)', async () => {
    // Step 1: WAITING_ORDER state, filled template for Pickup
    db.getSession.mockResolvedValueOnce({ 
      state: 'WAITING_ORDER', 
      data: { customerName: 'Budi' } 
    });

    const filledTemplate = `Nama: Budi\nPesanan: Nastar Classic 1\nPengiriman: Ambil di Toko\nAlamat: \nNo HP: 081234567890\nCatatan: -`;
    await handleCustomerMessage('cust_1', 'Budi', { text: { body: filledTemplate } });

    // For pickup, geocoding & Lalamove are skipped.
    expect(geocodeAddress).not.toHaveBeenCalled();
    expect(lalamove.getQuotation).not.toHaveBeenCalled();

    expect(db.upsertSession).toHaveBeenCalledWith('cust_1', 'PAYMENT', expect.objectContaining({
      orderNumber: 42,
      totalPrice: 40000 // 40k subtotal + 0 shipping
    }));
    expect(sender.sendText).toHaveBeenCalledWith('cust_1', expect.stringContaining('Ambil Sendiri di Toko'));
  });

  test('Scenario 3: Happy path — Free-form via AI', async () => {
    db.getSession.mockResolvedValueOnce({ 
      state: 'WAITING_ORDER', 
      data: { customerName: 'Budi' } 
    });

    aiParseOrder.mockResolvedValueOnce({
      intent: 'ORDER',
      items: [{ name: 'Bolen Coklat', qty: 2 }],
      customerName: 'Budi',
      customerPhone: '081234567890',
      address: 'Jl. Sudirman, Jakarta',
      deliveryMethod: 'kirim'
    });

    geocodeAddress.mockResolvedValueOnce({ lat: -6.2, lng: 106.8, formattedAddress: 'Jl. Sudirman, Jakarta' });
    lalamove.getQuotation.mockResolvedValueOnce({
      total: "12000",
      distance: { value: 4000 },
      quotationId: 'q-456'
    });

    await handleCustomerMessage('cust_1', 'Budi', { text: { body: 'Pesan bolen coklat 2 box kirim ke sudirman jakarta ya, atas nama budi hp 081234567890' } });

    expect(db.upsertSession).toHaveBeenCalledWith('cust_1', 'PAYMENT', expect.objectContaining({
      orderNumber: 42,
      totalPrice: 80000 // 68k + 12k shipping
    }));
  });

  test('Scenario 5: Pickup dari awal (auto-finalize from IDLE state)', async () => {
    db.getSession.mockResolvedValueOnce(null);

    // AI parses everything from first message
    aiParseOrder.mockResolvedValueOnce({
      intent: 'ORDER',
      items: [{ name: 'Bolen Coklat', qty: 1 }],
      customerName: 'Budi',
      customerPhone: '081234567890',
      deliveryMethod: 'pickup',
      address: 'Jakarta' // triggers auto-skip
    });

    await handleCustomerMessage('cust_1', 'Budi', { text: { body: 'Pesan bolen coklat 1 box ambil di toko, atas nama Budi HP 081234567890' } });

    // It should skip REGION_SELECT and directly finalize to PAYMENT
    expect(db.upsertSession).toHaveBeenCalledWith('cust_1', 'PAYMENT', expect.objectContaining({
      orderNumber: 42,
      totalPrice: 34000
    }));
  });

  test('Scenario 6: Returning customer pre-fill', async () => {
    db.getSession.mockResolvedValueOnce({ state: 'REGION_SELECT', data: {} });
    aiParseOrder.mockResolvedValueOnce({ intent: 'REGION_MATCH', region: 'jakarta' });

    // Mock last order exists
    db.getLastOrder.mockResolvedValueOnce({
      customer_name: 'Anto',
      wa_number: '628999999@s.whatsapp.net'
    });

    await handleCustomerMessage('cust_1', 'Anto', { text: { body: 'Jakarta' } });

    // It should pre-fill the name & phone in WAITING_ORDER state
    expect(db.upsertSession).toHaveBeenCalledWith('cust_1', 'WAITING_ORDER', expect.objectContaining({
      customerName: 'Anto',
      customerPhone: '628999999'
    }));
    expect(sender.sendText).toHaveBeenCalledWith('cust_1', expect.stringContaining('Nama: Anto'));
    expect(sender.sendText).toHaveBeenCalledWith('cust_1', expect.stringContaining('No HP: 628999999'));
  });

  test('Scenario 9: Luar Jakarta redirection', async () => {
    db.getSession.mockResolvedValueOnce({ state: 'REGION_SELECT', data: {} });
    aiParseOrder.mockResolvedValueOnce({ intent: 'REGION_MATCH', region: 'luar_jakarta' });

    await handleCustomerMessage('cust_1', 'Budi', { text: { body: 'Bandung' } });

    expect(db.upsertSession).toHaveBeenCalledWith('cust_1', 'REJECTED', expect.any(Object));
    expect(sender.sendText).toHaveBeenCalledWith('cust_1', expect.stringContaining('Shopee'));
  });

  test('Scenario 10: Ongkir > 80k rejection', async () => {
    db.getSession.mockResolvedValueOnce({ 
      state: 'WAITING_ORDER', 
      data: { customerName: 'Budi' } 
    });

    const filledTemplate = `Nama: Budi\nPesanan: Bolen Coklat 2\nPengiriman: Kirim\nAlamat: Jl. Jauh Sekali, Bogor\nNo HP: 081234567890`;
    geocodeAddress.mockResolvedValueOnce({ lat: -6.5, lng: 106.9, formattedAddress: 'Jl. Jauh Sekali, Bogor' });
    
    // Quotation gives high fee
    lalamove.getQuotation.mockResolvedValueOnce({
      total: "85000",
      distance: { value: 45000 },
      quotationId: 'q-999'
    });

    await handleCustomerMessage('cust_1', 'Budi', { text: { body: filledTemplate } });

    expect(db.upsertSession).toHaveBeenCalledWith('cust_1', 'REJECTED', expect.any(Object));
    expect(sender.sendText).toHaveBeenCalledWith('cust_1', expect.stringContaining('terlalu mahal'));
  });

  test('Scenario 14: Batal di PAYMENT', async () => {
    db.getSession.mockResolvedValueOnce({
      state: 'PAYMENT',
      data: { orderId: 'order-123', orderNumber: 42 }
    });

    aiParseOrder.mockResolvedValueOnce({ intent: 'CANCEL' });

    await handleCustomerMessage('cust_1', 'Budi', { text: { body: 'batal' } });

    // Should cancel order in DB and reset session to IDLE
    expect(db.updateOrder).toHaveBeenCalledWith('order-123', { order_status: 'cancelled' });
    expect(db.upsertSession).toHaveBeenCalledWith('cust_1', 'IDLE', expect.any(Object));
  });

  test('Scenario 15: Modifikasi di PAYMENT', async () => {
    db.getSession.mockResolvedValueOnce({
      state: 'PAYMENT',
      data: { 
        orderId: 'order-123', 
        orderNumber: 42, 
        items: [{ name: 'Bolen Coklat', qty: 2, price: 34000 }],
        customerName: 'Budi',
        customerPhone: '081234567890',
        deliveryMethod: 'pickup'
      }
    });

    aiParseOrder.mockResolvedValueOnce({
      intent: 'ORDER',
      items: [{ name: 'Bolen Coklat', qty: 1, action: 'add' }]
    });

    await handleCustomerMessage('cust_1', 'Budi', { text: { body: 'tambah Bolen Coklat 1' } });

    // Should cancel old order
    expect(db.updateOrder).toHaveBeenCalledWith('order-123', { order_status: 'cancelled' });
    
    // Should revert back to WAITING_ORDER and restore items (the logic inside customerFlow handles the modification after reverting)
    expect(db.upsertSession).toHaveBeenCalledWith('cust_1', 'WAITING_ORDER', expect.objectContaining({
      orderId: null,
      items: [{ name: 'Bolen Coklat', qty: 2, price: 34000 }] // First reverted, then processed
    }));
  });

  test('Scenario 16: Auto-skip region select from IDLE', async () => {
    db.getSession.mockResolvedValueOnce(null);

    // Customer types a message that clearly contains Jakarta address
    aiParseOrder.mockResolvedValueOnce({
      intent: 'ORDER',
      items: [{ name: 'Nastar Classic', qty: 1 }],
      address: 'Jl. Raya Bogor No 1, Jakarta',
      customerName: 'Budi',
      customerPhone: '081234567890',
      deliveryMethod: 'kirim'
    });

    geocodeAddress.mockResolvedValueOnce({ lat: -6.1, lng: 106.8, formattedAddress: 'Jl. Raya Bogor No 1, Jakarta' });
    lalamove.getQuotation.mockResolvedValueOnce({
      total: "15000",
      distance: { value: 5000 },
      quotationId: 'q-123'
    });

    await handleCustomerMessage('cust_1', 'Budi', { text: { body: 'Pesan Nastar Classic 1 box kirim ke Jl. Raya Bogor No 1, Jakarta, atas nama Budi HP 081234567890' } });

    // Should skip REGION_SELECT and directly finalize to PAYMENT
    expect(db.upsertSession).toHaveBeenCalledWith('cust_1', 'PAYMENT', expect.objectContaining({
      orderNumber: 42,
      totalPrice: 55000 // 40k + 15k shipping
    }));
  });
});
