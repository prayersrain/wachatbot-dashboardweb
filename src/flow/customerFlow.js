const logger = require('../utils/logger');
const sender = require('../whatsapp/sender');
const db = require('../database/supabase');
const { aiParseOrder } = require('./aiParser');
const { getSession, upsertSession, deleteSession } = require('../database/supabase');
const config = require('../config');
const lalamove = require('../lalamove/client');
const path = require('path');
const fs = require('fs');

// Order States
const ST = {
  IDLE: 'IDLE',
  NAME_PHONE: 'NAME_PHONE',      // Tanya nama & nomor HP
  REGION_CHECK: 'REGION_CHECK',  // Tanya Jakarta / Luar Jakarta
  REJECTED: 'REJECTED',          // Sudah ditolak (luar Jakarta)
  CATALOG: 'CATALOG',
  ORDER: 'ORDER',
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

  // 1. SMART PARSE (3 Layer: Keyword → FAQ → AI)
  let aiData = null;
  if (text.trim().length > 0) {
    aiData = await aiParseOrder(text);
  }

  // 2. LOGIC BERDASARKAN NIAT (INTENT)
  if (aiData) {
    // --- REJECTED: Customer sudah diarahkan ke Shopee, hanya tolak usaha order ---
    if (state === ST.REJECTED) {
      // Biarkan THANKS, FAQ, QUESTION lewat — hanya block ORDER/CONFIRM/GREETING
      if (aiData.intent === 'THANKS') {
        return sender.sendText(from, aiData.answer || 'Sama-sama Kak! 😊🍞');
      }
      if (aiData.intent === 'FAQ' && aiData.answer) {
        return sender.sendText(from, aiData.answer);
      }
      if (aiData.intent === 'QUESTION' && aiData.answer) {
        return sender.sendText(from, aiData.answer);
      }
      // Semua intent lain (ORDER, GREETING, CONFIRM, dll) → tolak
      return sender.sendText(from, `Maaf Kak, pemesanan via WhatsApp hanya untuk area *Jakarta* ya. 🙏\n\nUntuk luar Jakarta, Kakak bisa pesan di Shopee kami:\n🛒 *${config.shopeeUrl || 'https://shopee.co.id/yoyobakery'}*\n\nTerima kasih! 😊🍞`);
    }

    // --- GREETING & REGION HANYA BERLAKU DI AWAL ---
    if (state === ST.IDLE || state === ST.NAME_PHONE || state === ST.REGION_CHECK) {
      if (aiData.intent === 'GREETING') {
        return await handleGreeting(from, name);
      }
      if (state === ST.REGION_CHECK) {
        if (aiData.intent === 'REGION_JAKARTA') {
          return await handleRegionJakarta(from, name);
        }
        if (aiData.intent === 'REGION_LUAR') {
          return await handleRegionLuar(from, name);
        }
      }
    }

    // --- THANKS: Balas terima kasih (gratis) ---
    if (aiData.intent === 'THANKS') {
      return sender.sendText(from, aiData.answer || 'Sama-sama Kak! 😊🍞');
    }

    // --- FAQ: Jawab dari knowledge base (gratis) ---
    if (aiData.intent === 'FAQ' && aiData.answer) {
      return sender.sendText(from, aiData.answer);
    }

    // --- SHOW_MENU: Tampilkan menu gambar ---
    if (aiData.intent === 'SHOW_MENU') {
      return await sendMenuImages(from, name);
    }

    // --- QUESTION: Jawab pertanyaan umum dari AI ---
    if (aiData.intent === 'QUESTION' && aiData.answer) {
      return sender.sendText(from, aiData.answer);
    }

    // --- CONFIRM ---
    if (aiData.intent === 'CONFIRM' && (state === ST.LOCATION || state === ST.CONFIRM || state === ST.PAYMENT)) {
      if (state === ST.LOCATION) return sender.sendLocationRequest(from, 'Sip Kak! Mohon kirim *Lokasi/Shareloc* pengiriman Kakak ya agar saya bisa hitung ongkirnya.');
      
      const s = await getSession(from);
      if (s && s.data.totalPrice) return await finalizeOrder(from, s.data);
      else if (s && !s.data.totalPrice) return sender.sendText(from, 'Mohon kirim *Lokasi/Shareloc* dulu ya Kak agar total bayarnya muncul.');
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
      const { buildOrderSummary } = require('./orderParser');
      const { text: summary } = buildOrderSummary(session.data.items, session.data.deliveryFee, session.data.notes);
      let queryMsg = `📋 *Status Pesanan Kakak:*\n\n${summary}\n\n`;
      if (session.data.notes) {
        queryMsg += `📝 *Catatan Khusus:* ${session.data.notes}\n\n`;
      }
      queryMsg += `*Silakan lanjut kirim lokasi atau ketik Konfirmasi.*`;
      return sender.sendText(from, queryMsg);
    }

    // --- ORDER: Proses pesanan ---
    if (aiData.intent === 'ORDER') {
      // Jika belum selesai registrasi, tanya dulu
      if (state === ST.IDLE || state === ST.NAME_PHONE || state === ST.REGION_CHECK) {
        return await handleGreeting(from, name);
      }
      return await handleOrderInput(from, name, text, aiData.items, aiData.customerName, aiData.notes);
    }
  }

  // 3. FALLBACK berdasarkan state
  switch (state) {
    case ST.IDLE: 
      return await handleGreeting(from, name);
    case ST.NAME_PHONE:
      return await handleNamePhone(from, text);
    case ST.REGION_CHECK:
      // Customer jawab sesuatu yang bukan Jakarta/Luar — tanya ulang
      return sender.sendText(from, '🤔 Maaf Kak, Kakak berada di *Jakarta* atau *Luar Jakarta*?\n\nBalas:\n1️⃣ *Jakarta* (pesan via bot)\n2️⃣ *Luar Jakarta* (pesan via Shopee)');
    case ST.REJECTED:
      return sender.sendText(from, `Maaf Kak, pemesanan via WhatsApp hanya untuk area *Jakarta* ya. 🙏\n\nUntuk luar Jakarta, Kakak bisa pesan di Shopee kami:\n🛒 *${config.shopeeUrl || 'https://shopee.co.id/yoyobakery'}*\n\nTerima kasih! 😊🍞`);
    case ST.CATALOG: 
    case ST.ORDER: 
      return await handleOrderInput(from, name, text);
    case ST.LOCATION:
      if (message.type === 'location') {
         return await handleLocation(from, name, message, state);
      }
      return sender.sendLocationRequest(from, '📍 Mohon kirim *Lokasi/Shareloc* pengiriman Kakak ya (Klik 📎 → Lokasi).');
    case ST.CONFIRM:
      return sender.sendText(from, 'Mohon balas dengan *Konfirmasi* untuk lanjut, atau *Kembali* untuk ubah data. 🙏');
    case ST.PAYMENT:
      if (message.type === 'image') return await handlePaymentProof(from, message);
      return sender.sendText(from, '⌛ Menunggu foto bukti transfer Kakak. (Atau ketik *Kembali* jika ada yg salah)');
    default:
      return await handleGreeting(from, name);
  }
}

// ============================================================
// GREETING & REGION CHECK
// ============================================================

async function handleGreeting(from, name) {
  const greeting = getTimeGreeting();
  
  // Cek apakah customer returning (sudah ada di database)
  const existingCustomer = await db.getCustomerByPhone(from);
  
  if (existingCustomer && existingCustomer.name) {
    // RETURNING CUSTOMER → skip tanya nama/HP, langsung tanya region
    await upsertSession(from, ST.REGION_CHECK, { 
      customerName: existingCustomer.name, 
      customerPhone: from.split('@')[0] 
    });
    
    const msg = `${greeting}\n\n` +
      `🎉 *Selamat datang kembali di Yoyo Bakery!* 🍞\n\n` +
      `Hai Kak *${existingCustomer.name}*! Senang melayani Kakak lagi 😊\n\n` +
      `Kakak berada di daerah mana ya?\n\n` +
      `1️⃣ *Jakarta* (pesan via bot)\n` +
      `2️⃣ *Luar Jakarta* (pesan via Shopee)\n\n` +
      `_Balas dengan angka atau ketik daerahnya ya Kak_ 🙏`;
    
    return sender.sendText(from, msg);
  }
  
  // NEW CUSTOMER → tanya nama & HP dulu
  await upsertSession(from, ST.NAME_PHONE);
  
  const msg = `${greeting}\n\n` +
    `✨ *Selamat datang di Yoyo Bakery!* 🍞\n\n` +
    `Sebelum order, boleh tau:\n` +
    `👤 *Atas nama siapa?*\n` +
    `📱 *Nomor HP/WA Kakak?*\n\n` +
    `_Contoh: Andi, 081234567890_`;

  return sender.sendText(from, msg);
}

/**
 * Handle name & phone input from customer
 */
async function handleNamePhone(from, text) {
  const session = await getSession(from);
  let customerName = session?.data?.customerName || null;
  let customerPhone = session?.data?.customerPhone || null;
  
  // Parse nama dan nomor dari pesan
  const phoneMatch = text.match(/(\+?62|0)\d{8,13}/);
  
  if (phoneMatch) {
    // Ada nomor HP di pesan
    customerPhone = phoneMatch[0].replace(/^0/, '62').replace(/^\+/, '');
    // Nama = sisa text setelah buang nomor dan pembersihan
    const nameCandidate = text.replace(phoneMatch[0], '').replace(/[,.\-:;]/g, '').trim();
    if (nameCandidate.length >= 2) {
      customerName = nameCandidate;
    }
  } else {
    // Tidak ada nomor HP — mungkin ini nama saja
    const cleanText = text.replace(/[,.\-:;]/g, '').trim();
    if (cleanText.length >= 2 && !/^\d+$/.test(cleanText)) {
      customerName = cleanText;
    }
  }
  
  // Jika baru dapat nama tapi belum HP (atau sebaliknya)
  if (customerName && !customerPhone) {
    await upsertSession(from, ST.NAME_PHONE, { customerName });
    return sender.sendText(from, `Terima kasih Kak *${customerName}*! 😊\n\nBoleh tau *nomor HP/WA* Kakak? 📱`);
  }
  
  if (!customerName && customerPhone) {
    await upsertSession(from, ST.NAME_PHONE, { customerPhone });
    return sender.sendText(from, `✅ Nomor HP tercatat!\n\nBoleh tau *atas nama siapa* ya Kak? 👤`);
  }
  
  if (!customerName && !customerPhone) {
    return sender.sendText(from, `Mohon maaf Kak, bisa kasih tau:\n👤 *Nama* dan 📱 *Nomor HP/WA* Kakak?\n\n_Contoh: Andi, 081234567890_`);
  }
  
  // Sudah lengkap! Simpan ke database customers
  await db.upsertCustomer(customerPhone, customerName);
  
  // Lanjut ke region check
  await upsertSession(from, ST.REGION_CHECK, { customerName, customerPhone });
  
  return sender.sendText(from, 
    `Terima kasih Kak *${customerName}*! 😊\n\n` +
    `Kakak berada di daerah mana ya?\n\n` +
    `1️⃣ *Jakarta* (pesan via bot)\n` +
    `2️⃣ *Luar Jakarta* (pesan via Shopee)\n\n` +
    `_Balas dengan angka atau ketik daerahnya ya Kak_ 🙏`
  );
}

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return '🌅 Selamat Pagi!';
  if (hour >= 11 && hour < 15) return '☀️ Selamat Siang!';
  if (hour >= 15 && hour < 18) return '🌇 Selamat Sore!';
  return '🌙 Selamat Malam!';
}

async function handleRegionJakarta(from, name) {
  const session = await getSession(from);
  await upsertSession(from, ST.CATALOG, session?.data || {});
  
  // Kirim pesan teks dulu
  await sender.sendText(from, 
    `🎉 *Siap Kak, pesanan Jakarta bisa kami antar!*\n\n` +
    `📦 Semua pesanan bersifat *Pre-Order (PO)*\n` +
    `🚚 Pengiriman *H+1* setelah pembayaran dikonfirmasi\n` +
    `💳 Pembayaran via *Transfer BCA*\n\n` +
    `Berikut menu lengkap kami 👇`
  );
  
  // Kirim gambar menu (2 halaman)
  await sendMenuImages(from, name);

  // Delay sedikit lalu kirim instruksi
  await new Promise(r => setTimeout(r, 1500));
  
  return sender.sendText(from,
    `📝 *Cara Pesan:*\n\n` +
    `Ketik saja nama kue & jumlahnya!\n\n` +
    `Contoh:\n` +
    `• _"Nastar Classic 2"_\n` +
    `• _"Bolen Coklat Keju 1, Stick Choco 2"_\n` +
    `• _"Brownies 1 sama Marmer Cake 1"_`
  );
}

async function handleRegionLuar(from, name) {
  // Set state REJECTED agar bot terus menolak jika customer ngeyel
  await upsertSession(from, ST.REJECTED);
  
  const session = await getSession(from);
  const customerName = session?.data?.customerName || name;
  const shopeeUrl = config.shopeeUrl || 'https://shopee.co.id/yoyobakery';
  
  const msg = `📦 *Terima kasih Kak ${customerName}!*\n\n` +
    `Mohon maaf, pemesanan via WhatsApp hanya untuk area *Jakarta* ya Kak. 🙏\n\n` +
    `Untuk luar Jakarta, Kakak bisa pesan melalui Shopee kami:\n\n` +
    `🛒 *${shopeeUrl}*\n\n` +
    `Di Shopee sudah termasuk ongkir pengiriman ke seluruh Indonesia. 📮\n\n` +
    `Terima kasih sudah menghubungi Yoyo Bakery! 🍞😊`;

  return sender.sendText(from, msg);
}

// ============================================================
// MENU IMAGES
// ============================================================

async function sendMenuImages(from, name) {
  try {
    if (fs.existsSync(MENU_PAGE1)) {
      const img1 = fs.readFileSync(MENU_PAGE1);
      await sender.sendImage(from, img1, '🍪 *Kue Kering* — Yoyo Bakery');
    }
    
    await new Promise(r => setTimeout(r, 1000)); // Delay antar gambar
    
    if (fs.existsSync(MENU_PAGE2)) {
      const img2 = fs.readFileSync(MENU_PAGE2);
      await sender.sendImage(from, img2, '🥐 *Roti & Pastry | Cake & Dessert* — Yoyo Bakery');
    }
  } catch (err) {
    logger.error({ err }, '❌ Gagal mengirim gambar menu');
    // Fallback ke menu teks jika gambar gagal
    return await sendMenuText(from, name);
  }
}

async function sendMenuText(from, name) {
  const products = await db.getProducts();
  
  // Group by category
  const categories = {};
  products.forEach(p => {
    const cat = p.category || 'Lainnya';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(p);
  });

  let menu = `📋 *Menu Yoyo Bakery*\n`;
  
  const categoryEmojis = {
    'Kue Kering': '🍪',
    'Roti & Pastry': '🥐', 
    'Cake & Dessert': '🎂',
    'default': '🔸'
  };

  for (const [cat, items] of Object.entries(categories)) {
    const emoji = categoryEmojis[cat] || categoryEmojis['default'];
    menu += `\n━━━━━━━━━━━━━━━━━━━\n`;
    menu += `${emoji} *${cat.toUpperCase()}*\n`;
    menu += `━━━━━━━━━━━━━━━━━━━\n`;
    
    items.forEach(p => {
      menu += `🔸 ${p.name} — *Rp ${p.price.toLocaleString('id-ID')}*\n`;
    });
  }
  
  menu += `\n━━━━━━━━━━━━━━━━━━━\n`;
  menu += `📦 Semua pesanan *PRE-ORDER*\n`;
  menu += `🚚 Pengiriman *H+1* setelah bayar\n`;
  menu += `━━━━━━━━━━━━━━━━━━━`;

  return sender.sendText(from, menu);
}

// ============================================================
// ORDER HANDLING
// ============================================================

async function handleOrderInput(from, name, text, aiItems = null, aiName = null, aiNotes = null) {
  const session = await getSession(from);
  let existingItems = (session && session.data && session.data.items) ? session.data.items : [];
  let ambiguousPending = (session && session.data && session.data.ambiguousPending) ? session.data.ambiguousPending : [];
  
  let newItems = aiItems;
  let finalName = aiName || (session && session.data && session.data.customerName) || name;
  let finalNotes = aiNotes || (session && session.data && session.data.notes) || '';
  
  if (!newItems || newItems.length === 0) {
    logger.info({ text }, '🧠 Mencoba parse ulang pesanan via AI...');
    const aiData = await aiParseOrder(text);
    logger.info({ aiData }, '📋 Hasil Parse AI');
    
    newItems = aiData?.items;
    if (aiData?.customerName) finalName = aiData.customerName;
    if (aiData?.notes) finalNotes = aiData.notes;
  }

  // Jika tetap tidak ada roti yang ditemukan
  if (!newItems || newItems.length === 0) {
    // Jika user memang hanya kirim teks biasa tanpa niat pesan, diam saja atau minta ulang
    if (existingItems.length > 0) return sender.sendText(from, 'Maaf Kak, saya tidak paham tambahan pesanannya. Bisa diulang? (Contoh: "Tambah Nastar 1")');
    return sender.sendText(from, 'Maaf Kak, saya tidak menemukan nama roti dalam pesan Kakak. Bisa diulang? (Contoh: "Pesan Nastar 2")');
  }

  // Ambil harga asli dari DB
  const products = await db.getProducts();
  const ambiguousItems = [];
  
  // Gabungkan item baru ke existingItems
  newItems.forEach(newItem => {
    // Cek apakah item ini menyelesaikan ambiguitas sebelumnya
    const pendingIndex = ambiguousPending.findIndex(ap => 
      (ap.matches && ap.matches.some(m => m.toLowerCase().includes(newItem.name.toLowerCase()))) ||
      ap.original.toLowerCase() === newItem.name.toLowerCase()
    );

    if (pendingIndex !== -1) {
      const pendingQty = ambiguousPending[pendingIndex].qty;
      // Jika AI tidak mendeteksi jumlah (null) atau menganggap 1, pakai jumlah dari memori
      if ((newItem.qty === null || newItem.qty === 1 || !newItem.qty) && pendingQty) {
        newItem.qty = pendingQty;
      }
      ambiguousPending.splice(pendingIndex, 1);
    }

    // 1. Cek Exact Match
    let p = products.find(prod => prod.name.toLowerCase() === newItem.name.toLowerCase());
    
    // 2. Jika tidak ada exact match, cek apakah ini nama umum (Ambiguitas)
    if (!p) {
      const matches = products.filter(prod => prod.name.toLowerCase().includes(newItem.name.toLowerCase()));
      if (matches.length > 1) {
        // Ambiguitas ditemukan! (Misal sebut "Bolen", ada "Bolen Coklat" & "Bolen Keju")
        ambiguousItems.push({ original: newItem.name, matches: matches.map(m => m.name), qty: newItem.qty });
        return;
      } else if (matches.length === 1) {
        // Jika cuma ketemu 1 yang mirip, kita anggap itu barangnya
        p = matches[0];
      }
    }

    if (p) {
      const action = newItem.action || 'add';
      const existingIndex = existingItems.findIndex(e => e.name.toLowerCase() === p.name.toLowerCase());

      // --- LOGIKA HAPUS BARANG ---
      if (action === 'remove') {
        if (existingIndex !== -1) {
          existingItems.splice(existingIndex, 1);
        }
        return;
      }

      // --- LOGIKA CEK JUMLAH KOSONG ---
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

  // Handle ambiguous items or missing quantities
  if (ambiguousItems.length > 0) {
    let msg = '🤔 Maaf Kak, ada yang perlu diperjelas:\n\n';
    ambiguousItems.forEach(item => {
      if (item.type === 'missing_qty') {
        msg += `❓ *"${item.original}"* — Mau dipesan berapa banyak ya Kak?\n`;
      } else if (item.matches && item.matches.length > 0) {
        // Jika jumlah sudah ada, jangan ditanya lagi
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

  // Filter zero qty
  existingItems = existingItems.filter(i => i.qty > 0);

  if (existingItems.length === 0) {
    return sender.sendText(from, 'Maaf Kak, pesanannya kosong. Silakan ketik nama roti & jumlahnya ya.');
  }

  // Simpan ke session (termasuk customerPhone dari registrasi awal)
  const prevSession = await getSession(from);
  await upsertSession(from, ST.LOCATION, { 
    items: existingItems, 
    customerName: finalName,
    customerPhone: prevSession?.data?.customerPhone || null,
    notes: finalNotes
  });

  // Kirim ringkasan
  const { buildOrderSummary } = require('./orderParser');
  const { text: summary } = buildOrderSummary(existingItems, undefined, finalNotes);

  const locationMsg = `📍 Silakan kirim *Lokasi/Shareloc* Kakak untuk hitung ongkir ya!\n_(Klik 📎 → Lokasi)_`;

  // SUSUN PESAN (PASTIKAN NOTES ADA)
  let msg = `✅ *Pesanan Kakak:*\n\n${summary}\n\n`;
  
  if (finalNotes && finalNotes.trim() !== '') {
    msg += `📝 *Catatan Khusus:* ${finalNotes}\n\n`;
  }
  
  msg += `🚚 Ongkir dihitung setelah kirim lokasi\n` +
    `📦 _Pesanan bersifat PO, dikirim *besok* setelah pembayaran dikonfirmasi._\n\n` +
    `${locationMsg}\n\n` +
    `*Ketik:* _Batal_ (untuk hapus) / _Tambah [Nama Kue]_ & jumlahnya.\n` +
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

  const q = await lalamove.getQuotation(lat, lng);
  if (!q) return sender.sendText(from, '⚠️ Gagal menghitung ongkir. Coba kirim ulang lokasi ya Kak.');

  const { buildOrderSummary } = require('./orderParser');
  const dist = (q.distance.value / 1000).toFixed(1);
  const fee = parseFloat(q.total); 
  
  // OUT OF BOUNDS LIMIT (Max Rp 50.000)
  if (fee > 50000) {
    return sender.sendText(from, `⚠️ Maaf Kak, ongkir ke lokasi tersebut terlalu mahal (Rp ${fee.toLocaleString('id-ID')}). Sepertinya lokasi Kakak di luar jangkauan pengiriman kami.\n\nPemesanan via WA hanya untuk area *Jakarta* ya Kak. Untuk luar Jakarta, silakan pesan via Shopee: ${config.shopeeUrl || 'https://shopee.co.id/'}`);
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

async function finalizeOrder(from, data) {
  // Gunakan nomor HP yang diketik pelanggan jika ada (terutama untuk user LID)
  const finalWaNumber = data.customerPhone || from;

  const { data: newOrder, error } = await db.supabase.from('orders').insert([{
    wa_number: finalWaNumber,
    customer_name: data.customerName || 'Pelanggan',
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

  // Gunakan order_number dari database (1, 2, 3...)
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

  if (imageBuffer) {
    await sender.sendImage(config.adminPhone, imageBuffer, adminMsg);
  } else {
    await sender.sendText(config.adminPhone, adminMsg + '\n\n⚠️ (Gagal mengunduh gambar bukti)');
  }

  await db.updateOrder(orderId, { payment_status: 'reviewing' });
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
