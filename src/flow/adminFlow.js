const logger = require('../utils/logger');
const sender = require('../whatsapp/sender');
const db = require('../database/supabase');
const lalamove = require('../lalamove/client');
const { formatRupiah } = require('./orderParser');
const config = require('../config');
const { generateDailyReport } = require('../utils/excelExporter');

/**
 * Handle admin slash commands
 */
async function handleAdminCommand(from, text) {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg = parts[1];

  switch (cmd) {
    case '/status':
      return cmdStatus(from);
    case '/export':
      return cmdExport(from, arg);
    case '/struk':
      return cmdStruk(from, arg);
    case '/kirim':
      return cmdDispatch(from, arg);
    case '/cek':
      return cmdCheck(from, arg);
    case '/bayar':
      return cmdPayment(from, arg);
    case '/batal':
      return cmdCancel(from, arg);
    case '/selesai':
      return cmdComplete(from, arg);
    case '/pause':
      return cmdPause(from);
    case '/resume':
      return cmdResume(from);
    case '/po':
      return cmdUpdateStockType(from, parts.slice(1).join(' '), 'po');
    case '/ready':
      return cmdUpdateStockType(from, parts.slice(1).join(' '), 'ready');
    case '/habis':
      return cmdUpdateStock(from, parts.slice(1).join(' '), false);
    case '/ada':
      return cmdUpdateStock(from, parts.slice(1).join(' '), true);
    case '/help':
    case '/bantuan':
      return cmdHelp(from);
    default:
      return sender.sendText(from, `⚠️ Perintah tidak dikenal: ${cmd}\n\nKetik */help* untuk daftar perintah.`);
  }
}

/**
 * /status - Show today's order summary and production list
 */
async function cmdStatus(from) {
  const orders = await db.getTodayOrders();
  if (!orders.length) {
    return sender.sendText(from, '📊 *Status Hari Ini*\n\nBelum ada pesanan.');
  }

  const stats = { new: 0, waiting_payment: 0, confirmed: 0, packing: 0, shipping: 0, completed: 0, cancelled: 0 };
  let totalRevenue = 0;
  const productionList = {}; // Untuk menghitung total item

  orders.forEach((o) => {
    stats[o.order_status] = (stats[o.order_status] || 0) + 1;
    if (o.order_status !== 'cancelled') {
      totalRevenue += o.total_price;
      // Tambahkan item ke daftar produksi
      o.items.forEach(item => {
        productionList[item.name] = (productionList[item.name] || 0) + item.qty;
      });
    }
  });

  let msg = `📊 *RINGKASAN HARI INI*\n`;
  msg += `--------------------------\n`;
  msg += `🆕 Baru: ${stats.new + stats.waiting_payment}\n`;
  msg += `✅ Bayar: ${stats.confirmed}\n`;
  msg += `📦 Pack: ${stats.packing}\n`;
  msg += `🚚 Kirim: ${stats.shipping}\n`;
  msg += `💰 Revenue: ${formatRupiah(totalRevenue)}\n\n`;

  msg += `👨‍🍳 *DAFTAR PRODUKSI:* \n`;
  Object.keys(productionList).forEach(name => {
    msg += `• ${name}: *${productionList[name]}*\n`;
  });

  msg += `\n📋 *5 Pesanan Terakhir:*\n`;
  orders.slice(0, 5).forEach((o) => {
    const statusIcon = { new: '🆕', waiting_payment: '⏳', confirmed: '✅', packing: '📦', shipping: '🚚', completed: '✔️', cancelled: '❌' };
    msg += `${statusIcon[o.order_status] || '❓'} #${o.order_number} - ${o.customer_name}\n`;
  });

  await sender.sendText(from, msg);
}

/**
 * /export - Export recent active orders to Excel
 */
async function cmdExport(from, arg) {
  await sender.sendText(from, '⏳ Sedang membuat laporan Excel...');
  
  let orders;
  if (arg === 'semua') {
    orders = await db.getRecentActiveOrders(3); // 3 hari terakhir
  } else {
    orders = await db.getTodayOrders(); // Default hari ini
  }

  if (!orders || orders.length === 0) {
    return sender.sendText(from, '⚠️ Tidak ada pesanan untuk diexport.');
  }

  const filePath = await generateDailyReport(orders);
  if (!filePath) {
    return sender.sendText(from, '❌ Gagal membuat file Excel.');
  }

  // send document
  const { getSocket } = require('../whatsapp/baileys');
  const sock = getSocket();
  let jid = from;
  if (!jid.includes('@')) {
    // Bersihkan dari karakter non-digit
    const cleanNumber = jid.replace(/\D/g, '');
    jid = `${cleanNumber}@s.whatsapp.net`;
  }
  
  // Jika nomor diawali 0, ganti ke 62
  if (jid.startsWith('0')) {
    jid = '62' + jid.slice(1);
    if (!jid.includes('@')) jid += '@s.whatsapp.net';
  }
  
  try {
    await sock.sendMessage(jid, { 
      document: { url: filePath }, 
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: require('path').basename(filePath),
      caption: '📊 *Laporan Pesanan & Rekap Produksi*' 
    });
  } catch (err) {
    logger.error({ err }, '❌ Error sending excel file');
    await sender.sendText(from, '❌ Gagal mengirim file Excel.');
  }
}

/**
 * /struk [order_number] - Show detailed text receipt
 */
async function cmdStruk(from, orderNum) {
  if (!orderNum) return sender.sendText(from, '⚠️ Format: */struk [nomor pesanan]*\nContoh: /struk 5');

  const order = await db.getOrderByNumber(parseInt(orderNum));
  if (!order) return sender.sendText(from, `❌ Pesanan #${orderNum} tidak ditemukan.`);

  const { buildOrderSummary } = require('./orderParser');
  const { text: summary } = buildOrderSummary(order.items, order.delivery_fee);
  
  // Ekstrak nomor HP dari notes jika ada (customer LID)
  let displayPhone = order.wa_number.split('@')[0];
  let cleanNotes = order.notes || '';
  if (cleanNotes) {
    const phoneMatch = cleanNotes.match(/\(HP:\s*(\d+)\)/);
    if (phoneMatch) {
      displayPhone = phoneMatch[1]; // Gunakan nomor asli untuk display
      cleanNotes = cleanNotes.replace(/\s*\(HP:\s*\d+\)/, '').trim(); // Bersihkan dari notes
    }
  }
  
  // Format wa.me link
  const waLink = /^\d+$/.test(displayPhone) && displayPhone.length >= 10 
    ? `wa.me/${displayPhone}` 
    : displayPhone;
  
  let msg = `🧾 *STRUK PESANAN #${order.order_number}*\n`;
  msg += `Tanggal: ${new Date(order.created_at).toLocaleString('id-ID')}\n`;
  msg += `--------------------------\n`;
  msg += `👤 *Customer:* ${order.customer_name}\n`;
  msg += `📱 *WA:* ${waLink}\n`;
  msg += `📍 *Alamat Tujuan:*\n${order.customer_address}\n\n`;
  msg += `${summary}\n\n`;
  
  if (cleanNotes) {
    msg += `📝 *Catatan:* ${cleanNotes}\n\n`;
  }

  const paymentStatusMap = { pending: '🟡 Belum Bayar', reviewing: '🟠 Menunggu Konfirmasi', paid: '🟢 LUNAS' };
  const orderStatusMap = { new: '🆕 Baru', waiting_payment: '⏳ Tunggu Bayar', confirmed: '✅ Dikonfirmasi', packing: '📦 Diproses (PO)', shipping: '🚚 Dikirim', completed: '✔️ Selesai', cancelled: '❌ Batal' };
  
  msg += `💰 *Status Pembayaran:* ${paymentStatusMap[order.payment_status] || order.payment_status}\n`;
  msg += `📦 *Status Pesanan:* ${orderStatusMap[order.order_status] || order.order_status}\n`;

  if (order.lalamove_share_link) {
    msg += `\n🔗 *Tracking Lalamove:*\n${order.lalamove_share_link}`;
  }

  await sender.sendText(from, msg);
}

/**
 * /kirim [order_number] - Dispatch Lalamove courier
 */
async function cmdDispatch(from, orderNum) {
  if (!orderNum) return sender.sendText(from, '⚠️ Format: */kirim [nomor pesanan]*\nContoh: /kirim 5');

  const order = await db.getOrderByNumber(parseInt(orderNum));
  if (!order) return sender.sendText(from, `❌ Pesanan #${orderNum} tidak ditemukan.`);

  if (order.order_status === 'dispatched' || order.order_status === 'completed') {
    return sender.sendText(from, `⚠️ Pesanan #${orderNum} sudah dikirim atau selesai.\n\n🔗 ${order.lalamove_share_link || 'Link tracking belum tersedia'}`);
  }

  if (order.order_status === 'cancelled') {
    return sender.sendText(from, `❌ Pesanan #${orderNum} sudah dibatalkan.`);
  }

  if (order.order_status === 'new') {
    return sender.sendText(from, `⚠️ Pesanan #${orderNum} belum dibayar. Gunakan */bayar ${orderNum}* jika pembayaran sudah diterima.`);
  }

  if (!order.lalamove_quotation_id) {
    return sender.sendText(from, `⚠️ Pesanan #${orderNum} belum ada quotation Lalamove. Pelanggan mungkin belum kirim lokasi.`);
  }

  await sender.sendText(from, `🔄 Memanggil kurir untuk pesanan #${orderNum}...`);

  // Re-fetch quotation untuk mendapatkan stop ID yang valid (quotation lama mungkin expired)
  const q = await lalamove.getQuotation(
    order.customer_lat,
    order.customer_lng,
    order.customer_address || 'Lokasi Pelanggan'
  );

  if (!q) {
    return sender.sendText(from, `❌ Gagal membuat quotation baru untuk #${orderNum}. Coba lagi nanti.`);
  }

  // Pastikan Nama Penerima tidak kosong (Lalamove butuh string)
  const finalRecipientName = order.customer_name || 'Pelanggan Yoyo Bakery';

  // Ekstrak nomor HP dari notes jika ada (untuk customer yang memakai LID)
  let phoneToUse = order.wa_number;
  if (order.notes) {
    const match = order.notes.match(/\(HP:\s*(\d+)\)/);
    if (match) {
      phoneToUse = match[1];
    }
  }

  const result = await lalamove.createOrder(
    q.quotationId,
    q.stops,
    finalRecipientName,
    phoneToUse,
    `Pesanan Yoyo Bakery #${order.order_number}`
  );

  if (!result) {
    return sender.sendText(from, `❌ Gagal memanggil kurir untuk #${orderNum}. Silakan coba lagi.`);
  }

  // Update order in DB
  await db.updateOrder(order.id, {
    lalamove_order_id: result.orderId,
    lalamove_share_link: result.shareLink,
    lalamove_status: result.status,
    order_status: 'shipping',
  });

  // Notify admin
  await sender.sendText(from, `✅ Kurir dipanggil untuk #${orderNum}!\n\n🔗 Tracking: ${result.shareLink || 'Sedang diproses'}\n📊 Status: ${result.status}`);

  // Notify customer
  logger.info({ to: order.wa_number }, '📤 Mengirim notifikasi kirim ke pelanggan');
  await sender.sendText(
    order.wa_number,
    `🚚 *Pesanan #${order.order_number} sedang dalam perjalanan!*\n\n${result.shareLink ? `🔗 Track kurir: ${result.shareLink}` : 'Kurir sedang dalam perjalanan.'}\n\nDitunggu rotinya ya Kak! 😊`
  );
}

/**
 * /cek [order_number] - Check order details
 */
async function cmdCheck(from, orderNum) {
  if (!orderNum) return sender.sendText(from, '⚠️ Format: */cek [nomor pesanan]*');

  const order = await db.getOrderByNumber(parseInt(orderNum));
  if (!order) return sender.sendText(from, `❌ Pesanan #${orderNum} tidak ditemukan.`);

  const itemsTotal = order.items.reduce((sum, i) => sum + ((i.price || 0) * (i.qty || 0)), 0);
  const items = order.items.map((i) => `• ${i.name} x${i.qty} = ${formatRupiah((i.price || 0) * (i.qty || 0))}`).join('\n');
  const statusMap = { new: '🆕 Baru', waiting_payment: '⏳ Tunggu Bayar', confirmed: '✅ Dikonfirmasi', packing: '📦 Dikemas', shipping: '🚚 Dikirim', completed: '✔️ Selesai', cancelled: '❌ Batal' };

  let msg = `📋 *Detail Pesanan #${order.order_number}*\n\n`;
  msg += `👤 ${order.customer_name}\n📱 wa.me/${order.wa_number}\n`;
  msg += `📍 ${order.customer_address || '-'}\n\n`;
  msg += `📦 *Item:*\n${items}\n\n`;
  msg += `💰 Subtotal: ${formatRupiah(itemsTotal)}\n`;
  msg += `🚚 Ongkir: ${formatRupiah(order.delivery_fee)}\n`;
  msg += `💵 *Total: ${formatRupiah(order.total_price)}*\n\n`;
  msg += `📊 Status: ${statusMap[order.order_status] || order.order_status}\n`;
  msg += `💳 Bayar: ${order.payment_status}\n`;

  if (order.lalamove_share_link) {
    msg += `\n🔗 Tracking: ${order.lalamove_share_link}`;
  }

  await sender.sendText(from, msg);
}

/**
 * /bayar [order_number] - Confirm payment received
 */
async function cmdPayment(from, orderNum) {
  if (!orderNum) return sender.sendText(from, '⚠️ Format: */bayar [nomor pesanan]*');

  const order = await db.getOrderByNumber(parseInt(orderNum));
  if (!order) return sender.sendText(from, `❌ Pesanan #${orderNum} tidak ditemukan.`);

  if (order.payment_status === 'paid') {
    return sender.sendText(from, `⚠️ Pesanan #${orderNum} sudah ditandai Lunas.`);
  }

  if (order.order_status === 'cancelled') {
    return sender.sendText(from, `❌ Pesanan #${orderNum} sudah dibatalkan.`);
  }

  // Update DB
  await db.updateOrder(order.id, { payment_status: 'paid', order_status: 'confirmed' });

  // HAPUS SESI PELANGGAN
  await db.deleteSession(order.wa_number);

  // Notify Admin
  await sender.sendText(from, `✅ Pembayaran #${orderNum} dikonfirmasi!\n\n➡️ Ketik */kirim ${orderNum}* setelah pesanan siap.`);

  // Resolve Customer Number (Prioritaskan nomor asli dari notes)
  let customerJid = order.wa_number;
  if (order.notes) {
    const match = order.notes.match(/\(HP:\s*(\d+)\)/);
    if (match) customerJid = match[1];
  }

  // Notify customer
  logger.info({ to: customerJid }, '📤 Mengirim notifikasi bayar ke pelanggan');
  await sender.sendText(customerJid, `✅ *Pembayaran pesanan #${order.order_number} diterima!*\n\nPesanan Kakak sedang disiapkan. Kami akan kirim notifikasi saat kurir berangkat. 🙏`);
}

/**
 * /batal [order_number] - Cancel order
 */
async function cmdCancel(from, orderNum) {
  if (!orderNum) return sender.sendText(from, '⚠️ Format: */batal [nomor pesanan]*');

  const order = await db.getOrderByNumber(parseInt(orderNum));
  if (!order) return sender.sendText(from, `❌ Pesanan #${orderNum} tidak ditemukan.`);

  await db.updateOrder(order.id, { order_status: 'cancelled' });
  await sender.sendText(from, `❌ Pesanan #${orderNum} dibatalkan.`);
  await sender.sendText(order.wa_number, `❌ Maaf, pesanan #${order.order_number} dibatalkan oleh Admin. Hubungi kami untuk info lebih lanjut.`);
}

/**
 * /selesai [order_number] - Mark order as completed
 */
async function cmdComplete(from, orderNum) {
  if (!orderNum) return sender.sendText(from, '⚠️ Format: */selesai [nomor pesanan]*');

  const order = await db.getOrderByNumber(parseInt(orderNum));
  if (!order) return sender.sendText(from, `❌ Pesanan #${orderNum} tidak ditemukan.`);

  if (order.order_status === 'completed') {
    return sender.sendText(from, `⚠️ Pesanan #${orderNum} sudah selesai.`);
  }

  await db.updateOrder(order.id, { order_status: 'completed' });
  await sender.sendText(from, `✔️ Pesanan #${orderNum} ditandai SELESAI.`);

  // Notify customer
  await sender.sendText(order.wa_number, `✔️ *Pesanan #${order.order_number} telah selesai!*\n\nTerima kasih sudah memesan di Yoyo Bakery ya Kak. Semoga suka dengan rotinya! 🙏😊\n\nJangan lupa follow IG kami di @yoyobolen untuk info promo terbaru. ✨`);
}

/**
 * /pause - Pause the bot
 */
async function cmdPause(from) {
  await db.setGlobalSetting('is_paused', true);
  await sender.sendText(from, '🛑 *Bot DIMATIKAN SEMENTARA*\n\nSekarang Admin bisa chat manual tanpa diganggu bot. Ketik */resume* untuk menghidupkan kembali.');
}

/**
 * /resume - Resume the bot
 */
async function cmdResume(from) {
  await db.setGlobalSetting('is_paused', false);
  await sender.sendText(from, '🚀 *Bot DIHIDUPKAN KEMBALI*\n\nBot sekarang akan merespon pesan pelanggan secara otomatis.');
}

async function cmdUpdateStock(from, productName, isAvailable) {
  if (!productName) return sender.sendText(from, `⚠️ Format: */${isAvailable ? 'ada' : 'habis'} [nama roti]*\nContoh: /habis bolen`);

  const product = await db.findProductByName(productName);
  if (!product) return sender.sendText(from, `❌ Roti "${productName}" tidak ditemukan di database.`);

  const updated = await db.updateProductAvailability(product.id, isAvailable);
  if (!updated) return sender.sendText(from, '❌ Gagal update stok. Coba lagi.');

  return sender.sendText(from, `✅ Berhasil! Roti *${product.name}* sekarang statusnya: *${isAvailable ? 'Tersedia' : 'HABIS'}* di katalog pelanggan.`);
}

async function cmdUpdateStockType(from, productName, stockType) {
  if (!productName) return sender.sendText(from, `⚠️ Format: */${stockType} [nama roti]*\nContoh: /po bolen`);

  const product = await db.findProductByName(productName);
  if (!product) return sender.sendText(from, `❌ Roti "${productName}" tidak ditemukan.`);

  const updated = await db.updateProductStockType(product.id, stockType);
  if (!updated) return sender.sendText(from, '❌ Gagal update tipe stok.');

  return sender.sendText(from, `✅ Berhasil! Roti *${product.name}* sekarang statusnya: *${stockType.toUpperCase()}*.`);
}

/**
 * /help - Show available commands
 */
async function cmdHelp(from) {
  const msg = `📖 *Admin Commands:*\n\n` +
    `*/status* — Ringkasan & Daftar Produksi\n` +
    `*/export* — Unduh Laporan Excel\n` +
    `*/struk [no]* — Rincian lengkap pesanan\n` +
    `*/cek [no]* — Detail status\n` +
    `*/bayar [no]* — Konfirmasi pembayaran\n` +
    `*/kirim [no]* — Panggil kurir Lalamove\n` +
    `*/selesai [no]* — Tandai pesanan selesai\n` +
    `*/pause* — Matikan bot sementara\n` +
    `*/resume* — Hidupkan bot kembali\n` +
    `*/po [roti]* — Set status Pre-Order\n` +
    `*/ready [roti]* — Set status Ready Stock\n` +
    `*/habis [roti]* — Set stok habis\n` +
    `*/ada [roti]* — Set stok tersedia\n` +
    `*/batal [no]* — Batalkan pesanan\n` +
    `*/help* — Bantuan ini`;

  await sender.sendText(from, msg);
}

/**
 * Check if a message is an admin command
 */
function isAdminCommand(text) {
  return /^\/(status|export|struk|kirim|cek|bayar|batal|help|bantuan|po|ready|habis|ada|pause|resume|selesai)/i.test(text.trim());
}

module.exports = { handleAdminCommand, isAdminCommand };
