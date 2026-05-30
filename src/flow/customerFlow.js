const logger = require('../utils/logger');
const sender = require('../whatsapp/sender');
const db = require('../database/supabase');
const { aiParseOrder } = require('./aiParser');
const { getSession, upsertSession, deleteSession } = require('../database/supabase');
const config = require('../config');
const lalamove = require('../lalamove/client');
const path = require('path');
const fs = require('fs');
const { buildOrderSummary } = require('./orderParser');
const { geocodeAddress } = require('../utils/geocoder');

// Order States
const ST = {
  IDLE: 'IDLE',
  ONBOARDING: 'ONBOARDING',
  REGION_SELECT: 'REGION_SELECT',
  REJECTED: 'REJECTED',          // Sudah ditolak (luar jangkauan)
  ORDER: 'ORDER',                // Gabungan CATALOG dan pesanan
  LOCATION: 'LOCATION',
  CONFIRM: 'CONFIRM',
  PAYMENT: 'PAYMENT',
  ADMIN_TAKEOVER: 'ADMIN_TAKEOVER' // Bot diam saat diambil alih manusia
};

function fuzzyMatchProduct(inputName, products) {
  let p = products.find(prod => prod.name.toLowerCase() === inputName.toLowerCase());
  if (p) return { match: p, ambiguous: null };

  let matches = products.filter(prod => prod.name.toLowerCase().includes(inputName.toLowerCase()));
  if (matches.length === 1) return { match: matches[0], ambiguous: null };
  if (matches.length > 1) return { match: null, ambiguous: matches.map(m => m.name) };

  const inputWords = inputName.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (inputWords.length > 0) {
    matches = products.filter(prod => {
      const prodName = prod.name.toLowerCase();
      return inputWords.some(w => prodName.includes(w));
    });
    
    if (matches.length === 1) return { match: matches[0], ambiguous: null };
    if (matches.length > 1) {
      matches.sort((a, b) => {
        const aCount = inputWords.filter(w => a.name.toLowerCase().includes(w)).length;
        const bCount = inputWords.filter(w => b.name.toLowerCase().includes(w)).length;
        return bCount - aCount;
      });
      return { match: null, ambiguous: matches.slice(0, 4).map(m => m.name) };
    }
  }

  return { match: null, ambiguous: null };
}

function calculateDeliveryFee(q) {
  const distKm = q.distance.value / 1000;
  
  let customFee = 8000;
  if (distKm > 3) {
    if (distKm <= 25) {
      customFee += (distKm - 3) * 2000;
    } else {
      customFee += 22 * 2000; 
      customFee += (distKm - 25) * 2400; 
    }
  }
  customFee = Math.ceil(customFee / 1000) * 1000;
  return Math.max(parseFloat(q.total), customFee);
}

// Menu images
const MENU_PAGE1 = path.join(__dirname, '..', 'assets', 'menu-page1.jpg');
const MENU_PAGE2 = path.join(__dirname, '..', 'assets', 'menu-page2.jpg');

/**
 * Handle messages from customers
 */
async function handleCustomerMessage(from, name, message) {
  const session = await getSession(from);
  let state = session ? session.state : ST.IDLE;
  const text = message.text?.body || '';

  // 1. UPDATE HISTORY (Selalu catat pesan pengguna apapun state-nya)
  let data = session && session.data ? session.data : {};
  let history = data.history || [];
  
  let contentToLog = text.trim();
  if (message.type === 'image' || message.message?.imageMessage) {
    contentToLog = text.trim() ? `[Mengirim Gambar] ${text.trim()}` : '[Mengirim Gambar]';
  } else if (message.type === 'location') {
    contentToLog = '[Mengirim Lokasi/Shareloc]';
  }

  if (contentToLog) {
    history.push({ role: 'user', content: contentToLog });
    if (history.length > 100) history = history.slice(-100);
    data.history = history;
    await upsertSession(from, state, data);
    if (session) session.data = data;
  }

  // Jika sedang diambil alih admin, bot bungkam (kecuali diketik batal/halo/mulai untuk reset atau timeout 1 Jam)
  if (state === ST.ADMIN_TAKEOVER) {
    const t = text.toLowerCase().trim();
    const lastUpdate = session.updated_at ? new Date(session.updated_at).getTime() : Date.now();
    const isTimeout = (Date.now() - lastUpdate) > 60 * 60 * 1000; // 1 Jam

    if (isTimeout || ['batal', 'halo', 'mulai', 'reset'].includes(t)) {
      await upsertSession(from, ST.IDLE, {
        customerPhone: session?.data?.customerPhone || '',
        customerName: session?.data?.customerName || ''
      });
      return sender.sendText(from, 'Halo Kak! Sesi obrolan sebelumnya sudah ditutup. Ada yang bisa kami bantu hari ini? 😊');
    }
    return; // Abaikan semua chat
  }

  // 2. SMART PARSE
  let aiData = null;
  const t = text.toLowerCase().trim();
  
  if (message.type === 'location' && state !== ST.LOCATION) {
    // Estimasi ongkir tanpa mengubah state
    return await estimateShipping(from, message, state);
  }

  if (state === ST.REGION_SELECT && ['1', 'jakarta', '1. jakarta', 'dki jakarta', '2', 'luar jakarta', '2. luar jakarta', 'luar kota'].includes(t)) {
    // Bypass AI untuk input wilayah yang valid
    aiData = { intent: 'REGION_MATCH' };
  } else if (text.trim().length > 0) {
    let activeOrderContext = '';
    if (state === ST.IDLE || state === ST.ADMIN_TAKEOVER) {
      const activeOrders = await db.getActiveOrdersByPhone(from, session?.data?.customerPhone);
      if (activeOrders && activeOrders.length > 0) {
        activeOrderContext = `\n\nINFO PENTING UNTUK AI: Pelanggan ini sedang memiliki PESANAN AKTIF. Berikut detail pesanannya:\n`;
        activeOrders.forEach(ord => {
          activeOrderContext += `- Pesanan #${ord.order_number}: ${ord.order_status} (Pembayaran: ${ord.payment_status}).\n`;
        });
      }
    }
    const aiHistory = history.slice(-10);
    aiData = await aiParseOrder(text, state, session?.data?.ambiguousPending, activeOrderContext, aiHistory);
  }

  // ═══ GLOBAL PICKUP DETECTION ═══
  const tLowerGlobal = text ? text.toLowerCase() : '';
  const isPickupGlobal = ['ambil sendiri', 'pickup', 'ambil ke toko', 'ke sana', 'kesana', 'ambil langsung'].some(k => tLowerGlobal.includes(k) || (aiData?.answer && aiData.answer.toLowerCase().includes(k)));
  if (isPickupGlobal && session && session.data) {
    session.data.isPickup = true;
    session.data.deliveryFee = 0;
    if (!session.data.notes?.includes('(Pickup)')) {
      session.data.notes = session.data.notes ? session.data.notes + ' (Pickup)' : '(Pickup)';
    }
  }

  // ═══ SMART INTERRUPT (state-independent) ═══
  // Jawab pertanyaan kapan saja tanpa merusak state saat ini
  if (aiData && ['FAQ', 'QUESTION', 'THANKS', 'SHOW_MENU', 'OTHER', 'GREETING', 'ACKNOWLEDGE', 'ADMIN'].includes(aiData.intent)) {
    const isLidWaitingPhone = state === ST.CONFIRM && from.endsWith('@lid') && (!session?.data?.customerPhone || session.data.customerPhone === '');
    const hasPhoneNumber = /(\+?62|0)\d{8,13}/.test(text.replace(/[\s-]/g, ''));

    const activeOrdersCheck = await db.getActiveOrdersByPhone(from, session?.data?.customerPhone);
    const hasActiveOrder = activeOrdersCheck && activeOrdersCheck.length > 0;

    // Pengecualian: Jika di awal (IDLE) dan sapaan, biarkan flow normal berjalan HANYA jika tidak ada pesanan aktif
    if (state === ST.IDLE && aiData.intent === 'GREETING' && !hasActiveOrder) {
      // Biarkan lanjut ke FLOW LOGIC di bawah untuk onboarding pelanggan baru
    } else if (isLidWaitingPhone && hasPhoneNumber) {
      // Pengecualian 2: Jika user LID sedang ditanya nomor HP, biarkan lolos ke fallback bawah
    } else if (state === ST.LOCATION && text && text.length > 10 && !['batal', 'kembali'].includes(text.toLowerCase().trim()) && !['FAQ', 'QUESTION'].includes(aiData.intent)) {
      // Pengecualian 3: Jika user mengirimkan teks panjang yang BUKAN FAQ saat ditanya lokasi, biarkan lolos ke fallback bawah (dianggap alamat)
    } else if (aiData.intent === 'ACKNOWLEDGE' || (state === ST.IDLE && ['OTHER', 'THANKS'].includes(aiData.intent))) {
      // Abaikan pesan basa-basi/terima kasih supaya bot tidak cerewet (chatterbot) setelah pesanan selesai
      return;
    } else if (aiData.intent === 'ADMIN') {
      await upsertSession(from, ST.ADMIN_TAKEOVER, data);
      const msg = aiData.answer || "Mohon maaf atas ketidaknyamanannya Kak. 🙏 Pesan Kakak sudah kami teruskan ke tim Admin. Harap tunggu sebentar ya, admin manusia kami akan segera membalas chat ini.";
      return sender.sendText(from, msg);
    } else {
      if (aiData.intent === 'SHOW_MENU') {
        await sendMenuImages(from, 'Silakan pilih menu favorit Kakak! 👇');
      } else if (aiData.answer) {
        let reminder = '';

        if (aiData.customerPhone) {
          data.customerPhone = aiData.customerPhone;
          if (data.customerPhone.startsWith('0')) data.customerPhone = '62' + data.customerPhone.slice(1);
          data.customerPhone = data.customerPhone.replace(/\D/g, '');
        }
        if (aiData.customerName) {
          data.customerName = aiData.customerName;
        }
        const tLower = text ? text.toLowerCase() : '';
        const isPickup = ['ambil sendiri', 'pickup', 'ambil ke toko', 'ke sana', 'kesana', 'ambil langsung'].some(k => tLower.includes(k) || (aiData.answer && aiData.answer.toLowerCase().includes(k)));
        let nextState = state;
        if (isPickup) {
          data.isPickup = true;
          data.deliveryFee = 0;
          if (state === ST.REGION_SELECT) {
             nextState = ST.ORDER;
             reminder = '\n\n📝 _Silakan ketik nama kue & jumlahnya._';
          } else if (state === ST.LOCATION) {
             if (!data.notes?.includes('(Pickup)')) data.notes = data.notes ? data.notes + ' (Pickup)' : '(Pickup)';
             const { text: summary } = buildOrderSummary(data.items || [], 0, data.notes);
             nextState = ST.CONFIRM;
             reminder = `\n\nSip Kak! Pesanan sudah dicatat:\n\n${summary}\n\n✅ Balas *Konfirmasi* jika pesanan sudah benar ya Kak, atau *Kembali* jika ingin mengubah.`;
          }
          // If in ST.CONFIRM, we should rebuild the summary to reflect 0 delivery fee
          else if (state === ST.CONFIRM) {
             if (!data.notes?.includes('(Pickup)')) data.notes = data.notes ? data.notes + ' (Pickup)' : '(Pickup)';
             const { text: summary } = buildOrderSummary(data.items || [], 0, data.notes);
             reminder = `\n\nSiap Kak, tanpa ongkir ya! Totalnya jadi:\n\n${summary}\n\n✅ Balas *Konfirmasi* jika pesanan sudah benar, atau *Kembali* jika ingin mengubah.`;
          }
        }

        // Deteksi jika AI memberikan jawaban penolakan (Shopee) karena area di luar jangkauan
        const isShopeeRejection = aiData.answer && aiData.answer.toLowerCase().includes('shopee');
        if (isShopeeRejection && state === ST.LOCATION) {
           data.history = [];
           await upsertSession(from, ST.REJECTED, data);
           return sender.sendText(from, aiData.answer); // Langsung kirim jawaban tanpa reminder tambahan
        }

        if (!isPickup || state === ST.PAYMENT) {
          if (state === ST.REGION_SELECT) reminder = '\n\n🌍 _Boleh tau Kakak berada di kota/daerah mana? Sebut saja nama wilayahnya ya Kak. 😊_';
          else if (state === ST.LOCATION) reminder = '\n\n📍 _Silakan ketik alamat lengkap pengiriman Kakak, ATAU kirim Lokasi/Shareloc WhatsApp untuk hitung ongkir._';
          else if (state === ST.ORDER && session?.data?.items?.length > 0) reminder = '\n\n📝 _Silakan ketik nama kue & jumlahnya._';
          else if (state === ST.ORDER) reminder = '\n\n📝 _Silakan ketik pesanan atau perjelas nama kuenya._';
          else if (state === ST.CONFIRM && !isPickup) reminder = '\n\n✅ _Mohon balas dengan *Konfirmasi* untuk lanjut, atau *Kembali* untuk mengubah pesanan._';
          else if (state === ST.PAYMENT) reminder = '\n\n⌛ _Menunggu kiriman foto bukti transfer Kakak._';
        }

        // Cegah reminder cerewet jika hanya basa-basi atau info tambahan (kecuali pelanggan tanya FAQ murni)
        if (['OTHER', 'THANKS', 'ACKNOWLEDGE', 'GREETING'].includes(aiData.intent) && !isPickup) {
          reminder = '';
        }

        const fullAnswer = aiData.answer + reminder;
        history.push({ role: 'bot', content: fullAnswer });
        if (history.length > 100) history = history.slice(-100);
        data.history = history;
        await upsertSession(from, nextState, data);

        await sender.sendText(from, fullAnswer);
      }
      return; // Selesai, jangan ubah state
    }
  }

  // ═══ FLOW LOGIC (state-dependent) ═══
  if (aiData) {
    // --- CANCEL ---
    if (aiData.intent === 'CANCEL') {
      await upsertSession(from, ST.IDLE, {
        customerPhone: session?.data?.customerPhone || '',
        customerName: session?.data?.customerName || ''
      });
      let cancelMsg = aiData.answer || '✅ Pesanan telah dibatalkan. Jika Kakak berubah pikiran, cukup ketik *Halo* untuk memulai pesanan baru ya Kak. 😊';
      return sender.sendText(from, cancelMsg);
    }

    // --- REJECTED: Customer luar Jakarta ---
    if (state === ST.REJECTED) {
      const t = text.toLowerCase().trim();
      const jakartaKeywords = ['jakarta', 'dki jakarta', 'jakarta pusat', 'jakarta selatan', 'jakarta barat', 'jakarta timur', 'jakarta utara', 'jakpus', 'jaksel', 'jakbar', 'jaktim', 'jakut', 'cempaka putih', 'johar baru'];
      const isJakartaCorrection = jakartaKeywords.some(k => t.includes(k)) || (aiData && aiData.intent === 'REGION_MATCH' && aiData.region === 'jakarta');

      if (isJakartaCorrection) {
        await upsertSession(from, ST.REGION_SELECT, data);
        return await handleCustomerMessage(from, name, message);
      }

      const shopeeUrl = config.shopeeUrl || 'https://shopee.co.id/yoyobakery';
      const rejectionMsg = `Maaf Kak, pemesanan via WhatsApp hanya untuk area *Jakarta* ya. 🙏\n\nUntuk luar Jakarta, Kakak bisa pesan di Shopee kami:\n🛒 *${shopeeUrl}*\n\nTerima kasih! 😊🍞`;
      
      const blockedIntents = ['ORDER', 'CONFIRM', 'LOCATION'];
      if (blockedIntents.includes(aiData.intent)) {
        return sender.sendText(from, rejectionMsg);
      }
      return sender.sendText(from, `Ada yang bisa kami bantu lagi Kak? 😊\n\nUntuk pemesanan, silakan kunjungi Shopee kami ya:\n🛒 *${shopeeUrl}*`);
    }

    // --- REGION_SELECT: Pilihan Wilayah ---
    if (state === ST.REGION_SELECT) {
      const t = text.toLowerCase().trim();
      const jakartaKeywords = ['jakarta', 'dki jakarta', 'jakarta pusat', 'jakarta selatan', 'jakarta barat', 'jakarta timur', 'jakarta utara', 'jakpus', 'jaksel', 'jakbar', 'jaktim', 'jakut'];
      // Daftar kota/provinsi luar Jakarta (otomatis arahkan ke Shopee)
      const luarJakartaKeywords = ['luar jakarta', 'luar kota',
        'bandung', 'surabaya', 'semarang', 'yogyakarta', 'jogja', 'medan', 'makassar', 'palembang',
        'malang', 'solo', 'tangerang', 'bekasi', 'depok', 'bogor', 'cirebon', 'serang', 'cilegon',
        'denpasar', 'bali', 'balikpapan', 'samarinda', 'pontianak', 'banjarmasin', 'manado',
        'padang', 'pekanbaru', 'lampung', 'bandar lampung', 'batam', 'jambi', 'bengkulu',
        'aceh', 'banda aceh', 'mataram', 'lombok', 'kupang', 'ambon', 'jayapura', 'sorong',
        'kendari', 'palu', 'gorontalo', 'ternate', 'mamuju', 'pangkal pinang', 'tanjung pinang',
        'purwokerto', 'tegal', 'pekalongan', 'magelang', 'klaten', 'karawang', 'sukabumi',
        'garut', 'tasikmalaya', 'ciamis', 'subang', 'indramayu', 'kuningan', 'majalengka',
        'jawa barat', 'jawa tengah', 'jawa timur', 'banten', 'sumatera', 'kalimantan', 'sulawesi',
        'papua', 'nusa tenggara', 'ntb', 'ntt', 'riau', 'sumbar', 'sumsel', 'sumut', 'sulteng',
        'sulsel', 'sulut', 'sulbar', 'sultra', 'kalbar', 'kalsel', 'kalteng', 'kaltim', 'kaltara',
        'jabar', 'jateng', 'jatim', 'diy'
      ];
      
      const isJakarta = t === '1' || t === '1.' || jakartaKeywords.some(k => t.includes(k)) || (aiData && aiData.intent === 'REGION_MATCH' && aiData.region === 'jakarta');
      const isLuarJakarta = t === '2' || t === '2.' || luarJakartaKeywords.some(k => t.includes(k)) || (aiData && aiData.intent === 'REGION_MATCH' && aiData.region === 'luar_jakarta');
      const isPickup = ['ambil sendiri', 'pickup', 'ambil ke toko', 'ke sana', 'kesana', 'ambil langsung'].some(k => t.includes(k) || (aiData.answer && aiData.answer.toLowerCase().includes(k)));

      if (isJakarta || isPickup) {
        const hasExistingItems = session?.data?.items && session.data.items.length > 0;
        const hasAmbiguous = session?.data?.ambiguousPending && session.data.ambiguousPending.length > 0;

        if (hasExistingItems || hasAmbiguous) {
          if (hasAmbiguous && !isPickup) {
            await upsertSession(from, ST.ORDER, session.data);
            let msg = 'Siap Kak, pesanan area *Jakarta*! 🍞\n\n🤔 Tapi maaf Kak, ada pesanan yang perlu diperjelas:\n\n';
            session.data.ambiguousPending.forEach(item => {
              if (item.type === 'missing_qty') {
                msg += `❓ *"${item.original}"* — Mau dipesan berapa banyak ya Kak?\n`;
              } else if (item.matches && item.matches.length > 0) {
                const qtyPrefix = item.qty ? `(${item.qty} pcs) ` : '';
                msg += `❓ *${qtyPrefix}"${item.original}"* — Kakak maksudnya yang mana?\n`;
                item.matches.forEach(m => msg += `   • ${m}\n`);
              } else {
                msg += `❓ *"${item.original}"* — Produk ini tidak ada di menu kami.\n`;
              }
              msg += '\n';
            });
            msg += 'Silakan balas rinciannya ya Kak. 🙏';
            return sender.sendText(from, msg);
          } else {
            if (isPickup) {
               session.data.deliveryFee = 0;
               session.data.isPickup = true;
               session.data.notes = session.data.notes ? session.data.notes + ' (Pickup)' : '(Pickup)';
               await upsertSession(from, ST.CONFIRM, session.data);
               const { text: summary } = buildOrderSummary(session.data.items, 0, session.data.notes);
               return sender.sendText(from, `Siap Kak! Untuk pesanan ambil sendiri (pickup) sudah saya catat.\n\n✅ *Pesanan Kakak:*\n\n${summary}\n\nKetik *Konfirmasi* jika sudah benar ya Kak!`);
            } else {
               await upsertSession(from, ST.LOCATION, session.data);
               const { text: summary } = buildOrderSummary(session.data.items, undefined, session.data.notes);
               const msg = `Siap Kak, pesanan area *Jakarta*! 🍞\n\n` +
                 `✅ *Pesanan Kakak:*\n\n${summary}\n\n` +
                 `📍 Silakan kirim *Lokasi/Shareloc* Kakak untuk hitung ongkir ya!\n_(Klik 📎 → Lokasi)_`;
               return sender.sendText(from, msg);
            }
          }
        } else {
          if (isPickup) session.data.isPickup = true;
          await upsertSession(from, ST.ORDER, session.data);
          return sendMenuImages(from, isPickup 
             ? 'Boleh sekali Kak! Untuk pengambilan mandiri (pickup), silakan ketik nama kue & jumlahnya ya (Contoh: Nastar Classic 2, Bolen Coklat 1).'
             : 'Siap Kak, pesanan area *Jakarta*! 🍞\n\nSilakan ketik nama kue & jumlahnya (Contoh: Nastar Classic 2, Bolen Coklat 1).');
        }
      } else if (isLuarJakarta) {
        // Pengecualian: Jika pelanggan terang-terangan minta ambil sendiri / pickup, jangan blokir
        const isPickup = ['ambil sendiri', 'pickup', 'ambil ke toko', 'ke sana', 'kesana', 'ambil langsung'].some(k => t.includes(k) || (aiData.answer && aiData.answer.toLowerCase().includes(k)));
        if (isPickup) {
           session.data.isPickup = true;
           await upsertSession(from, ST.ORDER, session.data);
           return sender.sendText(from, (aiData.answer || 'Boleh sekali Kak! Untuk pengambilan mandiri (pickup), silakan informasikan terlebih dahulu produk apa saja yang ingin dipesan agar kami siapkan.') + '\n\n📝 _Silakan ketik nama kue & jumlahnya._');
        }

        await upsertSession(from, ST.REJECTED, session.data);
        const shopeeUrl = config.shopeeUrl || 'https://shopee.co.id/yoyobakery';
        const customRejectText = aiData?.answer || `Maaf Kak, pemesanan via WhatsApp hanya untuk area *Jakarta* ya. 🙏\n\nUntuk luar Jakarta, Kakak bisa pesan melalui Shopee kami:\n🛒 *${shopeeUrl}*\n\nTerima kasih banyak! 😊🍞`;
        return sender.sendText(from, customRejectText);
      } else if (aiData.intent !== 'FAQ') {
        return sender.sendText(from, '🌍 Mohon ketik nama kota atau wilayah Kakak ya (contoh: Jakarta, Bandung, Surabaya).');
      }
    }

    // --- CONFIRM ---
    if (aiData.intent === 'CONFIRM' && (state === ST.ORDER || state === ST.LOCATION || state === ST.CONFIRM)) {
      if (state === ST.ORDER) {
        if (session?.data?.items?.length > 0) {
          const { text: summary } = buildOrderSummary(session.data.items, undefined, session.data.notes);
          await upsertSession(from, ST.LOCATION, session.data);
          return sender.sendText(from, `Sip Kak! Pesanan sudah dicatat:\n\n${summary}\n\n📍 Mohon kirim *Lokasi/Shareloc* pengiriman Kakak ya agar saya bisa hitung ongkirnya.`);
        } else {
          return sender.sendText(from, 'Keranjang Kakak masih kosong. Silakan ketik nama kue yang ingin dipesan ya Kak.');
        }
      }
      if (state === ST.LOCATION) {
        if (text && text.length > 10 && !['batal', 'kembali'].includes(text.toLowerCase().trim())) {
           const geo = await geocodeAddress(text);
           if (geo) {
             const mockLocationMessage = { type: 'location', location: { latitude: geo.lat, longitude: geo.lng, name: geo.formattedAddress } };
             return await handleLocation(from, name, mockLocationMessage);
           }
        }
        return sender.sendLocationRequest(from, 'Sip Kak! Mohon kirim *Lokasi/Shareloc* pengiriman Kakak ya agar saya bisa hitung ongkirnya.');
      }
      
      const s = await getSession(from);
      if (s && s.data.totalPrice) {
        // Collect Name/Phone for LID users if missing
        if (from.endsWith('@lid') && (!s.data.customerPhone || s.data.customerPhone === '')) {
          const hasPhone = /(\+?62|0)([\s-]*\d){8,14}/.test(text);
          if (hasPhone || (text.length > 5 && !/^(konfirmasi|benar|betul|iya|ya|sip|oke|ok)$/i.test(text.trim()))) {
            return await handleNamePhoneCollection(from, name, text, s.data);
          }
          return sender.sendText(from, `Sebelum pesanan diproses, boleh minta:\n👤 *Nama* dan 📱 *Nomor HP/WA* penerima?\n\n_Contoh: Budi, 081234567890_`);
        }
        return await finalizeOrder(from, name, s.data);
      } else if (s && !s.data.totalPrice) {
        return sender.sendText(from, 'Mohon kirim *Lokasi/Shareloc* dulu ya Kak agar total bayarnya muncul.');
      }
    }


    // --- BACK ---
    if (aiData.intent === 'BACK') {
      if (state === ST.LOCATION) {
        await upsertSession(from, ST.ORDER, session.data);
        return sender.sendText(from, '⬅️ Siap, silakan ubah pesanan Kakak (ketik nama roti & jumlah):');
      }
      if (state === ST.CONFIRM) {
        await upsertSession(from, ST.LOCATION, session.data);
        return sender.sendLocationRequest(from, '⬅️ Siap, silakan kirim ulang *Lokasi/Shareloc* Kakak:');
      }
      if (state === ST.PAYMENT) {
        await upsertSession(from, ST.CONFIRM, session.data);
        return sender.sendText(from, '⬅️ Siap Kak, kita kembali ke rincian pesanan ya. Ketik *Konfirmasi* jika sudah oke.');
      }
    }

    // --- QUERY: Tanya status pesanan ---
    // SKIP jika state CONFIRM dan user LID belum kasih nama/HP (biar fallback handleNamePhoneCollection jalan)
    if (aiData.intent === 'QUERY' && session?.data?.items) {
      if (state === ST.CONFIRM && from.endsWith('@lid') && (!session.data.customerPhone || session.data.customerPhone === '')) {
        // Jangan tangkap — biarkan jatuh ke fallback CONFIRM di bawah
      } else {
        const { text: summary } = buildOrderSummary(session.data.items, session.data.deliveryFee, session.data.notes);
        let queryMsg = '';
        if (aiData.answer) {
          queryMsg += `${aiData.answer}\n\n`;
        }
        queryMsg += `📋 *Status Pesanan Kakak:*\n\n${summary}\n\n`;
        
        // Berikan panduan langkah selanjutnya yang jelas berdasarkan state
        if (state === ST.LOCATION) {
          queryMsg += `📍 *Langkah selanjutnya:* Kirim *Lokasi/Shareloc* alamat pengiriman ya Kak (klik 📎 → Lokasi).`;
        } else if (state === ST.CONFIRM) {
          queryMsg += `✅ *Langkah selanjutnya:* Balas *Konfirmasi* jika pesanan sudah benar, atau *Kembali* jika ingin mengubah.`;
        } else if (state === ST.PAYMENT) {
          queryMsg += `💳 *Langkah selanjutnya:* Kirim *foto bukti transfer* untuk menyelesaikan pesanan.`;
        } else {
          queryMsg += `🛒 Silakan lanjutkan pesanan Kakak ya.`;
        }
        
        let curHistory = session?.data?.history || [];
        curHistory.push({ role: 'bot', content: queryMsg });
        if (curHistory.length > 10) curHistory = curHistory.slice(-10);
        await upsertSession(from, state, { ...session?.data, history: curHistory });

        return sender.sendText(from, queryMsg);
      }
    }

    // --- ORDER: Proses pesanan ---
    if (aiData.intent === 'ORDER') {
      if (state === ST.IDLE) {
        const products = await db.getProducts();
        const matchedItems = [];
        const ambiguousItems = [];
        
        if (aiData.items && aiData.items.length > 0) {
          aiData.items.forEach(newItem => {
            const result = fuzzyMatchProduct(newItem.name, products);
            if (result.ambiguous) {
              ambiguousItems.push({ original: newItem.name, matches: result.ambiguous, qty: newItem.qty });
              return;
            }
            let p = result.match;
            if (p) {
              matchedItems.push({ name: p.name, qty: newItem.qty || 1, price: p.price });
            } else {
              ambiguousItems.push({ original: newItem.name, matches: [], qty: newItem.qty || 1 });
            }
          });
        }
        
        data.customerName = aiData.customerName || name;
        data.chatMode = 'guided';
        data.items = matchedItems;
        data.ambiguousPending = ambiguousItems;
        data.notes = aiData.notes || '';
        await upsertSession(from, ST.REGION_SELECT, data);

        let welcomeMsg = `Halo Kak! Selamat datang di *Yoyo Bakery*! 🍞\n\n`;
        if (matchedItems.length > 0) {
          welcomeMsg += `Pesanan Kakak sudah saya catat ya:\n`;
          matchedItems.forEach((item, idx) => {
            welcomeMsg += `${idx + 1}. *${item.name}* (${item.qty} box)\n`;
          });
          welcomeMsg += `\n`;
        }
        welcomeMsg += `🌍 Sebelum lanjut, boleh tau Kakak berada di kota/daerah mana? Sebut saja nama wilayahnya ya Kak. 😊`;
        return sender.sendText(from, welcomeMsg);
      } else {
        return await handleOrderInput(from, name, text, aiData.items, aiData.customerName, aiData.notes, aiData.answer, aiData.address, true);
      }
    }
  }

  // 3. FALLBACK berdasarkan state
  switch (state) {
    case ST.IDLE:
      // Cek apakah pelanggan pernah pesan sebelumnya
      const lastOrder = await db.getLastOrder(from, session?.data?.customerPhone);
      if (lastOrder && lastOrder.customer_name) {
        data.customerName = lastOrder.customer_name;
        data.chatMode = 'guided';
        await upsertSession(from, ST.REGION_SELECT, data);
        return sender.sendText(from, `Halo Kak ${lastOrder.customer_name}! Selamat datang kembali di *Yoyo Bakery*! 🍞\n\n🌍 Boleh tau Kakak berada di daerah/kota mana ya? Sebut saja nama wilayahnya Kak. 😊`);
      } else {
        data.customerName = name;
        data.chatMode = 'guided';
        await upsertSession(from, ST.REGION_SELECT, data);
        return sender.sendText(from, `Halo Kak! Selamat datang di *Yoyo Bakery*! 🍞\n\n🌍 Boleh tau Kakak berada di daerah/kota mana ya? Sebut saja nama wilayahnya Kak. 😊`);
      }
    case ST.REGION_SELECT:
      return sender.sendText(from, '🌍 Boleh tau Kakak berada di daerah/kota mana ya? Sebut saja nama wilayahnya Kak. 😊');
    case ST.REJECTED:
      return sender.sendText(from, `Ada yang bisa kami bantu lagi Kak? 😊\n\nUntuk pemesanan, silakan kunjungi Shopee kami ya:\n🛒 *${config.shopeeUrl || 'https://shopee.co.id/yoyobakery'}*\n\nTerima kasih! 😊🍞`);
    case ST.ORDER: 
      if (aiData) {
        return await handleOrderInput(from, name, text, aiData.items, aiData.customerName, aiData.notes, aiData.answer, aiData.address, true);
      } else {
        return await handleOrderInput(from, name, text);
      }
    case ST.LOCATION:
      if (message.type === 'location') {
         return await handleLocation(from, name, message);
      }
      // Coba deteksi apakah text adalah sebuah alamat
      if (text && text.length > 10 && !['batal', 'kembali'].includes(text.toLowerCase().trim())) {
         const geo = await geocodeAddress(text);
         if (geo) {
           const mockLocationMessage = {
             type: 'location',
             location: {
               latitude: geo.lat,
               longitude: geo.lng,
               name: geo.formattedAddress
             }
           };
           return await handleLocation(from, name, mockLocationMessage);
         }
      }
      return sender.sendLocationRequest(from, '📍 Mohon kirim *Lokasi/Shareloc* pengiriman Kakak ya (Klik 📎 → Lokasi). Atau ketik alamat lengkap pengiriman.');
    case ST.CONFIRM:
      if (text.length > 0) {
        const s = await getSession(from);
        if (from.endsWith('@lid') && (!s.data.customerPhone || s.data.customerPhone === '')) {
           return await handleNamePhoneCollection(from, name, text, s.data);
        }
        // Tangkap kata "konfirmasi" langsung tanpa harus lewat AI
        const tConfirm = text.toLowerCase().trim();
        if (['konfirmasi', 'konfirm', 'confirm', 'ok', 'oke', 'iya', 'ya', 'sip', 'benar', 'betul', 'lanjut', 'gas', 'sudah benar'].some(k => tConfirm.includes(k))) {
          if (s && s.data.totalPrice) {
            return await finalizeOrder(from, name, s.data);
          }
        }

        // Tangkap alamat jika diinput saat confirm
        if (tConfirm.length > 15 && (tConfirm.includes('jl') || tConfirm.includes('jalan') || tConfirm.includes('gang') || tConfirm.includes('blok') || aiData?.intent === 'REGION_MATCH' || aiData?.address)) {
          return sender.sendText(from, 'Kak, jika ingin mengubah alamat pengiriman, silakan ketik *Kembali* terlebih dahulu ya.\n\nJika pesanan dan alamat sebelumnya sudah benar, silakan balas *Konfirmasi*.');
        }
      }
      return sender.sendText(from, '✅ Balas *Konfirmasi* jika pesanan sudah benar ya Kak, atau *Kembali* jika ingin mengubah. 🙏');
    case ST.PAYMENT:
      if (message.type === 'image') return await handlePaymentProof(from, message);
      return sender.sendText(from, '⌛ Menunggu foto bukti transfer Kakak. (Atau ketik *Kembali* jika ada yg salah)');
    default:
      return await handleGreeting(from, name);
  }
}

// ============================================================
// GREETING
// ============================================================

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return '🌅 Selamat Pagi!';
  if (hour >= 11 && hour < 15) return '☀️ Selamat Siang!';
  if (hour >= 15 && hour < 18) return '🌇 Selamat Sore!';
  return '🌙 Selamat Malam!';
}

async function sendMenuImages(from, captionText = '') {
  try {
    const page2 = fs.readFileSync(MENU_PAGE2);
    // Hanya kirim gambar menu roti (bukan kuker) dengan caption instruksi
    await sender.sendImage(from, page2, captionText);
  } catch (err) {
    logger.error('Gagal mengirim menu gambar', err);
    if (captionText) await sender.sendText(from, captionText);
  }
}

async function handleGreeting(from, name) {
  // Obsolete function, replaced by Onboarding IDLE logic, keeping it just in case
  const text = `Halo Kak ${name}! Selamat datang di Yoyo Bakery 🍞\n\nAda yang bisa kami bantu hari ini?`;
  return sender.sendText(from, text);
}

// ============================================================
// ORDER HANDLING
// ============================================================

async function handleOrderInput(from, name, text, aiItems = null, aiName = null, aiNotes = null, aiAnswer = null, aiAddress = null, hasAiParsed = false) {
  const session = await getSession(from);
  let existingItems = (session && session.data && session.data.items) ? session.data.items : [];
  let ambiguousPending = (session && session.data && session.data.ambiguousPending) ? session.data.ambiguousPending : [];
  
  let newItems = aiItems;
  let finalName = aiName || (session && session.data && session.data.customerName) || name;
  let finalNotes = aiNotes || (session && session.data && session.data.notes) || '';
  
  let aiDataLocal = null;
  if ((!newItems || newItems.length === 0) && !hasAiParsed) {
    logger.info({ text }, '🧠 Mencoba parse ulang pesanan via AI...');
    aiDataLocal = await aiParseOrder(text, ST.ORDER, ambiguousPending);
    newItems = aiDataLocal?.items || [];
    if (aiDataLocal?.customerName) finalName = aiDataLocal.customerName;
    if (aiDataLocal?.notes) finalNotes = aiDataLocal.notes;
    if (aiDataLocal?.address) aiAddress = aiDataLocal.address;
    if (aiDataLocal?.answer) aiAnswer = aiDataLocal.answer;
    
    // Jika AI menangkap intent CONFIRM, langsung arahkan ke lokasi atau konfirmasi (jika pickup)
    if (aiDataLocal?.intent === 'CONFIRM') {
      if (existingItems.length > 0) {
        if (session.data.isPickup) {
           session.data.deliveryFee = 0;
           if (!session.data.notes?.includes('(Pickup)')) session.data.notes = session.data.notes ? session.data.notes + ' (Pickup)' : '(Pickup)';
           const { text: summary } = buildOrderSummary(existingItems, 0, session.data.notes);
           await upsertSession(from, ST.CONFIRM, session.data);
           return sender.sendText(from, `Sip Kak! Pesanan sudah dicatat:\n\n${summary}\n\n✅ Balas *Konfirmasi* jika pesanan sudah benar ya Kak, atau *Kembali* jika ingin mengubah.`);
        } else {
           const { text: summary } = buildOrderSummary(existingItems, undefined, finalNotes);
           await upsertSession(from, ST.LOCATION, session.data);
           return sender.sendText(from, `Sip Kak! Pesanan sudah dicatat:\n\n${summary}\n\n📍 Mohon kirim *Lokasi/Shareloc* pengiriman Kakak ya agar saya bisa hitung ongkirnya.`);
        }
      }
    }
  }

  if ((!newItems || newItems.length === 0) && !aiAddress) {
    if (aiAnswer) {
      return sender.sendText(from, aiAnswer + '\n\n📝 _Silakan ketik pesanan Kakak ya._');
    }
    if (existingItems.length > 0) return sender.sendText(from, 'Maaf Kak, saya tidak paham tambahan pesanannya. Bisa diulang? (Contoh: "Tambah Nastar 1", atau ketik "Konfirmasi" untuk lanjut)');
    return sender.sendText(from, 'Maaf Kak, saya tidak menemukan nama roti dalam pesan Kakak. Bisa diulang? (Contoh: "Pesan Nastar 2")');
  }

  const products = await db.getProducts();
  const ambiguousItems = [];
  
  newItems.forEach(newItem => {
    // Cek pembatalan eksplisit
    const tLower = text ? text.toLowerCase() : '';
    const isExplicitCancel = ['bukan', 'nggak', 'gajadi', 'gak jadi', 'cancel', 'batal'].some(k => tLower.includes(k));

    const pendingIndex = ambiguousPending.findIndex(ap => 
      (ap.matches && ap.matches.some(m => m.toLowerCase().includes(newItem.name.toLowerCase()))) ||
      ap.original.toLowerCase() === newItem.name.toLowerCase() ||
      (isExplicitCancel && tLower.includes(ap.original.toLowerCase()))
    );

    if (pendingIndex !== -1) {
      const pendingQty = ambiguousPending[pendingIndex].qty;
      if ((newItem.qty === null || newItem.qty === 1 || !newItem.qty) && pendingQty) {
        newItem.qty = pendingQty;
      }
      ambiguousPending.splice(pendingIndex, 1);
    }

    const action = newItem.action || 'add';

    // SMART UPDATE/REMOVE: Cek keranjang terlebih dahulu
    if (action === 'update' || action === 'remove') {
      const exactExisting = existingItems.find(e => e.name.toLowerCase() === newItem.name.toLowerCase());
      const existingMatches = exactExisting ? [exactExisting] : existingItems.filter(e => e.name.toLowerCase().includes(newItem.name.toLowerCase()));
      
      if (existingMatches.length === 1) {
        const existingIndex = existingItems.findIndex(e => e.name === existingMatches[0].name);
        if (action === 'remove') {
          existingItems.splice(existingIndex, 1);
        } else {
          if (newItem.qty !== null && newItem.qty !== undefined) {
             existingItems[existingIndex].qty = newItem.qty;
          }
        }
        return; // Selesai untuk item ini
      } else if (action === 'remove') {
        // Jika action remove tapi ada multiple matches di keranjang, hapus semua matches tersebut
        if (existingMatches.length > 1) {
          existingMatches.forEach(m => {
            const idx = existingItems.findIndex(e => e.name === m.name);
            if (idx !== -1) existingItems.splice(idx, 1);
          });
        }
        return; // Selesai untuk item ini (juga berarti kita tidak memproses pencarian produk baru untuk dihapus)
      } else if (existingMatches.length > 1) {
        ambiguousItems.push({ original: newItem.name, matches: existingMatches.map(m => m.name), qty: newItem.qty });
        return;
      }
      // Jika tidak ada di keranjang, biarkan lanjut ke pencarian produk di bawah
    }

    if (action === 'remove') return;

    const result = fuzzyMatchProduct(newItem.name, products);
    if (result.ambiguous) {
      ambiguousItems.push({ original: newItem.name, matches: result.ambiguous, qty: newItem.qty });
      return;
    }
    let p = result.match;

    if (p) {
      const action = newItem.action || 'add';
      const existingIndex = existingItems.findIndex(e => e.name.toLowerCase() === p.name.toLowerCase());

      if (action === 'remove') {
        if (existingIndex !== -1) existingItems.splice(existingIndex, 1);
        return;
      }

      if (newItem.qty === null || newItem.qty === undefined || isNaN(newItem.qty)) {
        ambiguousItems.push({ original: p.name, type: 'missing_qty' });
        return;
      }

      if (action === 'update' && existingIndex !== -1) {
        existingItems[existingIndex].qty = newItem.qty;
      } else if (existingIndex !== -1) {
        existingItems[existingIndex].qty += newItem.qty;
      } else {
        existingItems.push({ name: p.name, qty: newItem.qty, price: p.price });
      }
    } else {
      ambiguousItems.push({ original: newItem.name, matches: [], qty: newItem.qty });
    }
  });

  if (ambiguousItems.length > 0) {
    let msg = '';
    if (aiAnswer && aiAnswer.trim() !== '') {
      msg += `${aiAnswer}\n\n`;
    }
    msg += '🤔 Maaf Kak, ada yang perlu diperjelas:\n\n';
    ambiguousItems.forEach(item => {
      if (item.type === 'missing_qty') {
        msg += `❓ *"${item.original}"* — Mau dipesan berapa banyak ya Kak?\n`;
      } else if (item.matches && item.matches.length > 0) {
        const qtyPrefix = item.qty ? `(${item.qty} pcs) ` : '';
        msg += `❓ *${qtyPrefix}"${item.original}"* — Kakak maksudnya yang mana?\n`;
        item.matches.forEach(m => msg += `   • ${m}\n`);
      } else {
        msg += `❓ *"${item.original}"* — Produk ini tidak ada di menu kami.\n`;
      }
      msg += '\n';
    });
    msg += 'Silakan balas rinciannya ya Kak. 🙏';

    let curHistory = session?.data?.history || [];
    curHistory.push({ role: 'bot', content: msg });
    if (curHistory.length > 10) curHistory = curHistory.slice(-10);

    await upsertSession(from, ST.ORDER, { 
      ...session?.data, 
      items: existingItems, 
      ambiguousPending: [...ambiguousPending, ...ambiguousItems],
      customerName: finalName, 
      notes: finalNotes,
      history: curHistory
    });
    return sender.sendText(from, msg);
  }

  existingItems = existingItems.filter(i => i.qty > 0);

  if (existingItems.length === 0) {
    return sender.sendText(from, 'Maaf Kak, pesanannya kosong. Silakan ketik nama roti & jumlahnya ya.');
  }

  const prevSession = await getSession(from);

  const isPickupNow = prevSession?.data?.isPickup || false;

  if (isPickupNow || (prevSession?.data?.customerLat && prevSession?.data?.customerLng)) {
    const fee = isPickupNow ? 0 : (prevSession.data.deliveryFee || 0);
    const { text: summary, itemsTotal } = buildOrderSummary(existingItems, fee, finalNotes);
    const finalTotal = itemsTotal + fee;

    let curHistory = prevSession.data.history || [];
    let msg = ``;
    if (aiAnswer && aiAnswer.trim() !== '') {
      msg += `${aiAnswer}\n\n`;
    }
    msg += `✅ *Pesanan Kakak Diperbarui:*\n\n${summary}\n\n`;
    if (!isPickupNow) {
      msg += `📍 Ongkir tetap menggunakan lokasi sebelumnya.\n`;
    }
    msg += `💰 *TOTAL BARU: Rp ${finalTotal.toLocaleString('id-ID')}*\n\n`;
    msg += `Apakah sudah benar?\nBalas *Konfirmasi* atau *Kembali*.`;

    curHistory.push({ role: 'bot', content: msg });
    if (curHistory.length > 100) curHistory = curHistory.slice(-100);

    await upsertSession(from, ST.CONFIRM, { 
      ...prevSession.data, 
      items: existingItems, 
      customerName: finalName,
      notes: finalNotes,
      totalPrice: finalTotal,
      history: curHistory
    });

    return sender.sendText(from, msg);
  } else {
    let curHistory = prevSession?.data?.history || [];
    const newSessionData = { 
      ...prevSession?.data,
      items: existingItems, 
      customerName: finalName,
      customerPhone: prevSession?.data?.customerPhone || null,
      notes: finalNotes,
      history: curHistory
    };

    if (aiAddress && aiAddress.trim() !== '') {
      const geo = await geocodeAddress(aiAddress);
      if (geo) {
        const lat = geo.lat;
        const lng = geo.lng;
        const addr = geo.formattedAddress;
        
        const q = await lalamove.getQuotation(lat, lng);
        if (q) {
          const fee = calculateDeliveryFee(q);
          
          if (fee > 50000) {
            await upsertSession(from, ST.REJECTED, newSessionData);
            let rejectMsg = `⚠️ Maaf Kak, ongkir ke lokasi tersebut terlalu mahal (Rp ${fee.toLocaleString('id-ID')}). Sepertinya lokasi Kakak di luar jangkauan pengiriman kami.\n\nPemesanan via WA hanya untuk area *Jakarta* ya Kak. Untuk luar Jakarta, silakan pesan via Shopee:\n🛒 ${config.shopeeUrl || 'https://shopee.co.id/'}`;
            curHistory.push({ role: 'bot', content: rejectMsg });
            if (curHistory.length > 100) curHistory = curHistory.slice(-100);
            return sender.sendText(from, rejectMsg);
          }

          const { text: summary, itemsTotal } = buildOrderSummary(existingItems, fee, finalNotes);
          const finalTotal = itemsTotal + fee;

          let msg = ``;
          if (aiAnswer && aiAnswer.trim() !== '') {
            msg += `${aiAnswer}\n\n`;
          }
          msg += `✅ *Pesanan Kakak Diperbarui:*\n\n${summary}\n\n`;
          msg += `📍 *Alamat Terdeteksi Otomatis:*\n_${addr}_\n\n`;
          msg += `💰 *TOTAL: Rp ${finalTotal.toLocaleString('id-ID')}*\n\n`;
          msg += `Apakah sudah benar?\nBalas *Konfirmasi* atau *Kembali*.`;

          curHistory.push({ role: 'bot', content: msg });
          if (curHistory.length > 100) curHistory = curHistory.slice(-100);

          await upsertSession(from, ST.CONFIRM, { 
            ...newSessionData, 
            customerLat: lat, 
            customerLng: lng, 
            customerAddress: addr, 
            deliveryFee: fee, 
            totalPrice: finalTotal,
            quotationId: q.quotationId,
            history: curHistory
          });

          return sender.sendText(from, msg);
        }
      }
    }

    const { text: summary } = buildOrderSummary(existingItems, undefined, finalNotes);
    const locationMsg = `📍 Silakan ketik *alamat lengkap pengiriman* Kakak, ATAU kirim Lokasi/Shareloc WhatsApp untuk hitung ongkir.`;

    let msg = ``;
    if (aiAnswer && aiAnswer.trim() !== '') {
      msg += `${aiAnswer}\n\n`;
    }
    
    if (aiAddress && aiAddress.trim() !== '') {
      msg += `📍 *Alamat Kakak sudah kami catat:*\n_${aiAddress}_\n\n⚠️ Namun, sistem gagal menemukan titik koordinat pasti dari alamat tersebut.\nBoleh bantu ketik ulang *alamat lengkap* Kakak, atau kirimkan *Lokasi/Shareloc* WhatsApp?\n\n`;
    }

    msg += `✅ *Pesanan Kakak:*\n\n${summary}\n\n`;
    
    msg += `🚚 Ongkir dihitung setelah konfirmasi alamat\n` +
      `📦 _Pesanan bersifat PO, dikirim *besok* setelah pembayaran dikonfirmasi._\n\n` +
      `💳 *Pembayaran via BCA:*\n` +
      `👤 ${config.payment.bcaName}\n` +
      `💳 ${config.payment.bcaNumber}\n\n` +
      `${locationMsg}\n\n` +
      `*Ketik:* _Batal_ / _Tambah [Nama Kue]_.\n` +
      `Mau *ubah jumlah*? Ketik: "Nastar jadi 3"`;

    curHistory.push({ role: 'bot', content: msg });
    if (curHistory.length > 100) curHistory = curHistory.slice(-100);
    newSessionData.history = curHistory;

    await upsertSession(from, ST.LOCATION, newSessionData);
    return sender.sendText(from, msg);
  }
}

// ============================================================
// LOCATION & CONFIRMATION
// ============================================================

async function estimateShipping(from, message, state) {
  const lat = message.location.latitude;
  const lng = message.location.longitude;
  const addr = message.location.name || `${lat},${lng}`;

  if (!lat || !lng || isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) {
    return sender.sendText(from, '⚠️ Lokasi yang dikirim tidak valid Kak.');
  }

  const q = await lalamove.getQuotation(lat, lng);
  if (!q) return sender.sendText(from, '⚠️ Gagal menghitung ongkir. Coba kirim ulang lokasi ya Kak.');

  const fee = calculateDeliveryFee(q);
  
  if (fee > 50000) {
    return sender.sendText(from, `⚠️ Ongkir ke lokasi tersebut cukup mahal (Estimasi Rp ${fee.toLocaleString('id-ID')}).\nPemesanan instan via WA hanya untuk area Jakarta ya Kak. Untuk luar Jakarta, silakan pesan via Shopee:\n🛒 ${config.shopeeUrl || 'https://shopee.co.id/'}`);
  }

  let reply = `📍 *Estimasi Ongkir Lalamove*\nKe: ${addr}\nBiaya: *Rp ${fee.toLocaleString('id-ID')}*\n\n_(Ongkir ini sudah disesuaikan dengan tarif sore/peak hour Lalamove)_`;

  if (state === ST.REGION_SELECT) {
    reply += `\n\n🌍 _Silakan lanjutkan dengan mengetik angka wilayah Kakak (1. Jakarta / 2. Luar Jakarta)._`;
  } else if (state === ST.ORDER) {
    reply += `\n\n📝 _Silakan ketik nama kue & jumlahnya untuk melanjutkan pesanan._`;
  }

  return sender.sendText(from, reply);
}

async function handleLocation(from, name, message) {
  const session = await getSession(from);
  if (!session || !session.data.items) return;

  const lat = message.location.latitude;
  const lng = message.location.longitude;
  const addr = message.location.name || `${lat},${lng}`;

  if (!lat || !lng || isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) {
    return sender.sendText(from, '⚠️ Lokasi yang dikirim tidak valid Kak. Coba kirim ulang *Lokasi/Shareloc* WhatsApp, atau ketik alamat lengkap Kakak.');
  }

  const q = await lalamove.getQuotation(lat, lng);
  if (!q) return sender.sendText(from, '⚠️ Gagal menghitung ongkir. Coba kirim ulang lokasi ya Kak.');

  const fee = calculateDeliveryFee(q);
  
  // OUT OF BOUNDS LIMIT (Max Rp 50.000)
  if (fee > 50000) {
    // Set state ke REJECTED karena di luar area
    await upsertSession(from, ST.REJECTED, session.data);
    return sender.sendText(from, `⚠️ Maaf Kak, ongkir ke lokasi tersebut terlalu mahal (Rp ${fee.toLocaleString('id-ID')}). Sepertinya lokasi Kakak di luar jangkauan pengiriman kami.\n\nPemesanan via WA hanya untuk area *Jakarta* ya Kak. Untuk luar Jakarta, silakan pesan via Shopee:\n🛒 ${config.shopeeUrl || 'https://shopee.co.id/'}`);
  }

  const { text: summary, itemsTotal } = buildOrderSummary(session.data.items, fee, session.data.notes);
  const finalTotal = itemsTotal + fee;

  let finalNotes = session.data.notes || '';
  if (session.data.customerPhone) {
    finalNotes = finalNotes ? `${finalNotes} (HP: ${session.data.customerPhone})` : `(HP: ${session.data.customerPhone})`;
  }

  await upsertSession(from, ST.CONFIRM, { 
    ...session.data, 
    customerLat: lat, 
    customerLng: lng, 
    customerAddress: addr, 
    deliveryFee: fee, 
    totalPrice: finalTotal, 
    quotationId: q.quotationId,
    notes: finalNotes
  });

  const msg = `📋 *Ringkasan Pesanan:*\n\n` +
    `${summary}\n\n` +
    `📏 Jarak: ${(q.distance.value / 1000).toFixed(1)} km\n` +
    `📍 Tujuan: ${addr}\n\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `💰 *TOTAL: Rp ${finalTotal.toLocaleString('id-ID')}*\n` +
    `━━━━━━━━━━━━━━━━━━━\n\n` +
    `💳 *Transfer ke:*\n` +
    `🏦 BCA\n` +
    `👤 ${config.payment.bcaName}\n` +
    `💳 ${config.payment.bcaNumber}\n\n` +
    `📦 _Pesanan PO — dikirim *besok* setelah pembayaran dikonfirmasi._\n\n` +
    `*Apakah sudah benar?*\n` +
    `Balas *Konfirmasi* atau *Kembali*.`;
  
  return sender.sendText(from, msg);
}

// LID users fallback for missing name/phone
async function handleNamePhoneCollection(from, name, text, data) {
  // Menangkap awalan +62 atau 0, diikuti 8-14 digit angka yang mungkin diselingi spasi atau tanda strip (-)
  const phoneRegex = /(\+?62|0)([\s-]*\d){8,14}/;
  const phoneMatch = text.match(phoneRegex);
  
  let cPhone = data.customerPhone;
  let cName = data.customerName || name;

  if (phoneMatch) {
    cPhone = phoneMatch[0].replace(/[\s-]/g, '').replace(/^0/, '62').replace(/^\+/, '');
    let nameCandidate = text.replace(phoneMatch[0], '')
                              .replace(/no\s*hp|hp|nomor|whatsapp|wa|atas\s*nama|nama/gi, '')
                              .replace(/[,.\-:;]/g, '')
                              .trim();
    nameCandidate = nameCandidate.split('\n')[0].trim(); // Ambil baris pertama saja
    if (nameCandidate.length > 30) nameCandidate = nameCandidate.substring(0, 30); // Batasi panjang nama
    if (nameCandidate.length >= 2) cName = nameCandidate;
  } else {
    const cleanText = text.replace(/[,.\-:;]/g, '').trim();
    if (cleanText.length >= 2 && !/^\d+$/.test(cleanText)) cName = cleanText;
  }

  if (cName && cPhone) {
    data.customerName = cName;
    data.customerPhone = cPhone;
    
    // Sisipkan nomor asli ke notes agar admin tetap bisa melihat nomor aslinya 
    // karena order sekarang akan disimpan menggunakan JID (@lid)
    if (!data.notes?.includes(`(HP: ${cPhone})`)) {
      data.notes = data.notes ? `${data.notes} (HP: ${cPhone})` : `(HP: ${cPhone})`;
    }
    
    await upsertSession(from, ST.CONFIRM, data);
    await db.upsertCustomer(cPhone, cName);
    return await finalizeOrder(from, name, data);
  } else {
    return sender.sendText(from, `Mohon maaf Kak, untuk keperluan pengiriman, kami butuh:\n👤 *Nama* dan 📱 *Nomor HP/WA*\n\n_Contoh: Andi, 081234567890_`);
  }
}

async function finalizeOrder(from, name, data) {
  // Selalu gunakan JID asli (from) sebagai wa_number agar bisa dilacak 
  // meskipun session expired (khususnya untuk user @lid)
  const finalWaNumber = from;

  const { data: newOrder, error } = await db.supabase.from('orders').insert([{
    wa_number: finalWaNumber,
    customer_name: data.customerName || name || 'Pelanggan',
    items: data.items,
    total_price: data.totalPrice,
    delivery_fee: data.deliveryFee,
    customer_lat: data.customerLat,
    customer_lng: data.customerLng,
    customer_address: data.customerAddress,
    lalamove_quotation_id: data.quotationId,
    notes: data.notes,
    payment_status: 'pending',
    order_status: 'waiting_payment'
  }]).select().single();

  if (error) {
    logger.error({ error: error.message, data }, '❌ Gagal menyimpan pesanan ke Supabase');
    return sender.sendText(from, '⚠️ Gagal membuat pesanan. Coba lagi nanti ya Kak.');
  }

  const orderNumber = newOrder.order_number;
  await upsertSession(from, ST.PAYMENT, { ...data, orderId: newOrder.id, orderNumber: orderNumber });

  const totalPriceStr = (data.totalPrice || 0).toLocaleString('id-ID');
  const msg = `✅ *Pesanan #${orderNumber} Diterima!*\n\n` +
    `💰 *Total Pembayaran: Rp ${totalPriceStr}*\n\n` +
    `💳 *Transfer ke:*\n` +
    `🏦 BCA\n` +
    `👤 ${config.payment.bcaName}\n` +
    `💳 ${config.payment.bcaNumber}\n\n` +
    `📦 _Pesanan PO — akan dikirim *besok* setelah pembayaran dikonfirmasi admin._\n\n` +
    `⏰ _Batas pembayaran: *2 hari*. Setelah itu pesanan otomatis batal._\n\n` +
    `Silakan kirim *FOTO BUKTI TRANSFER* di sini ya Kak. 🙏`;
  
  return sender.sendText(from, msg);
}

// ============================================================
// PAYMENT PROOF
// ============================================================

async function handlePaymentProof(from, message) {
  const session = await getSession(from);
  if (!session || !session.data.orderId) return;

  const orderId = session.data.orderId;
  const orderNumber = session.data.orderNumber;
  const items = session.data.items || [];
  const total = session.data.totalPrice || 0;
  
  const imageBuffer = await sender.downloadMedia(message);
  
  let itemText = '';
  items.forEach(it => itemText += `- ${it.name} x${it.qty}\n`);

  const customerName = session.data.customerName || session.data.name || from;
  const cleanNumber = from.split('@')[0];
  
  let waLink = '';
  if (session.data.customerPhone) {
    waLink = `https://wa.me/${session.data.customerPhone}`;
  } else if (from.endsWith('@s.whatsapp.net')) {
    waLink = `https://wa.me/${cleanNumber}`;
  } else {
    waLink = `(Akun LID: ${from})`;
  }

  const adminMsg = `🔔 *BUKTI TRANSFER BARU!* (Pesanan #${orderNumber})\n\n` +
    `👤 *Dari:* ${customerName}\n` +
    `📱 *Chat:* ${waLink}\n` +
    `📦 *Pesanan:*\n${itemText}` +
    (session.data.notes ? `📝 *Catatan:* ${session.data.notes}\n` : '') +
    `💰 *Total:* Rp ${total.toLocaleString('id-ID')}\n` +
    `📦 *Status:* PO — Kirim besok\n\n` +
    `👉 Ketik */bayar ${orderNumber}* jika sudah valid.`;

  let paymentProofUrl = null;
  if (imageBuffer) {
    await sender.sendImage(config.adminPhone, imageBuffer, adminMsg);
    // Upload ke Supabase
    paymentProofUrl = await db.uploadPaymentProof(orderNumber, imageBuffer, message.message?.imageMessage?.mimetype || 'image/jpeg');
  } else {
    await sender.sendText(config.adminPhone, adminMsg + '\n\n⚠️ (Gagal mengunduh gambar bukti)');
  }

  const updates = { payment_status: 'reviewing' };
  if (paymentProofUrl) updates.payment_proof_url = paymentProofUrl;
  
  await db.updateOrder(orderId, updates);
  await upsertSession(from, ST.IDLE, {
    customerPhone: session?.data?.customerPhone || '',
    customerName: session?.data?.customerName || ''
  });

  return sender.sendText(from, 
    `✅ *Bukti transfer diterima!*\n\n` +
    `Admin akan segera memverifikasi pembayaran Kakak.\n\n` +
    `📦 Setelah dikonfirmasi, pesanan akan *dikirim besok* ya Kak.\n` +
    `Kami akan kabari Kakak saat kurir dijalan! 🚚\n\n` +
    `Terima kasih sudah belanja di Yoyo Bakery! 😊🍞`
  );
}

module.exports = { handleCustomerMessage };
