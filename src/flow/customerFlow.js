const logger = require('../utils/logger');
const sender = require('../whatsapp/sender');
const db = require('../database/supabase');
const { aiParseOrder } = require('./aiParser');
const { getSession, upsertSession, deleteSession } = require('../database/supabase');
const config = require('../config');
const lalamove = require('../lalamove/client');
const path = require('path');
const fs = require('fs');
const { buildOrderSummary, parseOrderTemplate } = require('./orderParser');
const { geocodeAddress } = require('../utils/geocoder');

// Order States
const ST = {
  IDLE: 'IDLE',
  REGION_SELECT: 'REGION_SELECT',
  WAITING_ORDER: 'WAITING_ORDER', // Unified order collection state
  PAYMENT: 'PAYMENT',
  REJECTED: 'REJECTED',
  ADMIN_TAKEOVER: 'ADMIN_TAKEOVER',
  RETURNING_CUSTOMER: 'RETURNING_CUSTOMER'
};

const PICKUP_KEYWORDS = [
  'ambil sendiri', 'pickup', 'ambil ke toko', 'ke sana', 'kesana', 
  'ambil langsung', 'ambil di tempat', 'ambil ditempat', 'ambil di toko', 'ambil ditoko'
];

// Menu images
const MENU_PAGE1 = path.join(__dirname, '..', 'assets', 'menu-page1.jpg');
const MENU_PAGE2 = path.join(__dirname, '..', 'assets', 'menu-page2.jpg');

const ALIASES = {
  'nonis': 'nona manis',
  'bolcok': 'bolen coklat',
  'bolju': 'bolen keju',
  'boljug': 'bolen keju',
  'ns': 'nastar',
  'ks': 'kastengel'
};

function fuzzyMatchProduct(inputName, products) {
  let inputLower = inputName.toLowerCase().trim();
  
  if (ALIASES[inputLower]) {
    inputLower = ALIASES[inputLower];
  } else {
    Object.keys(ALIASES).forEach(alias => {
      const regex = new RegExp(`\\b${alias}\\b`, 'g');
      inputLower = inputLower.replace(regex, ALIASES[alias]);
    });
  }

  let p = products.find(prod => prod.name.toLowerCase() === inputLower);
  if (p) return { match: p, ambiguous: null };

  const inputWords = inputLower.split(/\s+/).filter(w => w.length > 2);
  if (inputWords.length > 0) {
    let wordMatches = products.filter(prod => {
      const prodName = prod.name.toLowerCase();
      return inputWords.every(w => prodName.includes(w));
    });
    
    if (wordMatches.length === 1) return { match: wordMatches[0], ambiguous: null };
    if (wordMatches.length > 1) return { match: null, ambiguous: wordMatches.map(m => m.name) };
    
    let partialMatches = products.filter(prod => {
      const prodName = prod.name.toLowerCase();
      return inputWords.some(w => prodName.includes(w));
    });
    
    if (partialMatches.length === 1) return { match: partialMatches[0], ambiguous: null };
    if (partialMatches.length > 1) {
      partialMatches.sort((a, b) => {
        const aCount = inputWords.filter(w => a.name.toLowerCase().includes(w)).length;
        const bCount = inputWords.filter(w => b.name.toLowerCase().includes(w)).length;
        return bCount - aCount;
      });
      return { match: null, ambiguous: partialMatches.slice(0, 4).map(m => m.name) };
    }
  }

  let matches = products.filter(prod => prod.name.toLowerCase().includes(inputLower));
  if (matches.length === 1) return { match: matches[0], ambiguous: null };
  if (matches.length > 1) return { match: null, ambiguous: matches.map(m => m.name) };

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

async function sendMenuImages(from, captionText = '') {
  try {
    const page2 = fs.readFileSync(MENU_PAGE2);
    await sender.sendImage(from, page2, captionText);
  } catch (err) {
    logger.error('Gagal mengirim menu gambar', err);
    if (captionText) await sender.sendText(from, captionText);
  }
}

function checkCompleteness(data) {
  if (!data.items || data.items.length === 0) return false;
  if (!data.customerName || data.customerName.trim().length === 0) return false;
  if (!data.customerPhone || data.customerPhone.trim().length === 0) return false;
  if (!data.deliveryMethod) return false;
  
  if ((data.deliveryMethod || '').toLowerCase() === 'kirim') {
    if (!data.customerAddress || data.customerAddress.trim().length === 0) return false;
  }
  
  if (data.ambiguousPending && data.ambiguousPending.length > 0) return false;
  
  return true;
}

async function askMissingInfo(from, data) {
  const hasItems = data.items && data.items.length > 0;
  const hasName = data.customerName && data.customerName.trim().length > 0;
  const hasPhone = data.customerPhone && data.customerPhone.trim().length > 0;
  const hasMethod = data.deliveryMethod !== null && data.deliveryMethod !== undefined;
  const hasAddress = data.customerAddress && data.customerAddress.trim().length > 0;
  const hasAmbiguous = data.ambiguousPending && data.ambiguousPending.length > 0;

  if (hasAmbiguous) {
    let msg = '🤔 Maaf Kak, ada pesanan yang perlu diperjelas:\n\n';
    data.ambiguousPending.forEach(item => {
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
  }

  if (!hasItems) {
    return sender.sendText(from, '📝 Silakan ketik nama kue & jumlahnya ya Kak.');
  }

  if (!hasMethod) {
    return sender.sendText(from, '🚚 Pesanannya mau dikirim atau diambil di toko (pickup) Kak?');
  }

  const dm = (data.deliveryMethod || '').toLowerCase();
  if (dm === 'kirim' && !hasAddress) {
    return sender.sendText(from, '📍 Silakan kirim alamat lengkap pengiriman Kakak, ATAU kirim Lokasi/Shareloc WhatsApp ya Kak.');
  }

  if (!hasName || !hasPhone) {
    return sender.sendText(from, '👤 Boleh minta nama & nomor HP penerima?\n\n_Contoh: Budi, 081234567890_');
  }

  return sender.sendText(from, '⚠️ Ada informasi pesanan yang belum lengkap Kak. Mohon lengkapi detail pesanan Kakak.');
}

function getDisplayPhone(waNumber, notes) {
  if (!waNumber) return '';
  if (waNumber.endsWith('@lid') || waNumber.replace(/\D/g, '').length > 13) {
    if (notes) {
      const match = notes.match(/\(HP:\s*([\+\d]+)\)/i);
      if (match) {
        return match[1].replace(/[\s-]/g, '');
      }
    }
    return '';
  }
  return waNumber.split('@')[0];
}

async function buildAndSendTemplate(from, data) {
  let prefName = data.customerName || '';
  let prefPhone = data.customerPhone || '';
  
  // If the stored phone is actually an internal JID/LID, try to resolve it first
  if (prefPhone && (prefPhone.endsWith('@lid') || prefPhone.replace(/\D/g, '').length > 13)) {
    prefPhone = getDisplayPhone(prefPhone, data.notes || '');
  }
  
  if (!prefName || !prefPhone) {
    const lastOrder = await db.getLastOrder(from, data.customerPhone);
    if (lastOrder) {
      prefName = prefName || lastOrder.customer_name || '';
      prefPhone = prefPhone || getDisplayPhone(lastOrder.wa_number, lastOrder.notes) || '';
    }
  }
  
  if (prefPhone && prefPhone.includes('@')) {
    prefPhone = prefPhone.split('@')[0];
  }

  let prefItems = '';
  if (data.items && data.items.length > 0) {
    prefItems = data.items.map(item => `${item.name} ${item.qty}`).join(', ');
  } else {
    prefItems = '(contoh: Nastar Classic 2, Bolen Coklat 1)';
  }

  const deliveryText = data.deliveryMethod === 'pickup' ? 'Ambil di Toko' : 
                       (data.deliveryMethod === 'kirim' ? 'Kirim' : 'Kirim / Ambil di Toko');

  const addressText = data.customerAddress || 
                      (data.deliveryMethod === 'pickup' ? '' : '(mohon diisi jika pilih kirim, kosongkan bila ambil di toko)');

  const templateMsg = `📋 *FORMAT PESANAN YOYO BAKERY*\n` +
    `_(Salin & isi, lalu kirim kembali ya Kak)_\n\n` +
    `Nama: ${prefName}\n` +
    `Pesanan: ${prefItems}\n` +
    `Pengiriman: ${deliveryText}\n` +
    `Alamat: ${addressText}\n` +
    `No HP: ${prefPhone}\n` +
    `Catatan: (opsional)`;
    
  await sendMenuImages(from, 'Berikut Menu Terfavorit Kami! 👇');
  await sender.sendText(from, templateMsg);
  
  data.menuSent = true;
  data.customerName = prefName || data.customerName;
  data.customerPhone = prefPhone || data.customerPhone;
  await upsertSession(from, ST.WAITING_ORDER, data);
}

async function autoFinalizeOrder(from, name, data) {
  let fee = 0;
  let lat = data.customerLat;
  let lng = data.customerLng;
  let addr = data.customerAddress;
  let quotationId = data.quotationId;

  if ((data.deliveryMethod || '').toLowerCase() === 'kirim') {
    if (!lat || !lng) {
      logger.info(`📍 Geocoding alamat: ${addr}...`);
      const geo = await geocodeAddress(addr);
      if (!geo) {
        return sender.sendText(from, `📍 *Sistem gagal memetakan alamat Kakak:*\n_${addr}_\n\nBoleh bantu ketik ulang *alamat lengkap* Kakak secara jelas, atau kirimkan *Lokasi/Shareloc* WhatsApp? 🙏`);
      }
      lat = geo.lat;
      lng = geo.lng;
      addr = geo.formattedAddress;
      data.customerLat = lat;
      data.customerLng = lng;
      data.customerAddress = addr;
    }

    logger.info(`🚚 Mendapatkan quotation Lalamove ke: ${lat}, ${lng}...`);
    const q = await lalamove.getQuotation(lat, lng);
    if (!q) {
      return sender.sendText(from, `⚠️ Gagal menghitung ongkir Lalamove ke lokasi tersebut. Silakan ketik ulang alamat atau kirim Shareloc Kakak ya. 🙏`);
    }

    fee = calculateDeliveryFee(q);
    quotationId = q.quotationId;
    
    if (fee > 80000) {
      await upsertSession(from, ST.REJECTED, data);
      const shopeeUrl = config.shopeeUrl || 'https://shopee.co.id/yoyobakery';
      return sender.sendText(from, `⚠️ Maaf Kak, ongkir ke lokasi tersebut terlalu mahal (Rp ${fee.toLocaleString('id-ID')}). Sepertinya lokasi Kakak di luar jangkauan pengiriman kami.\n\nPemesanan via WA hanya untuk area *Jakarta* ya Kak. Untuk luar Jakarta, silakan pesan via Shopee:\n🛒 *${shopeeUrl}*`);
    }
  }

  const { text: summary, itemsTotal } = buildOrderSummary(data.items, fee, data.notes);
  const finalTotal = itemsTotal + fee;

  data.deliveryFee = fee;
  data.totalPrice = finalTotal;
  data.quotationId = quotationId;

  let finalNotes = data.notes || '';
  if (from.endsWith('@lid') && data.customerPhone) {
    if (!finalNotes.includes(`(HP: ${data.customerPhone})`)) {
      finalNotes = finalNotes ? `${finalNotes} (HP: ${data.customerPhone})` : `(HP: ${data.customerPhone})`;
    }
  }

  let newOrder;
  let error;

  const orderData = {
    wa_number: from,
    customer_name: data.customerName || name || 'Pelanggan',
    items: data.items,
    total_price: finalTotal,
    delivery_fee: fee,
    customer_lat: lat || null,
    customer_lng: lng || null,
    customer_address: addr || null,
    lalamove_quotation_id: quotationId || null,
    notes: finalNotes,
    payment_status: 'pending',
    order_status: 'waiting_payment',
    updated_at: new Date().toISOString()
  };

  if (data.orderId) {
    logger.info(`📝 Mengupdate pesanan lama #${data.orderNumber} (ID: ${data.orderId})...`);
    const res = await db.supabase.from('orders')
      .update(orderData)
      .eq('id', data.orderId)
      .select()
      .single();
    newOrder = res.data;
    error = res.error;
  } else {
    logger.info('📝 Menyimpan pesanan baru ke Supabase...');
    const res = await db.supabase.from('orders')
      .insert([orderData])
      .select()
      .single();
    newOrder = res.data;
    error = res.error;
  }

  if (error) {
    logger.error({ error: error.message, data }, '❌ Gagal menyimpan pesanan ke Supabase');
    return sender.sendText(from, '⚠️ Gagal membuat pesanan Kak. Coba lagi nanti ya.');
  }

  const orderNumber = newOrder.order_number;
  
  await upsertSession(from, ST.PAYMENT, { 
    ...data, 
    orderId: newOrder.id, 
    orderNumber: orderNumber,
    totalPrice: finalTotal,
    deliveryFee: fee,
    customerLat: lat,
    customerLng: lng,
    customerAddress: addr,
    quotationId: quotationId,
    notes: finalNotes
  });

  if (data.customerPhone) {
    await db.upsertCustomer(data.customerPhone, data.customerName);
  }

  const totalPriceStr = finalTotal.toLocaleString('id-ID');
  
  let msg = `✅ *Pesanan #${orderNumber} Diterima!*\n\n` +
    `${summary}\n\n`;
    
  if (data.deliveryMethod === 'kirim') {
    msg += `📍 Alamat: ${addr}\n\n`;
  } else {
    msg += `📍 Pengambilan: Ambil Sendiri di Toko\n\n`;
  }
    
  msg += `💳 *Transfer ke:*\n` +
    `🏦 BCA\n` +
    `👤 ${config.payment.bcaName}\n` +
    `💳 ${config.payment.bcaNumber}\n\n` +
    `📦 _Pesanan PO — akan dikirim *besok* setelah pembayaran dikonfirmasi admin._\n\n` +
    `⏰ _Batas pembayaran: *2 hari*. Setelah itu pesanan otomatis batal._\n\n` +
    `Silakan kirim *FOTO BUKTI TRANSFER* di sini ya Kak. 🙏\n\n` +
    `_(Ketik *Batal* jika ingin membatalkan, atau ketik *Ubah* jika ingin mengedit pesanan)_`;

  return sender.sendText(from, msg);
}

async function processWaitingOrder(from, name, text, session, aiData, templateData, message) {
  let data = (session && session.data) ? session.data : {};
  let updated = false;

  if (!data.items) data.items = [];
  if (!data.ambiguousPending) data.ambiguousPending = [];

  // Resolve ambiguous items first
  let resolvedAny = false;
  if (data.ambiguousPending.length > 0 && text.trim().length > 0 && !templateData?.isTemplate) {
    const products = await db.getProducts();
    const resolvedIndices = [];
    
    for (let i = 0; i < data.ambiguousPending.length; i++) {
      const pending = data.ambiguousPending[i];
      const isNumberMatch = /^\d+$/.test(text.trim());
      let isTextMatch = false;
      
      if (!isNumberMatch) {
        isTextMatch = pending.matches.some(m => text.toLowerCase().includes(m.toLowerCase()) || m.toLowerCase().includes(text.toLowerCase())) 
                      || text.toLowerCase().includes(pending.original.toLowerCase())
                      || pending.original.toLowerCase().includes(text.toLowerCase());
      }
      
      if (isNumberMatch || isTextMatch) {
        let matchName = text.trim();
        if (isNumberMatch) {
          const selectionIdx = parseInt(text.trim()) - 1;
          if (selectionIdx >= 0 && selectionIdx < pending.matches.length) {
            matchName = pending.matches[selectionIdx];
          } else {
            continue;
          }
        }
        
        const matchResult = fuzzyMatchProduct(matchName, products);
        if (matchResult.match) {
          const existingIdx = data.items.findIndex(e => e.name.toLowerCase() === matchResult.match.name.toLowerCase());
          if (existingIdx !== -1) {
            data.items[existingIdx].qty += pending.qty || 1;
          } else {
            data.items.push({ name: matchResult.match.name, qty: pending.qty || 1, price: matchResult.match.price });
          }
          resolvedIndices.push(i);
          resolvedAny = true;
          updated = true;
        }
      }
    }
    
    if (resolvedAny) {
      resolvedIndices.sort((a, b) => b - a).forEach(idx => {
        data.ambiguousPending.splice(idx, 1);
      });
      
      data.items = data.items.filter(i => i.qty > 0);
      await upsertSession(from, ST.WAITING_ORDER, data);
      
      const isComplete = checkCompleteness(data);
      if (isComplete) {
        return await autoFinalizeOrder(from, name, data);
      } else {
        return await askMissingInfo(from, data);
      }
    }
  }

  if (message && message.type === 'location') {
    const lat = message.location.latitude;
    const lng = message.location.longitude;
    const addr = message.location.name || `${lat},${lng}`;
    
    if (lat && lng && !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
      data.customerLat = lat;
      data.customerLng = lng;
      data.customerAddress = addr;
      data.deliveryMethod = 'kirim';
      updated = true;
    } else {
      return sender.sendText(from, '⚠️ Lokasi yang dikirim tidak valid Kak. Coba kirim ulang.');
    }
  } 
  else if (templateData && templateData.isTemplate) {
    logger.info('📝 Mengolah format template...');
    
    if (templateData.customerName) {
      data.customerName = templateData.customerName;
      updated = true;
    }
    
    if (templateData.phone) {
      let phone = templateData.phone.replace(/[\s-]/g, '').replace(/^0/, '62').replace(/^\+/, '');
      data.customerPhone = phone;
      updated = true;
    }
    
    if (templateData.address) {
      data.customerAddress = templateData.address;
      updated = true;
    }
    
    if (templateData.notes) {
      data.notes = templateData.notes;
      updated = true;
    }
    
    if (templateData.deliveryMethod) {
      data.deliveryMethod = templateData.deliveryMethod;
      data.isPickup = templateData.deliveryMethod === 'pickup';
      if (data.isPickup) {
        data.deliveryFee = 0;
      }
      updated = true;
    }

    if (templateData.items) {
      const products = await db.getProducts();
      const rawItems = templateData.items.split(/[\n,]+/).map(i => i.trim()).filter(i => i.length > 0);
      
      const newItems = [];
      const newAmbiguous = [];
      
      for (const rawItem of rawItems) {
        const itemMatch = rawItem.match(/^(.+?)\s*[xX×]\s*(\d+)\s*$/);
        const itemMatch2 = rawItem.match(/^(.+?)\s+(\d+)\s*$/);
        const itemMatch3 = rawItem.match(/^(\d+)\s*[xX×]?\s*(.+)$/);
        
        let itemName = rawItem;
        let qty = 1;
        
        if (itemMatch) {
          itemName = itemMatch[1].trim();
          qty = parseInt(itemMatch[2]);
        } else if (itemMatch3) {
          qty = parseInt(itemMatch3[1]);
          itemName = itemMatch3[2].trim();
        } else if (itemMatch2) {
          itemName = itemMatch2[1].trim();
          qty = parseInt(itemMatch2[2]);
        }
        
        const matchResult = fuzzyMatchProduct(itemName, products);
        if (matchResult.ambiguous) {
          newAmbiguous.push({ original: itemName, matches: matchResult.ambiguous, qty });
        } else if (matchResult.match) {
          newItems.push({ name: matchResult.match.name, qty, price: matchResult.match.price });
        } else {
          newAmbiguous.push({ original: itemName, matches: [], qty });
        }
      }
      
      if (newItems.length > 0 || newAmbiguous.length > 0) {
        data.items = newItems;
        data.ambiguousPending = newAmbiguous;
        updated = true;
      }
    }
  } 
  else if (aiData) {
    logger.info('🧠 Mengolah pesan free-form via AI...');
    
    if (aiData.customerName) {
      data.customerName = aiData.customerName;
      updated = true;
    }
    
    if (aiData.customerPhone) {
      let phone = aiData.customerPhone.replace(/[\s-]/g, '').replace(/^0/, '62').replace(/^\+/, '');
      data.customerPhone = phone;
      updated = true;
    }
    
    if (aiData.address) {
      data.customerAddress = aiData.address;
      updated = true;
    }
    
    if (aiData.notes) {
      data.notes = aiData.notes;
      updated = true;
    }
    
    if (aiData.deliveryMethod) {
      data.deliveryMethod = aiData.deliveryMethod;
      data.isPickup = aiData.deliveryMethod === 'pickup';
      if (data.isPickup) {
        data.deliveryFee = 0;
      }
      updated = true;
    }

    if (aiData.intent === 'ORDER' && aiData.items && aiData.items.length > 0) {
      const products = await db.getProducts();
      
      const shouldReplace = aiData.items.some(i => i.action === 'replace_cart');
      if (shouldReplace) {
        data.items = [];
        data.ambiguousPending = [];
        updated = true;
      }

      aiData.items.forEach(newItem => {
        let action = newItem.action || 'add';
        if (action === 'replace_cart') action = 'add';
        
        if (action === 'remove') {
          const idx = data.items.findIndex(e => e.name.toLowerCase().includes(newItem.name.toLowerCase()));
          if (idx !== -1) {
            data.items.splice(idx, 1);
            updated = true;
          }
          return;
        }
        
        const matchResult = fuzzyMatchProduct(newItem.name, products);
        if (matchResult.ambiguous) {
          data.ambiguousPending.push({ original: newItem.name, matches: matchResult.ambiguous, qty: newItem.qty });
          updated = true;
        } else if (matchResult.match) {
          // Clear matching ambiguous pending items
          if (data.ambiguousPending && data.ambiguousPending.length > 0) {
            const resolvedIndices = [];
            for (let i = 0; i < data.ambiguousPending.length; i++) {
              const pending = data.ambiguousPending[i];
              if (pending.matches && pending.matches.some(m => m.toLowerCase() === matchResult.match.name.toLowerCase())) {
                resolvedIndices.push(i);
              }
            }
            resolvedIndices.sort((a, b) => b - a).forEach(idx => {
              data.ambiguousPending.splice(idx, 1);
            });
          }

          const existingIdx = data.items.findIndex(e => e.name.toLowerCase() === matchResult.match.name.toLowerCase());
          
          if (action === 'update' && existingIdx !== -1) {
            data.items[existingIdx].qty = newItem.qty || 1;
          } else if (existingIdx !== -1) {
            data.items[existingIdx].qty += newItem.qty || 1;
          } else {
            data.items.push({ name: matchResult.match.name, qty: newItem.qty || 1, price: matchResult.match.price });
          }
          updated = true;
        } else {
          data.ambiguousPending.push({ original: newItem.name, matches: [], qty: newItem.qty || 1 });
          updated = true;
        }
      });
    }
  }

  // Fallback name/phone extraction
  if ((!data.customerName || !data.customerPhone) && text.length > 5) {
    const phoneRegex = /(\+?62|0)([\s-]*\d){8,14}/;
    const phoneMatch = text.match(phoneRegex);
    if (phoneMatch) {
      const cPhone = phoneMatch[0].replace(/[\s-]/g, '').replace(/^0/, '62').replace(/^\+/, '');
      let nameCandidate = text.replace(phoneMatch[0], '')
                                .replace(/no\s*hp|hp|nomor|whatsapp|wa|atas\s*nama|nama/gi, '')
                                .replace(/[,.\-:;]/g, '')
                                .trim();
      nameCandidate = nameCandidate.split('\n')[0].trim();
      if (nameCandidate.length > 30) nameCandidate = nameCandidate.substring(0, 30);
      
      data.customerPhone = cPhone;
      if (nameCandidate.length >= 2 && !/^\d+$/.test(nameCandidate)) {
        data.customerName = nameCandidate;
      }
      updated = true;
    }
  }



  if (updated) {
    // Merge duplicate items by name
    const merged = [];
    data.items.forEach(item => {
      const existing = merged.find(m => m.name.toLowerCase() === item.name.toLowerCase());
      if (existing) {
        existing.qty += item.qty;
      } else {
        merged.push({ ...item });
      }
    });
    data.items = merged.filter(i => i.qty > 0);
    await upsertSession(from, ST.WAITING_ORDER, data);
  }

  const isComplete = checkCompleteness(data);
  if (isComplete) {
    return await autoFinalizeOrder(from, name, data);
  } else {
    return await askMissingInfo(from, data);
  }
}

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
  
  if (fee > 80000) {
    return sender.sendText(from, `⚠️ Ongkir ke lokasi tersebut cukup mahal (Estimasi Rp ${fee.toLocaleString('id-ID')}).\nPemesanan instan via WA hanya untuk area Jakarta ya Kak. Untuk luar Jakarta, silakan pesan via Shopee:\n🛒 ${config.shopeeUrl || 'https://shopee.co.id/'}`);
  }

  let reply = `📍 *Estimasi Ongkir Lalamove*\nKe: ${addr}\nBiaya: *Rp ${fee.toLocaleString('id-ID')}*\n\n_(Ongkir ini sudah disesuaikan dengan tarif sore/peak hour Lalamove)_`;

  if (state === ST.REGION_SELECT) {
    reply += `\n\n🌍 _Silakan lanjutkan dengan memilih wilayah Kakak._`;
  } else if (state === ST.WAITING_ORDER) {
    reply += `\n\n📝 _Silakan ketik/lengkapi pesanan Kakak ya._`;
  }

  return sender.sendText(from, reply);
}

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

async function handleCustomerMessage(from, name, message) {
  const session = await getSession(from);
  let state = session ? session.state : ST.IDLE;
  const text = message.text?.body || '';

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

  if (state === ST.ADMIN_TAKEOVER) {
    const t = text.toLowerCase().trim();
    const lastUpdate = session.updated_at ? new Date(session.updated_at).getTime() : Date.now();
    const isTimeout = (Date.now() - lastUpdate) > 60 * 60 * 1000;

    if (isTimeout || ['batal', 'halo', 'mulai', 'reset'].includes(t)) {
      await upsertSession(from, ST.IDLE, {
        customerPhone: session?.data?.customerPhone || '',
        customerName: session?.data?.customerName || ''
      });
      return sender.sendText(from, 'Halo Kak! Sesi obrolan sebelumnya sudah ditutup. Ada yang bisa kami bantu hari ini? 😊');
    }
    return;
  }

  let templateData = null;
  if (text.trim().length > 0) {
    templateData = parseOrderTemplate(text);
  }

  let aiData = null;
  const t = text.toLowerCase().trim();
  
  if (message.type === 'location' && state !== ST.WAITING_ORDER) {
    return await estimateShipping(from, message, state);
  }

  if (state === ST.REGION_SELECT && ['1', 'jakarta', '1. jakarta', 'dki jakarta', '2', 'luar jakarta', '2. luar jakarta', 'luar kota'].includes(t)) {
    aiData = { intent: 'REGION_MATCH' };
  } else if (text.trim().length > 0) {
    if (templateData && templateData.isTemplate) {
      aiData = { intent: 'TEMPLATE_FILL' };
    } else {
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
  }

  // Global Pickup Detection
  const isPickupGlobal = PICKUP_KEYWORDS.some(k => t.includes(k) || (aiData?.answer && aiData.answer.toLowerCase().includes(k)) || (templateData?.deliveryMethod === 'pickup'));
  if (isPickupGlobal && session && session.data) {
    session.data.isPickup = true;
    session.data.deliveryFee = 0;
    session.data.deliveryMethod = 'pickup';
    if (!session.data.notes?.includes('(Pickup)')) {
      session.data.notes = session.data.notes ? session.data.notes + ' (Pickup)' : '(Pickup)';
    }
  }

  // Global Delivery Detection
  const KIRIM_KEYWORDS = ['kirim', 'dikirim', 'antar', 'diantar'];
  const isKirimGlobal = KIRIM_KEYWORDS.some(k => t === k || t.includes(`mau ${k}`) || t.includes(`tolong ${k}`) || t.includes(`${k} instan`) || t.includes(`${k} aja`) || t.includes(`${k} ya`));
  if (isKirimGlobal && session && session.data) {
    session.data.deliveryMethod = 'kirim';
    session.data.isPickup = false;
  }

  // Save AI Data extraction before Smart Interrupt
  if (aiData && session && session.data) {
    if (aiData.customerName) session.data.customerName = aiData.customerName;
    if (aiData.customerPhone) session.data.customerPhone = aiData.customerPhone.replace(/[\s-]/g, '').replace(/^0/, '62').replace(/^\+/, '');
    if (aiData.address) session.data.customerAddress = aiData.address;
    if (aiData.deliveryMethod) {
      session.data.deliveryMethod = aiData.deliveryMethod;
      session.data.isPickup = aiData.deliveryMethod === 'pickup';
      if (session.data.isPickup) session.data.deliveryFee = 0;
    }
  }

  // Smart Interrupt
  if (aiData && ['FAQ', 'QUESTION', 'THANKS', 'SHOW_MENU', 'OTHER', 'GREETING', 'ACKNOWLEDGE', 'ADMIN'].includes(aiData.intent)) {
    const activeOrdersCheck = await db.getActiveOrdersByPhone(from, session?.data?.customerPhone);
    const hasActiveOrder = activeOrdersCheck && activeOrdersCheck.length > 0;

    if (state === ST.IDLE && aiData.intent === 'GREETING' && !hasActiveOrder) {
      // Proceed to normal flow
    } else if (aiData.intent === 'ACKNOWLEDGE' || (state === ST.IDLE && ['OTHER', 'THANKS'].includes(aiData.intent))) {
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
        if (state === ST.REGION_SELECT) reminder = '\n\n🌍 _Boleh tau Kakak berada di kota/daerah mana? Sebut saja nama wilayahnya ya Kak. 😊_';
        else if (state === ST.WAITING_ORDER) reminder = '\n\n📝 _Silakan lengkapi format pesanan Kakak ya._';
        else if (state === ST.PAYMENT) reminder = '\n\n⌛ _Menunggu kiriman foto bukti transfer Kakak._';

        if (['OTHER', 'THANKS', 'ACKNOWLEDGE', 'GREETING'].includes(aiData.intent)) {
          reminder = '';
        }

        const fullAnswer = aiData.answer + reminder;
        history.push({ role: 'bot', content: fullAnswer });
        if (history.length > 100) history = history.slice(-100);
        data.history = history;
        await upsertSession(from, state, data);
        await sender.sendText(from, fullAnswer);
      }
      return;
    }
  }

  // Global Cancel Intent
  // Hanya proses CANCEL secara global jika user mengetik kata pembatalan yang persis, atau jika AI mendeteksi CANCEL saat keranjang masih kosong
  const exactCancelKeywords = ['batal', 'cancel', 'batalkan', 'batal pesanan'];
  const isExactCancel = exactCancelKeywords.includes(t);
  const isIdleCancel = aiData && aiData.intent === 'CANCEL' && [ST.IDLE, ST.REGION_SELECT].includes(state);
  
  if (isExactCancel || isIdleCancel) {
    if (session?.data?.orderId) {
      await db.updateOrder(session.data.orderId, { order_status: 'cancelled' });
    }
    await upsertSession(from, ST.IDLE, {
      customerPhone: session?.data?.customerPhone || '',
      customerName: session?.data?.customerName || ''
    });
    let cancelMsg = (aiData && aiData.answer) ? aiData.answer : '✅ Pesanan telah dibatalkan. Jika Kakak berubah pikiran, cukup ketik *Halo* untuk memulai pesanan baru ya Kak. 😊';
    return sender.sendText(from, cancelMsg);
  }

  // --- REJECTED state ---
  if (state === ST.REJECTED) {
    const jakartaKeywords = ['jakarta', 'dki jakarta', 'jakarta pusat', 'jakarta selatan', 'jakarta barat', 'jakarta timur', 'jakarta utara', 'jakpus', 'jaksel', 'jakbar', 'jaktim', 'jakut'];
    const isJakartaCorrection = jakartaKeywords.some(k => t.includes(k)) || (aiData && aiData.intent === 'REGION_MATCH' && aiData.region === 'jakarta');

    if (isJakartaCorrection) {
      await upsertSession(from, ST.REGION_SELECT, data);
      return await handleCustomerMessage(from, name, message);
    }

    const shopeeUrl = config.shopeeUrl || 'https://shopee.co.id/yoyobakery';
    const rejectionMsg = `Maaf Kak, pemesanan via WhatsApp hanya untuk area *Jakarta* ya. 🙏\n\nUntuk luar Jakarta, Kakak bisa pesan di Shopee kami:\n🛒 *${shopeeUrl}*\n\nTerima kasih! 😊🍞`;
    return sender.sendText(from, rejectionMsg);
  }

  if (state === ST.PAYMENT) {
    if (message.type === 'image') return await handlePaymentProof(from, message);
    
    const isExplicitEdit = ['ubah', 'edit', 'ganti', 'revisi'].includes(t);
    const hasModifyingIntent = aiData && ['ORDER', 'TEMPLATE_FILL'].includes(aiData.intent);
    
    if (isExplicitEdit || hasModifyingIntent) {
      const modifiedData = {
        ...session.data,
        totalPrice: null,
        quotationId: null
      };
      
      await upsertSession(from, ST.WAITING_ORDER, modifiedData);
      
      if (isExplicitEdit) {
        const { text: summary } = buildOrderSummary(session.data.items || [], session.data.deliveryFee, session.data.notes);
        const replyMsg = `⬅️ Siap Kak, pesanan sebelumnya akan diubah.\n\n` +
          `🧾 *Pesanan saat ini:* (Order #${session.data.orderNumber})\n${summary}\n\n` +
          `Silakan ketik perubahan Kakak (contoh: "tambah Nastar 1" atau "kurangi Bolen jadi 1").\n` +
          `Atau Kakak juga bisa menyalin & mengirim ulang format pesanan yang baru. 😊`;
        return sender.sendText(from, replyMsg);
      } else {
        return await processWaitingOrder(from, name, text, { state: ST.WAITING_ORDER, data: modifiedData }, aiData, templateData, message);
      }
    }
    
    return sender.sendText(from, '⌛ Menunggu kiriman foto bukti transfer Kakak ya. Silakan kirim gambar di sini. 🙏\n\n_(Ketik *Batal* untuk membatalkan pesanan atau *Ubah* untuk mengedit)_');
  }

  // --- IDLE state ---
  if (state === ST.IDLE) {
    const jakartaKeywords = ['jakarta', 'dki jakarta', 'jakarta pusat', 'jakarta selatan', 'jakarta barat', 'jakarta timur', 'jakarta utara', 'jakpus', 'jaksel', 'jakbar', 'jaktim', 'jakut', 'jl.', 'jalan'];
    const hasJakartaAddr = jakartaKeywords.some(k => t.includes(k)) || (aiData && aiData.address && aiData.address.toLowerCase().includes('jakarta'));
    const isLuarJakarta = !hasJakartaAddr && !isPickupGlobal && (['bandung', 'surabaya', 'semarang', 'yogyakarta', 'jogja', 'medan', 'makassar', 'palembang', 'bekasi', 'tangerang', 'depok', 'bogor'].some(k => t.includes(k)) || (aiData && aiData.region === 'luar_jakarta'));

    if (isLuarJakarta) {
      await upsertSession(from, ST.REJECTED, data);
      const shopeeUrl = config.shopeeUrl || 'https://shopee.co.id/yoyobakery';
      return sender.sendText(from, `Maaf Kak, pemesanan via WhatsApp hanya untuk area *Jakarta* ya. 🙏\n\nUntuk luar Jakarta, Kakak bisa pesan melalui Shopee kami:\n🛒 *${shopeeUrl}*\n\nTerima kasih banyak! 😊🍞`);
    }

    if (hasJakartaAddr || isPickupGlobal) {
      data.customerName = aiData?.customerName || name;
      data.customerPhone = aiData?.customerPhone || null;
      data.customerAddress = aiData?.address || null;
      data.deliveryMethod = aiData?.deliveryMethod || null;
      data.notes = aiData?.notes || '';
      
      if (isPickupGlobal) {
        data.isPickup = true;
        data.deliveryFee = 0;
        data.deliveryMethod = 'pickup';
        if (!data.notes?.includes('(Pickup)')) {
          data.notes = data.notes ? data.notes + ' (Pickup)' : '(Pickup)';
        }
      }

      await upsertSession(from, ST.WAITING_ORDER, data);
      return await processWaitingOrder(from, name, text, { state: ST.WAITING_ORDER, data }, aiData, templateData, message);
    } else {
      const lastOrder = await db.getLastOrder(from, session?.data?.customerPhone);
      if (lastOrder && lastOrder.customer_name) {
        data.customerName = lastOrder.customer_name;
        data.customerPhone = getDisplayPhone(lastOrder.wa_number, lastOrder.notes);
      } else {
        data.customerName = name;
      }

      // Preserve items from AI if any
      if (aiData && aiData.items && aiData.items.length > 0) {
        const products = await db.getProducts();
        const parsedItems = [];
        data.ambiguousPending = data.ambiguousPending || [];
        for (const item of aiData.items) {
          const matchResult = fuzzyMatchProduct(item.name, products);
          if (matchResult.match) {
            parsedItems.push({ name: matchResult.match.name, qty: item.qty || 1, price: matchResult.match.price });
          } else {
            data.ambiguousPending.push({ 
              original: item.name, 
              matches: matchResult.ambiguous || [], 
              qty: item.qty || 1 
            });
          }
        }
        if (parsedItems.length > 0) {
          data.items = parsedItems;
        } else {
          data.items = [];
        }
      }
      
      const activeOrders = await db.getActiveOrdersByPhone(from, session?.data?.customerPhone);
      const hasActive = activeOrders && activeOrders.length > 0;

      if (hasActive) {
        await upsertSession(from, ST.RETURNING_CUSTOMER, data);
        return sender.sendText(from, `Halo Kak ${lastOrder.customer_name}! Kakak memiliki pesanan yang sedang diproses lho. 😊\n\nKetik *1* atau *Cek* untuk melihat status pesanan Kakak.\nKetik *2* atau *Baru* untuk membuat pesanan baru.`);
      } else {
        await upsertSession(from, ST.REGION_SELECT, data);
        if (lastOrder && lastOrder.customer_name) {
          return sender.sendText(from, `Halo Kak ${lastOrder.customer_name}! Selamat datang kembali di *Yoyo Bakery*! 🍞\n\n🌍 Boleh tau Kakak berada di daerah/kota mana ya? Sebut saja nama wilayahnya Kak. 😊`);
        } else {
          return sender.sendText(from, `Halo Kak! Selamat datang di *Yoyo Bakery*! 🍞\n\n🌍 Boleh tau Kakak berada di daerah/kota mana ya? Sebut saja nama wilayahnya Kak. 😊`);
        }
      }
    }
  }

  // --- RETURNING_CUSTOMER state ---
  if (state === ST.RETURNING_CUSTOMER) {
    const isCheck = t === '1' || t === '1.' || t.includes('cek') || t.includes('satu') || t.includes('status');
    const isNew = t === '2' || t === '2.' || t.includes('baru') || t.includes('dua') || t.includes('pesan');
    
    if (isCheck) {
      const activeOrders = await db.getActiveOrdersByPhone(from, session?.data?.customerPhone);
      if (activeOrders && activeOrders.length > 0) {
        let msg = `🧾 *Status Pesanan Aktif Kakak:*\n\n`;
        activeOrders.forEach(ord => {
          let statusText = ord.order_status;
          if (statusText === 'waiting_payment') statusText = '⏳ Menunggu Pembayaran';
          else if (statusText === 'confirmed') statusText = '✅ Dikonfirmasi / Lunas';
          else if (statusText === 'packing') statusText = '📦 Sedang Diproses (Packing)';
          else if (statusText === 'shipping') statusText = '🚚 Sedang Dikirim';
          msg += `- *Order #${ord.order_number}*\nStatus: ${statusText}\nTotal: Rp${Number(ord.total_price).toLocaleString('id-ID')}\n\n`;
        });
        msg += `Terima kasih! Jika butuh bantuan lebih lanjut, ketik *Admin* ya Kak. 😊`;
        
        await upsertSession(from, ST.IDLE, {
          customerPhone: session?.data?.customerPhone || '',
          customerName: session?.data?.customerName || ''
        });
        return sender.sendText(from, msg);
      }
    } else if (isNew) {
      await upsertSession(from, ST.REGION_SELECT, data);
      return sender.sendText(from, `Siap Kak! Mari kita buat pesanan baru. 🍞\n\n🌍 Boleh tau Kakak berada di daerah/kota mana ya? Sebut saja nama wilayahnya Kak. 😊`);
    } else {
      return sender.sendText(from, `Maaf Kak, saya kurang paham. 🙏\n\nKetik *1* atau *Cek* untuk melacak status pesanan.\nKetik *2* atau *Baru* untuk membuat pesanan baru.`);
    }
  }

  // --- REGION_SELECT state ---
  if (state === ST.REGION_SELECT) {
    const jakartaKeywords = ['jakarta', 'dki jakarta', 'jakarta pusat', 'jakarta selatan', 'jakarta barat', 'jakarta timur', 'jakarta utara', 'jakpus', 'jaksel', 'jakbar', 'jaktim', 'jakut'];
    const luarJakartaKeywords = [
      'luar jakarta', 'luar kota', 'bandung', 'surabaya', 'semarang', 'yogyakarta', 'jogja', 'medan', 'makassar', 'palembang',
      'malang', 'solo', 'tangerang', 'bekasi', 'depok', 'bogor', 'cirebon', 'serang', 'cilegon', 'denpasar', 'bali'
    ];
    
    const isJakarta = t === '1' || t === '1.' || jakartaKeywords.some(k => t.includes(k)) || (aiData && aiData.intent === 'REGION_MATCH' && aiData.region === 'jakarta');
    const isLuarJakarta = t === '2' || t === '2.' || luarJakartaKeywords.some(k => t.includes(k)) || (aiData && aiData.intent === 'REGION_MATCH' && aiData.region === 'luar_jakarta');
    const isPickup = PICKUP_KEYWORDS.some(k => t.includes(k)) || (aiData?.answer && aiData.answer.toLowerCase().includes('ambil'));

    if (isJakarta || isPickup) {
      if (isPickup) {
        data.isPickup = true;
        data.deliveryFee = 0;
        data.deliveryMethod = 'pickup';
      }
      
      await upsertSession(from, ST.WAITING_ORDER, data);
      return await buildAndSendTemplate(from, data);
    } else if (isLuarJakarta) {
      await upsertSession(from, ST.REJECTED, data);
      const shopeeUrl = config.shopeeUrl || 'https://shopee.co.id/yoyobakery';
      return sender.sendText(from, `Maaf Kak, pemesanan via WhatsApp hanya untuk area *Jakarta* ya. 🙏\n\nUntuk luar Jakarta, Kakak bisa pesan di Shopee kami:\n🛒 *${shopeeUrl}*\n\nTerima kasih! 😊🍞`);
    } else {
      return sender.sendText(from, '🌍 Mohon ketik nama kota atau wilayah Kakak ya (contoh: Jakarta, Bandung, Surabaya).');
    }
  }

  // --- WAITING_ORDER state ---
  if (state === ST.WAITING_ORDER) {
    return await processWaitingOrder(from, name, text, session, aiData, templateData, message);
  }
}

module.exports = { handleCustomerMessage };
