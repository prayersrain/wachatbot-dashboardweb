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
  startPolling(); // Tambahkan mekanisme fallback

  db.supabase
    .channel('status_updates')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders' },
      async (payload) => {
        const oldOrder = payload.old || {};
        const newOrder = payload.new;

        if (!newOrder || !newOrder.id) return;

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
    .subscribe((status, err) => {
      logger.info({ status, err }, '📡 Status Listener Subscribe Result');
    });

  // Listener untuk Broadcast dari Vercel (Dashboard)
  db.supabase
    .channel('whatsapp_bot')
    .on('broadcast', { event: 'send_message' }, async (payload) => {
      try {
        const { wa_number, message } = payload.payload;
        if (!wa_number || !message) return;
        
        logger.info(`💬 Mengirim pesan via Dashboard ke ${wa_number}`);
        await sender.sendText(wa_number, message);

        // Update history di database agar sinkron
        const session = await db.getSession(wa_number);
        if (session) {
          let curHistory = session.data?.history || [];
          curHistory.push({ role: 'bot', content: message });
          if (curHistory.length > 100) curHistory = curHistory.slice(-100);
          await db.upsertSession(wa_number, session.state, { 
            ...session.data, 
            history: curHistory 
          });
        }
      } catch (err) {
        logger.error({ err: err.message }, '❌ Gagal mengirim pesan dari Dashboard');
      }
    })
    .subscribe();
}

module.exports = { startStatusListener };

// ==========================================
// POLLING FALLBACK (Mencegah Realtime Gagal)
// ==========================================
function startPolling() {
  setInterval(async () => {
    try {
      // 1. Cek pesanan yang baru dikonfirmasi
      const { data: confirmedOrders } = await db.supabase
        .from('orders')
        .select('*')
        .eq('order_status', 'confirmed')
        .eq('payment_status', 'reviewing');
        
      if (confirmedOrders && confirmedOrders.length > 0) {
        for (const newOrder of confirmedOrders) {
          logger.info(`✅ [POLLING] Menjalankan otomatisasi BAYAR untuk #${newOrder.order_number}`);
          await db.updateOrder(newOrder.id, { payment_status: 'paid' });
          await db.deleteSession(newOrder.wa_number);
          await sender.sendText(newOrder.wa_number, `✅ *Pembayaran pesanan #${newOrder.order_number} telah dikonfirmasi!*\n\nPesanan Kakak sedang kami siapkan ya. Kami akan kirim notifikasi lagi saat kurir berangkat. 🙏`);
          await sender.sendText(config.adminPhone, `📢 *INFO DASHBOARD*\n\nPesanan #${newOrder.order_number} telah dikonfirmasi pembayarannya via Website. ✅`);
        }
      }

      // 2. Cek pesanan yang baru dikirim tapi belum ada Lalamove
      const { data: shippingOrders } = await db.supabase
        .from('orders')
        .select('*')
        .eq('order_status', 'shipping')
        .is('lalamove_order_id', null);
        
      if (shippingOrders && shippingOrders.length > 0) {
        for (const newOrder of shippingOrders) {
          logger.info(`🚚 [POLLING] Menjalankan otomatisasi KIRIM (Lalamove) untuk #${newOrder.order_number}`);
          
          if (!newOrder.lalamove_quotation_id) {
             await sender.sendText(config.adminPhone, `⚠️ Gagal panggil Lalamove otomatis untuk #${newOrder.order_number} karena quotation Lalamove tidak ditemukan di database. Silakan panggil kurir manual.`);
             await db.updateOrder(newOrder.id, { lalamove_order_id: 'MANUAL_REQUIRED', lalamove_status: 'FAILED' });
             continue;
          }
          if (!newOrder.customer_lat || !newOrder.customer_lng) {
            await sender.sendText(config.adminPhone, `⚠️ Gagal panggil Lalamove untuk #${newOrder.order_number} karena koordinat lokasi customer kosong. Silakan panggil kurir manual.`);
            await db.updateOrder(newOrder.id, { lalamove_order_id: 'MANUAL_REQUIRED', lalamove_status: 'FAILED' });
            continue;
          }

          // Fetch detail pesanan Lalamove yang sudah ada di database atau buat baru?
          // Karena quotation sudah ada, gunakan quotationId dari database:
          const quotationId = newOrder.lalamove_quotation_id;
          
          // Note: Kita butuh 'stops' untuk Lalamove. Jika tidak disimpan di DB, kita harus fetch ulang quotation.
          // Untuk amannya, fetch ulang quotation agar mendapat 'stops' valid:
          const q = await lalamove.getQuotation(newOrder.customer_lat, newOrder.customer_lng, newOrder.customer_address);
          if (!q) {
             logger.error({ orderId: newOrder.id }, '❌ Gagal ambil quotation ulang saat polling Lalamove');
             await db.updateOrder(newOrder.id, { lalamove_order_id: 'MANUAL_REQUIRED', lalamove_status: 'FAILED' });
             continue;
          }

          // Ekstrak nomor HP asli dari catatan jika ada, jika tidak fallback ke wa_number
          let realPhone = newOrder.wa_number;
          if (newOrder.notes) {
            const hpMatch = newOrder.notes.match(/\(HP:\s*([\d\+\-\s]+)\)/);
            if (hpMatch && hpMatch[1]) {
              realPhone = hpMatch[1].trim();
            }
          }

          const result = await lalamove.createOrder(
            q.quotationId, 
            q.stops, 
            newOrder.customer_name || 'Pelanggan', 
            realPhone, 
            `Yoyo Bakery #${newOrder.order_number}`
          );

          if (result && result.orderId) {
            // Suntikkan Priority Fee dari sisa markup ongkir
            const baseLalaFee = parseFloat(q.total) || 0;
            const customerPaidFee = parseFloat(newOrder.delivery_fee) || 0;
            // Bulatkan ke bawah ke kelipatan 1000 terdekat (Lalamove API sering crash jika angka tidak bulat)
            const rawDifference = customerPaidFee - baseLalaFee;
            const priorityFeeAmount = Math.floor(rawDifference / 1000) * 1000;
            
            let feeMsg = '';
            if (priorityFeeAmount > 0) {
              const feeSuccess = await lalamove.addPriorityFee(result.orderId, priorityFeeAmount);
              if (feeSuccess) feeMsg = ` (Tip Rp${priorityFeeAmount} ditambahkan dari sisa markup)`;
            }

            await db.updateOrder(newOrder.id, {
              lalamove_order_id: result.orderId,
              lalamove_share_link: result.shareLink,
              lalamove_status: result.status,
            });
            await sender.sendText(newOrder.wa_number, `🚚 *Pesanan #${newOrder.order_number} sedang dalam perjalanan!*\n\nLacak kurir Lalamove di sini:\n${result.shareLink}\n\nSilakan tunggu di lokasi ya Kak. Terima kasih! ❤️`);
            await sender.sendText(config.adminPhone, `📢 *LALAMOVE BERHASIL*\n\nPesanan #${newOrder.order_number} telah diserahkan ke driver${feeMsg}. Link tracking:\n${result.shareLink}`);
          } else {
            await sender.sendText(config.adminPhone, `❌ *LALAMOVE GAGAL*\n\nGagal memanggil driver untuk pesanan #${newOrder.order_number}. Silakan panggil manual di aplikasi Lalamove.`);
            await db.updateOrder(newOrder.id, { lalamove_order_id: 'MANUAL_REQUIRED', lalamove_status: 'FAILED' });
          }
        }
      }
      
      // 3. Cek pesanan selesai
      const { data: completedOrders } = await db.supabase
        .from('orders')
        .select('*')
        .eq('order_status', 'completed')
        .neq('payment_status', 'paid'); // Hack if not fully updated
        
      if (completedOrders && completedOrders.length > 0) {
        for (const newOrder of completedOrders) {
           await db.updateOrder(newOrder.id, { payment_status: 'paid' });
        }
      }

    } catch (err) {
      logger.error({ err: err.message }, '❌ Polling error');
    }
  }, 10000); // 10 detik
}
