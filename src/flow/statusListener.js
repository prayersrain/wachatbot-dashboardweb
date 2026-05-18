const logger = require('../utils/logger');
const db = require('../database/supabase');
const sender = require('../whatsapp/sender');
const lalamove = require('../lalamove/client');
const config = require('../config');

/**
 * Mendengarkan perubahan status di Supabase secara Realtime
 * dan memicu aksi Bot WhatsApp secara otomatis.
 */
function startStatusListener() {
  logger.info('📡 Supabase Status Listener aktif...');

  db.supabase
    .channel('status_updates')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders' },
      async (payload) => {
        const oldOrder = payload.old;
        const newOrder = payload.new;

        // Hanya proses jika status berubah
        if (oldOrder.order_status === newOrder.order_status) return;

        logger.info({ 
          orderId: newOrder.id, 
          old: oldOrder.order_status, 
          new: newOrder.order_status 
        }, '🔄 Status order berubah di Dashboard');

        try {
          const orderNum = newOrder.order_number;
          const waNumber = newOrder.wa_number;

          // CASE 1: Status berubah jadi 'confirmed' (Konfirmasi Pembayaran)
          if (newOrder.order_status === 'confirmed' && newOrder.payment_status !== 'paid') {
            logger.info(`✅ Menjalankan otomatisasi BAYAR untuk #${orderNum}`);
            
            // Update payment status ke paid
            await db.updateOrder(newOrder.id, { payment_status: 'paid' });
            
            // Hapus sesi agar pelanggan bisa pesan lagi
            await db.deleteSession(waNumber);

            // Kirim pesan ke pelanggan
            await sender.sendText(waNumber, `✅ *Pembayaran pesanan #${orderNum} telah dikonfirmasi!*\n\nPesanan Kakak sedang kami siapkan ya. Kami akan kirim notifikasi lagi saat kurir berangkat. 🙏`);
            
            // Beri tahu Admin di WA
            await sender.sendText(config.adminPhone, `📢 *INFO DASHBOARD*\n\nPesanan #${orderNum} telah dikonfirmasi pembayarannya via Website. ✅`);
          }

          // CASE 2: Status berubah jadi 'shipping' (Panggil Kurir)
          if (newOrder.order_status === 'shipping' && !newOrder.lalamove_order_id) {
            logger.info(`🚚 Menjalankan otomatisasi KIRIM (Lalamove) untuk #${orderNum}`);

            if (!newOrder.lalamove_quotation_id) {
               await sender.sendText(config.adminPhone, `⚠️ Gagal panggil Lalamove otomatis untuk #${orderNum} karena lokasi belum diset.`);
               return;
            }

            // Panggil Lalamove (Logika dari adminFlow.js)
            if (!newOrder.customer_lat || !newOrder.customer_lng) {
              logger.warn({ orderId: newOrder.id }, '⚠️ Koordinat customer kosong di database, skip Lalamove');
              await sender.sendText(config.adminPhone, `⚠️ Gagal panggil Lalamove untuk #${orderNum} karena koordinat lokasi customer kosong di database.`);
              return;
            }
            const q = await lalamove.getQuotation(newOrder.customer_lat, newOrder.customer_lng, newOrder.customer_address);
            if (!q) return;

            const result = await lalamove.createOrder(
              q.quotationId, 
              q.stops, 
              newOrder.customer_name || 'Pelanggan', 
              waNumber, 
              `Yoyo Bakery #${orderNum}`
            );

            if (result) {
              await db.updateOrder(newOrder.id, {
                lalamove_order_id: result.orderId,
                lalamove_share_link: result.shareLink,
                lalamove_status: result.status,
                order_status: 'shipping'
              });

              // Kirim link tracking ke pelanggan
              await sender.sendText(waNumber, `🚚 *Pesanan #${orderNum} sedang dikirim!*\n\n${result.shareLink ? `🔗 Track kurir: ${result.shareLink}` : 'Kurir sedang dalam perjalanan.'}\n\nDitunggu rotinya ya Kak! 😊`);
              
              // Notif Admin
              await sender.sendText(config.adminPhone, `📢 *INFO DASHBOARD*\n\nKurir Lalamove untuk #${orderNum} sudah dipanggil otomatis via Website. 🚚\n\n🔗 Tracking: ${result.shareLink || '-'}`);
            }
          }

          // CASE 3: Status berubah jadi 'cancelled'
          if (newOrder.order_status === 'cancelled' && oldOrder.order_status !== 'cancelled') {
             await sender.sendText(waNumber, `❌ Maaf Kak, pesanan #${orderNum} dibatalkan oleh Admin. Silakan hubungi kami jika ada pertanyaan.`);
          }

          // CASE 4: Status berubah jadi 'completed'
          if (newOrder.order_status === 'completed' && oldOrder.order_status !== 'completed') {
             await sender.sendText(waNumber, `✔️ Pesanan #${orderNum} telah dinyatakan SELESAI.\n\nTerima kasih banyak sudah order di Yoyo Bakery Kak! Jangan lupa pesan lagi ya. ❤️🍞`);
          }

        } catch (err) {
          logger.error({ err: err.message }, '❌ Error di Status Listener');
        }
      }
    )
    .subscribe();
}

module.exports = { startStatusListener };
