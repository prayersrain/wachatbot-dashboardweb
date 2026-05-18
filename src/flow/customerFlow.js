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

// Order States
const ST = {
  IDLE: 'IDLE',
  ONBOARDING: 'ONBOARDING',
  REGION_SELECT: 'REGION_SELECT',
  REJECTED: 'REJECTED',          // Sudah ditolak (luar jangkauan)
  ORDER: 'ORDER',                // Gabungan CATALOG dan pesanan
  LOCATION: 'LOCATION',
  CONFIRM: 'CONFIRM',
  PAYMENT: 'PAYMENT'
};

// Menu images
const MENU_PAGE1 = path.join(__dirname, '..', 'assets', 'menu-page1.jpg');
const MENU_PAGE2 = path.join(__dirname, '..', 'assets', 'menu-page2.jpg');

/**
 * Handle messages from customers
 */
async function handleCustomerMessage(from, name, message) {
  const session = await getSession(from);
  const state = session ? session.state : ST.IDLE;
  const text = message.text?.body || '';

  // 1. SMART PARSE
  let aiData = null;
  const t = text.toLowerCase().trim();
  
  if (state === ST.REGION_SELECT && ['1', 'jakarta', '1. jakarta', 'dki jakarta', '2', 'luar jakarta', '2. luar jakarta', 'luar kota'].includes(t)) {
    // Bypass AI untuk input wilayah yang valid
    aiData = { intent: 'REGION_MATCH' };
  } else if (text.trim().length > 0) {
    aiData = await aiParseOrder(text, state, session?.data?.ambiguousPending);
  }

  // ═══ SMART INTERRUPT (state-independent) ═══
  // Jawab pertanyaan kapan saja tanpa merusak state saat ini
  if (state === ST.ONBOARDING) {
    // BLOKIR SEMUA SMART INTERRUPT DI ONBOARDING (Kaku)
  } else if (aiData && ['FAQ', 'QUESTION', 'THANKS', 'SHOW_MENU', 'OTHER', 'GREETING', 'ACKNOWLEDGE', 'ADMIN'].includes(aiData.intent)) {
    const isLidWaitingPhone = state === ST.CONFIRM && from.endsWith('@lid') && (!session?.data?.customerPhone || session.data.customerPhone === '');
    const hasPhoneNumber = /(\+?62|0)\d{8,13}/.test(text.replace(/[\s-]/g, ''));

    // Pengecualian: Jika di awal (IDLE) dan sapaan, biarkan flow normal berjalan
    if (state === ST.IDLE && aiData.intent === 'GREETING') {
      // Biarkan lanjut ke FLOW LOGIC di bawah
    } else if (isLidWaitingPhone && hasPhoneNumber) {
      // Pengecualian 2: Jika user LID sedang ditanya nomor HP, biarkan lolos ke fallback bawah
    } else if (aiData.intent === 'ACKNOWLEDGE' || (state === ST.IDLE && ['OTHER', 'THANKS'].includes(aiData.intent))) {
      // Abaikan pesan basa-basi/terima kasih supaya bot tidak cerewet (chatterbot) setelah pesanan selesai
      return;
    } else if (aiData.intent === 'ADMIN') {
      return sender.sendText(from, "Mohon maaf atas ketidaknyamanannya Kak. 🙏 Pesan Kakak sudah kami teruskan ke tim Admin. Harap tunggu sebentar ya, admin manusia kami akan segera membalas chat ini.");
    } else {
      if (aiData.intent === 'SHOW_MENU') {
        await sendMenuImages(from, 'Silakan pilih menu favorit Kakak! 👇');
      } else if (aiData.answer) {
        let reminder = '';
        if (state === ST.REGION_SELECT) reminder = '\n\n🌍 _Mohon pilih wilayah Kakak (1. Jakarta, 2. Luar Jakarta)._';
        else if (state === ST.LOCATION) reminder = '\n\n📍 _Silakan kirim lokasi/shareloc pengiriman ya Kak._';
        else if (state === ST.ORDER && session?.data?.items?.length > 0) reminder = '\n\n📝 _Silakan ketik nama kue & jumlahnya._';
        else if (state === ST.ORDER) reminder = '\n\n📝 _Silakan ketik pesanan atau perjelas nama kuenya._';
        else if (state === ST.CONFIRM) reminder = '\n\n✅ _Mohon balas dengan *Konfirmasi* untuk lanjut._';
        else if (state === ST.PAYMENT) reminder = '\n\n⌛ _Menunggu kiriman foto bukti transfer Kakak._';
        
        await sender.sendText(from, aiData.answer + reminder);
      }
      return; // Selesai, jangan ubah state
    }
  }

  // ═══ FLOW LOGIC (state-dependent) ═══
  if (aiData) {
    // --- REJECTED: Customer luar Jakarta ---
    if (state === ST.REJECTED) {
      const shopeeUrl = config.shopeeUrl || 'https://shopee.co.id/yoyobakery';
      const rejectionMsg = `Maaf Kak, pemesanan via WhatsApp hanya untuk area *Jakarta* ya. 🙏\n\nUntuk luar Jakarta, Kakak bisa pesan di Shopee kami:\n🛒 *${shopeeUrl}*\n\nTerima kasih! 😊🍞`;
      
      const blockedIntents = ['ORDER', 'CONFIRM', 'LOCATION'];
      if (blockedIntents.includes(aiData.intent)) {
        return sender.sendText(from, rejectionMsg);
      }
      return sender.sendText(from, `Ada yang bisa kami bantu lagi Kak? 😊\n\nUntuk pemesanan, silakan kunjungi Shopee kami ya:\n🛒 *${shopeeUrl}*`);
    }

    // --- ONBOARDING HANYA BERLAKU JIKA ADA ONBOARD_START ---
    if (state === ST.ONBOARDING && (aiData.intent === 'ONBOARD_START' || text.toLowerCase().trim() === 'mulai')) {
      await upsertSession(from, ST.REGION_SELECT, session ? session.data : {});
      return sender.sendText(from, '🌍 Boleh tau untuk pengiriman ke daerah mana Kak?\n\n1. Jakarta\n2. Luar Jakarta\n\n_Ketik angka 1 atau 2 ya Kak._');
    }

    // --- REGION_SELECT: Pilihan Wilayah ---
    if (state === ST.REGION_SELECT) {
      const t = text.toLowerCase().trim();
      if (['1', 'jakarta', '1. jakarta', 'dki jakarta'].includes(t)) {
        await upsertSession(from, ST.ORDER, session.data);
        return sendMenuImages(from, 'Siap Kak, pesanan area *Jakarta*! 🍞\n\nSilakan ketik nama kue & jumlahnya (Contoh: Nastar Classic 2, Bolen Coklat 1).');
      } else if (['2', 'luar jakarta', '2. luar jakarta', 'luar kota'].includes(t)) {
        await upsertSession(from, ST.REJECTED, session.data);
        const shopeeUrl = config.shopeeUrl || 'https://shopee.co.id/yoyobakery';
        return sender.sendText(from, `Maaf Kak, pemesanan via WhatsApp instan saat ini khusus untuk area *Jakarta* ya. 🙏\n\nUntuk luar kota, Kakak bisa pesan melalui Shopee kami:\n🛒 *${shopeeUrl}*\n\nTerima kasih banyak! 😊🍞`);
      } else if (aiData.intent !== 'FAQ') {
        // Jika bukan FAQ/nanya-nanya, tapi jawabannya nggak match angka 1/2
        return sender.sendText(from, 'Mohon pilih wilayah Kakak dengan membalas *1* atau *2* ya. 🙏');
      }
    }

    // --- CONFIRM ---
    if (aiData.intent === 'CONFIRM' && (state === ST.LOCATION || state === ST.CONFIRM || state === ST.PAYMENT)) {
      if (state === ST.LOCATION) return sender.sendLocationRequest(from, 'Sip Kak! Mohon kirim *Lokasi/Shareloc* pengiriman Kakak ya agar saya bisa hitung ongkirnya.');
      
      const s = await getSession(from);
      if (s && s.data.totalPrice) {
        // Collect Name/Phone for LID users if missing
        if (from.endsWith('@lid') && (!s.data.customerPhone || s.data.customerPhone === '')) {
          return sender.sendText(from, `Sebelum pesanan diproses, boleh minta:\n👤 *Nama* dan 📱 *Nomor HP/WA* penerima?\n\n_Contoh: Budi, 081234567890_`);
        }
        return await finalizeOrder(from, name, s.data);
      } else if (s && !s.data.totalPrice) {
        return sender.sendText(from, 'Mohon kirim *Lokasi/Shareloc* dulu ya Kak agar total bayarnya muncul.');
      }
    }
    
    // --- CANCEL ---
    if (aiData.intent === 'CANCEL') {
      await deleteSession(from);
      return sender.sendText(from, '❌ Pesanan telah dibatalkan. Ketik *Halo* untuk mulai baru.');
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
    if (aiData.intent === 'QUERY' && session?.data?.items) {
      const { text: summary } = buildOrderSummary(session.data.items, session.data.deliveryFee, session.data.notes);
      let queryMsg = `📋 *Status Pesanan Kakak:*\n\n${summary}\n\n`;
      if (session.data.notes) {
        queryMsg += `📝 *Catatan Khusus:* ${session.data.notes}\n\n`;
      }
      queryMsg += `*Silakan lanjut proses pemesanan sesuai petunjuk sebelumnya.*`;
      return sender.sendText(from, queryMsg);
    }

    // --- ORDER: Proses pesanan ---
    if (aiData.intent === 'ORDER' && state !== ST.IDLE && state !== ST.ONBOARDING) {
      return await handleOrderInput(from, name, text, aiData.items, aiData.customerName, aiData.notes, aiData.answer);
    }
  }

  // 3. FALLBACK berdasarkan state
  switch (state) {
    case ST.IDLE:
      // Di state IDLE, jika bukan intent FAQ/QUESTION dsb yang ditangkap Smart Interrupt,
      // bot akan langsung nge-lempar instruksi awal.
      await upsertSession(from, ST.ONBOARDING, { customerName: name, chatMode: 'guided' });
      return sender.sendText(from, `Halo Kak! Selamat datang di Yoyo Bakery! 🍞\n\nCara pemesanan sangat mudah:\n1. Ketik nama kue dan jumlahnya (Contoh: Bolen Coklat Keju 1).\n2. Bot akan merekap pesanan Kakak.\n3. Kirim lokasi untuk hitung ongkir kurir.\n4. Selesaikan pembayaran transfer BCA.\n\n👉 Jika sudah paham, ketik *MULAI* untuk memesan.`);
    case ST.ONBOARDING:
      return; // Silent ignore jika pelanggan ngetik selain mulai
    case ST.REGION_SELECT:
      return sender.sendText(from, '🌍 Boleh tau untuk pengiriman ke daerah mana Kak?\n\n1. Jakarta\n2. Luar Jakarta\n\n_Ketik angka 1 atau 2 ya Kak._');
    case ST.REJECTED:
      return sender.sendText(from, `Ada yang bisa kami bantu lagi Kak? 😊\n\nUntuk pemesanan, silakan kunjungi Shopee kami ya:\n🛒 *${config.shopeeUrl || 'https://shopee.co.id/yoyobakery'}*\n\nTerima kasih! 😊🍞`);
    case ST.ORDER: 
      return await handleOrderInput(from, name, text);
    case ST.LOCATION:
      if (message.type === 'location') {
         return await handleLocation(from, name, message);
      }
      return sender.sendLocationRequest(from, '📍 Mohon kirim *Lokasi/Shareloc* pengiriman Kakak ya (Klik 📎 → Lokasi).');
    case ST.CONFIRM:
      if (text.length > 0) {
        const s = await getSession(from);
        if (from.endsWith('@lid') && (!s.data.customerPhone || s.data.customerPhone === '')) {
           return await handleNamePhoneCollection(from, name, text, s.data);
        }
      }
      return sender.sendText(from, 'Mohon balas dengan *Konfirmasi* untuk lanjut, atau *Kembali* untuk ubah data. 🙏');
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

async function handleOrderInput(from, name, text, aiItems = null, aiName = null, aiNotes = null, aiAnswer = null) {
  const session = await getSession(from);
  let existingItems = (session && session.data && session.data.items) ? session.data.items : [];
  let ambiguousPending = (session && session.data && session.data.ambiguousPending) ? session.data.ambiguousPending : [];
  
  let newItems = aiItems;
  let finalName = aiName || (session && session.data && session.data.customerName) || name;
  let finalNotes = aiNotes || (session && session.data && session.data.notes) || '';
  
  if (!newItems || newItems.length === 0) {
    logger.info({ text }, '🧠 Mencoba parse ulang pesanan via AI...');
    const aiData = await aiParseOrder(text, ST.ORDER, ambiguousPending);
    newItems = aiData?.items;
    if (aiData?.customerName) finalName = aiData.customerName;
    if (aiData?.notes) finalNotes = aiData.notes;
  }

  if (!newItems || newItems.length === 0) {
    if (existingItems.length > 0) return sender.sendText(from, 'Maaf Kak, saya tidak paham tambahan pesanannya. Bisa diulang? (Contoh: "Tambah Nastar 1")');
    return sender.sendText(from, 'Maaf Kak, saya tidak menemukan nama roti dalam pesan Kakak. Bisa diulang? (Contoh: "Pesan Nastar 2")');
  }

  const products = await db.getProducts();
  const ambiguousItems = [];
  
  newItems.forEach(newItem => {
    const pendingIndex = ambiguousPending.findIndex(ap => 
      (ap.matches && ap.matches.some(m => m.toLowerCase().includes(newItem.name.toLowerCase()))) ||
      ap.original.toLowerCase() === newItem.name.toLowerCase()
    );

    if (pendingIndex !== -1) {
      const pendingQty = ambiguousPending[pendingIndex].qty;
      if ((newItem.qty === null || newItem.qty === 1 || !newItem.qty) && pendingQty) {
        newItem.qty = pendingQty;
      }
      ambiguousPending.splice(pendingIndex, 1);
    }

    let p = products.find(prod => prod.name.toLowerCase() === newItem.name.toLowerCase());
    
    if (!p) {
      const matches = products.filter(prod => prod.name.toLowerCase().includes(newItem.name.toLowerCase()));
      if (matches.length > 1) {
        ambiguousItems.push({ original: newItem.name, matches: matches.map(m => m.name), qty: newItem.qty });
        return;
      } else if (matches.length === 1) {
        p = matches[0];
      }
    }

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
    let msg = '🤔 Maaf Kak, ada yang perlu diperjelas:\n\n';
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

    await upsertSession(from, ST.ORDER, { 
      ...session?.data, 
      items: existingItems, 
      ambiguousPending: [...ambiguousPending, ...ambiguousItems],
      customerName: finalName, 
      notes: finalNotes 
    });
    return sender.sendText(from, msg);
  }

  existingItems = existingItems.filter(i => i.qty > 0);

  if (existingItems.length === 0) {
    return sender.sendText(from, 'Maaf Kak, pesanannya kosong. Silakan ketik nama roti & jumlahnya ya.');
  }

  const prevSession = await getSession(from);
  await upsertSession(from, ST.LOCATION, { 
    items: existingItems, 
    customerName: finalName,
    customerPhone: prevSession?.data?.customerPhone || null,
    notes: finalNotes
  });

  const { text: summary } = buildOrderSummary(existingItems, undefined, finalNotes);
  const locationMsg = `📍 Silakan kirim *Lokasi/Shareloc* Kakak untuk hitung ongkir ya!\n_(Klik 📎 → Lokasi)_`;

  let msg = ``;
  if (aiAnswer && aiAnswer.trim() !== '') {
    msg += `${aiAnswer}\n\n`;
  }
  msg += `✅ *Pesanan Kakak:*\n\n${summary}\n\n`;
  if (finalNotes && finalNotes.trim() !== '') {
    msg += `📝 *Catatan Khusus:* ${finalNotes}\n\n`;
  }
  
  msg += `🚚 Ongkir dihitung setelah kirim lokasi\n` +
    `📦 _Pesanan bersifat PO, dikirim *besok* setelah pembayaran dikonfirmasi._\n\n` +
    `${locationMsg}\n\n` +
    `*Ketik:* _Batal_ / _Tambah [Nama Kue]_.\n` +
    `Mau *ubah jumlah*? Ketik: "Nastar jadi 3"`;

  return sender.sendText(from, msg);
}

// ============================================================
// LOCATION & CONFIRMATION
// ============================================================

async function handleLocation(from, name, message) {
  const session = await getSession(from);
  if (!session || !session.data.items) return;

  const lat = message.location.latitude;
  const lng = message.location.longitude;
  const addr = message.location.name || `${lat},${lng}`;

  if (!lat || !lng || isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) {
    return sender.sendText(from, '⚠️ Lokasi yang dikirim tidak valid Kak. Coba kirim ulang lokasi lewat fitur *Kirim Lokasi Terkini* ya.');
  }

  const q = await lalamove.getQuotation(lat, lng);
  if (!q) return sender.sendText(from, '⚠️ Gagal menghitung ongkir. Coba kirim ulang lokasi ya Kak.');

  const dist = (q.distance.value / 1000).toFixed(1);
  const fee = parseFloat(q.total); 
  
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
    `📏 Jarak: ${dist} km\n` +
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
    const nameCandidate = text.replace(phoneMatch[0], '')
                              .replace(/no\s*hp|hp|nomor|whatsapp|wa|atas\s*nama|nama/gi, '')
                              .replace(/[,.\-:;]/g, '')
                              .trim();
    if (nameCandidate.length >= 2) cName = nameCandidate;
  } else {
    const cleanText = text.replace(/[,.\-:;]/g, '').trim();
    if (cleanText.length >= 2 && !/^\d+$/.test(cleanText)) cName = cleanText;
  }

  if (cName && cPhone) {
    data.customerName = cName;
    data.customerPhone = cPhone;
    await upsertSession(from, ST.CONFIRM, data);
    await db.upsertCustomer(cPhone, cName);
    return await finalizeOrder(from, name, data);
  } else {
    return sender.sendText(from, `Mohon maaf Kak, untuk keperluan pengiriman, kami butuh:\n👤 *Nama* dan 📱 *Nomor HP/WA*\n\n_Contoh: Andi, 081234567890_`);
  }
}

async function finalizeOrder(from, name, data) {
  const finalWaNumber = data.customerPhone || from;

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
  await deleteSession(from);

  return sender.sendText(from, 
    `✅ *Bukti transfer diterima!*\n\n` +
    `Admin akan segera memverifikasi pembayaran Kakak.\n\n` +
    `📦 Setelah dikonfirmasi, pesanan akan *dikirim besok* ya Kak.\n` +
    `Kami akan kabari Kakak saat kurir dijalan! 🚚\n\n` +
    `Terima kasih sudah belanja di Yoyo Bakery! 😊🍞`
  );
}

module.exports = { handleCustomerMessage };
