const logger = require('../utils/logger');
const db = require('../database/supabase');
const sender = require('../whatsapp/sender');
const { generateSignature } = require('./auth');
const config = require('../config');

/**
 * Handle incoming Lalamove Webhook
 */
async function handleLalamoveWebhook(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('hmac ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing HMAC' });
  }

  // Parse Header: hmac <apiKey>:<timestamp>:<signature>
  const parts = authHeader.replace('hmac ', '').split(':');
  if (parts.length !== 3) {
    return res.status(401).json({ error: 'Unauthorized: Invalid Auth Header' });
  }

  const [apiKey, timestamp, signature] = parts;
  // Verify Signature
  // Lalamove signature must be verified against the RAW body string.
  // We use req.rawBody which should be populated by a middleware.
  const bodyStr = req.rawBody || JSON.stringify(req.body);
  const expectedSignature = generateSignature(timestamp, 'POST', '/webhook/lalamove', bodyStr);
  
  if (signature !== expectedSignature) {
    // Fallback check: try with standard JSON stringify if rawBody is missing (for tests)
    const fallbackSignature = generateSignature(timestamp, 'POST', '/webhook/lalamove', JSON.stringify(req.body));
    if (signature !== fallbackSignature) {
      logger.error('❌ Lalamove Webhook Signature Mismatch!');
      return res.status(401).json({ error: 'Unauthorized: Signature Mismatch' });
    }
  }

  const { data, eventType } = req.body;
  if (eventType !== 'ORDER_STATUS_CHANGED') {
    return res.status(200).send('OK'); // Ignore other events for now
  }

  const lalaOrder = data.order;
  const lalaOrderId = lalaOrder.orderId;
  const lalaStatus = lalaOrder.status;

  logger.info({ lalaOrderId, lalaStatus }, '🚚 Lalamove Update Received');

  // Find order in DB by lalamove_order_id
  const { data: order, error } = await db.supabase
    .from('orders')
    .select('*')
    .eq('lalamove_order_id', lalaOrderId)
    .single();

  if (error || !order) {
    logger.warn({ lalaOrderId }, '⚠️ Order with Lalamove ID not found in DB.');
    return res.status(200).send('OK');
  }

  // Map Lalamove status to Internal status
  let internalStatus = order.order_status;
  let customerMsg = '';

  switch (lalaStatus) {
    case 'ASSIGNING_DRIVER':
      customerMsg = `🔍 Sedang mencari kurir untuk pesanan Kakak #${order.order_number}...`;
      break;
    case 'ON_GO':
      customerMsg = `🛵 Kurir sudah mendapatkan pesanan Kakak #${order.order_number} dan sedang menuju toko.`;
      break;
    case 'PICKED_UP':
      internalStatus = 'dispatched';
      customerMsg = `📦 Kurir sedang membawa pesanan Kakak #${order.order_number}! \n\n🔗 Lacak di sini: ${lalaOrder.shareLink || order.lalamove_share_link}`;
      break;
    case 'COMPLETED':
      internalStatus = 'completed';
      customerMsg = `✨ Pesanan #${order.order_number} sudah sampai! Selamat menikmati ya Kak. Terima kasih sudah order di Yoyo Bakery! 🙏`;
      break;
    case 'CANCELLED':
    case 'EXPIRED':
      internalStatus = 'cancelled';
      customerMsg = `❌ Maaf Kak, pengiriman untuk pesanan #${order.order_number} dibatalkan atau kedaluwarsa. Mohon hubungi Admin kami.`;
      break;
  }

  // Update DB if status changed
  if (internalStatus !== order.order_status || lalaStatus !== order.lalamove_status) {
    await db.supabase
      .from('orders')
      .update({ 
        order_status: internalStatus, 
        lalamove_status: lalaStatus,
        lalamove_share_link: lalaOrder.shareLink || order.lalamove_share_link
      })
      .eq('id', order.id);

    // Send notification to customer
    if (customerMsg) {
      await sender.sendText(order.wa_number, customerMsg);
    }
  }

  res.status(200).send('OK');
}

module.exports = { handleLalamoveWebhook };
