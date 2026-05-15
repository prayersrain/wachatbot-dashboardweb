const axios = require('axios');
const config = require('../config');
const { getAuthHeaders } = require('./auth');
const logger = require('../utils/logger');

const BASE_URL = config.lalamove.baseUrl;

/**
 * Get delivery quotation from Lalamove
 * Returns: { quotationId, total, currency, expiresAt, stops }
 */
async function getQuotation(customerLat, customerLng, customerAddress) {
  const path = '/v3/quotations';
  const body = {
    data: {
      serviceType: 'MOTORCYCLE',
      language: 'id_ID',
      stops: [
        {
          coordinates: { 
            lat: config.store.lat.toString(), 
            lng: config.store.lng.toString() 
          },
          address: config.store.address,
        },
        {
          coordinates: { 
            lat: (customerLat || '').toString(), 
            lng: (customerLng || '').toString() 
          },
          address: customerAddress || 'Lokasi Pelanggan',
        },
      ],
      item: {
        quantity: '1',
        weight: 'LESS_THAN_3KG',
        categories: ['FOOD_DELIVERY'],
        handlingInstructions: ['KEEP_UPRIGHT'],
      },
    },
  };

  const bodyStr = JSON.stringify(body);
  const headers = getAuthHeaders('POST', path, bodyStr);

  try {
    const response = await axios.post(`${BASE_URL}${path}`, body, { headers });
    const data = response.data.data;

    return {
      quotationId: data.quotationId,
      total: data.priceBreakdown.total,
      currency: data.priceBreakdown.currency,
      expiresAt: data.expiresAt,
      stops: data.stops,
      distance: data.distance,
    };
  } catch (err) {
    logger.error({ error: err.response?.data || err.message }, '❌ Lalamove getQuotation error');
    return null;
  }
}

/**
 * Create a Lalamove order (dispatch a driver)
 * Returns: { orderId, shareLink, status }
 */
async function createOrder(quotationId, stops, recipientName, recipientPhone, remarks) {
  const path = '/v3/orders';

  // --- SANITASI NOMOR HP ---
  let finalPhone = recipientPhone.replace(/[^\d+]/g, '');
  if (finalPhone.includes('@')) finalPhone = finalPhone.split('@')[0];
  if (!finalPhone.startsWith('+')) {
    if (finalPhone.startsWith('0')) finalPhone = '+62' + finalPhone.slice(1);
    else if (finalPhone.startsWith('62')) finalPhone = '+' + finalPhone;
    else finalPhone = '+62' + finalPhone;
  }

  // Jika nomor kepanjangan (>15 digit), itu pasti ID LID bukan No HP.
  // Kita gunakan nomor toko sebagai fallback agar Lalamove tidak error.
  if (finalPhone.length > 15) {
    logger.warn(`⚠️ Mendeteksi ID LID (${finalPhone}) dikirim ke Lalamove. Menggunakan fallback nomor toko.`);
    finalPhone = config.store.phone; 
  }
  // -------------------------

  const body = {
    data: {
      quotationId,
      sender: {
        stopId: stops[0].stopId,
        name: config.store.name,
        phone: config.store.phone,
      },
      recipients: [
        {
          stopId: stops[1].stopId,
          name: recipientName,
          phone: finalPhone,
          remarks: remarks || '',
        },
      ],
    },
  };

  const bodyStr = JSON.stringify(body);
  const headers = getAuthHeaders('POST', path, bodyStr);

  try {
    const response = await axios.post(`${BASE_URL}${path}`, body, { headers });
    const data = response.data.data;

    return {
      orderId: data.orderId,
      shareLink: data.shareLink,
      status: data.status,
      priceBreakdown: data.priceBreakdown,
    };
  } catch (err) {
    logger.error({ error: err.response?.data || err.message }, '❌ Lalamove createOrder error');
    return null;
  }
}

/**
 * Get Lalamove order details
 */
async function getOrderDetails(orderId) {
  const path = `/v3/orders/${orderId}`;
  const headers = getAuthHeaders('GET', path);

  try {
    const response = await axios.get(`${BASE_URL}${path}`, { headers });
    return response.data.data;
  } catch (err) {
    logger.error({ error: err.response?.data || err.message }, '❌ Lalamove getOrderDetails error');
    return null;
  }
}

module.exports = { getQuotation, createOrder, getOrderDetails };
