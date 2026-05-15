const logger = require('./logger');
const db = require('../database/supabase');
const sender = require('../whatsapp/sender');
const config = require('../config');

/**
 * Payment Reminder & Auto-Cancel Scheduler
 * 
 * - Setiap jam cek pesanan yang belum dibayar
 * - Jam 8 pagi: kirim reminder ke customer
 * - Pesanan >2 hari tidak dibayar: auto-cancel
 */

const REMINDER_HOUR = 8;        // Jam 8 pagi WIB
const AUTO_CANCEL_DAYS = 2;     // Auto-cancel setelah 2 hari
const CHECK_INTERVAL = 60 * 60 * 1000; // Cek setiap 1 jam

let reminderInterval = null;

/**
 * Kirim reminder pembayaran ke customer yang pesan kemarin tapi belum bayar
 */
async function sendPaymentReminders() {
  try {
    // Ambil pesanan yang belum dibayar lebih dari 12 jam
    const unpaidOrders = await db.getUnpaidOrdersSince(12);
    
    if (unpaidOrders.length === 0) {
      logger.debug('✅ Tidak ada pesanan yang perlu diingatkan.');
      return;
    }

    logger.info({ count: unpaidOrders.length }, '🔔 Mengirim reminder pembayaran...');

    for (const order of unpaidOrders) {
      const totalStr = (order.total_price || 0).toLocaleString('id-ID');
      
      const msg = `🔔 *Pengingat Pembayaran*\n\n` +
        `Halo Kak *${order.customer_name}*! 👋\n\n` +
        `Pesanan *#${order.order_number}* kemarin belum dibayar nih.\n\n` +
        `💰 *Total: Rp ${totalStr}*\n\n` +
        `💳 *Transfer ke:*\n` +
        `🏦 BCA\n` +
        `👤 ${config.payment.bcaName}\n` +
        `💳 ${config.payment.bcaNumber}\n\n` +
        `Setelah transfer, kirim foto buktinya ke sini ya Kak. 🙏\n\n` +
        `_Pesanan otomatis batal jika tidak dibayar dalam 2 hari._`;

      await sender.sendText(order.wa_number, msg);
      
      // Delay 2 detik antar pesan agar tidak di-block WhatsApp
      await new Promise(r => setTimeout(r, 2000));
    }

    logger.info({ count: unpaidOrders.length }, '✅ Reminder pembayaran selesai dikirim.');
  } catch (err) {
    logger.error({ err }, '❌ Error mengirim reminder pembayaran');
  }
}

/**
 * Auto-cancel pesanan yang sudah lewat batas waktu
 */
async function autoCancelExpiredOrders() {
  try {
    const expiredOrders = await db.getExpiredUnpaidOrders(AUTO_CANCEL_DAYS);
    
    if (expiredOrders.length === 0) return;

    logger.info({ count: expiredOrders.length }, '🗑️ Auto-cancel pesanan expired...');

    for (const order of expiredOrders) {
      await db.updateOrder(order.id, { 
        order_status: 'cancelled',
        payment_status: 'pending'
      });

      await sender.sendText(order.wa_number, 
        `❌ *Pesanan #${order.order_number} Dibatalkan Otomatis*\n\n` +
        `Maaf Kak, pesanan Kakak telah melewati batas waktu pembayaran (2 hari).\n\n` +
        `Jika masih ingin pesan, silakan chat *Halo* untuk memulai pesanan baru ya Kak! 😊🍞`
      );

      // Notify admin
      await sender.sendText(config.adminPhone,
        `🗑️ *AUTO-CANCEL* Pesanan #${order.order_number}\n` +
        `👤 ${order.customer_name} (${order.wa_number.split('@')[0]})\n` +
        `💰 Rp ${(order.total_price || 0).toLocaleString('id-ID')}\n` +
        `⏰ Dibuat: ${new Date(order.created_at).toLocaleString('id-ID')}`
      );

      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (err) {
    logger.error({ err }, '❌ Error auto-cancel expired orders');
  }
}

/**
 * Cleanup customer sessions that have been inactive for > 24 hours
 */
async function cleanupInactiveSessions() {
  try {
    const oldSessions = await db.getOldSessions(24);
    if (oldSessions.length === 0) return;

    logger.info({ count: oldSessions.length }, '🧹 Cleaning up old sessions...');
    
    for (const waNumber of oldSessions) {
      // Jangan hapus setting sistem
      if (waNumber.startsWith('system:')) continue;
      
      await db.deleteSession(waNumber);
    }
  } catch (err) {
    logger.error({ err }, '❌ Error cleaning up old sessions');
  }
}

/**
 * Main scheduler tick — runs every hour
 */
async function schedulerTick() {
  const now = new Date();
  const hour = now.getHours(); // WIB (server harus set timezone WIB)

  logger.debug({ hour }, '⏰ Scheduler tick');

  // Jam 8 pagi: kirim reminder pembayaran
  if (hour === REMINDER_HOUR) {
    await sendPaymentReminders();
  }

  // Setiap jam: cek dan auto-cancel pesanan expired & bersihkan session basi
  await autoCancelExpiredOrders();
  await cleanupInactiveSessions();
}

/**
 * Start the scheduler
 */
function startScheduler() {
  logger.info(`⏰ Scheduler dimulai (reminder jam ${REMINDER_HOUR}:00, auto-cancel ${AUTO_CANCEL_DAYS} hari)`);
  
  // Jalankan pertama kali setelah 30 detik (beri waktu koneksi WA stabil)
  setTimeout(() => {
    schedulerTick();
    reminderInterval = setInterval(schedulerTick, CHECK_INTERVAL);
  }, 30000);
}

function stopScheduler() {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
    logger.info('⏰ Scheduler dihentikan.');
  }
}

module.exports = { startScheduler, stopScheduler };
