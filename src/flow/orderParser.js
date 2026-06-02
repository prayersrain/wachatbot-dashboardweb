const { findProductByName } = require('../database/supabase');

/**
 * Parse a free-text order message into structured order data.
 *
 * Expected format (flexible):
 *   Nama: Ahmad
 *   Nastar Classic x2
 *   Bolen Coklat Keju x1
 *   Catatan: jangan terlalu manis
 *
 * Or simpler:
 *   nastar classic 2, bolen coklat keju 1
 */
async function parseOrderText(text) {
  const result = {
    customerName: null,
    items: [],
    notes: null,
    errors: [],
  };

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (const line of lines) {
    // 1. Extract name
    const nameMatch = line.match(/^nama\s*[:=]\s*(.+)/i);
    if (nameMatch) {
      result.customerName = nameMatch[1].trim();
      continue;
    }

    // 2. Extract notes
    const notesMatch = line.match(/^(catatan|notes?|pesan)\s*[:=]\s*(.+)/i);
    if (notesMatch) {
      result.notes = notesMatch[2].trim();
      continue;
    }

    // 3. Clean line from common "Order:" prefixes (handling typos like 'pesnaan')
    let cleanLine = line.replace(/^(pesanan|pesnaan|order|item|produk)\s*[:=]\s*/i, '').trim();

    // 4. Try to parse item lines: "Item Name x Qty" or "Item Name qty"
    const itemMatch = cleanLine.match(/^(.+?)\s*[xX×]\s*(\d+)\s*$/);
    const itemMatch2 = cleanLine.match(/^(.+?)\s+(\d+)\s*$/);
    const itemMatch3 = cleanLine.match(/^(\d+)\s*[xX×]?\s*(.+)$/);

    let itemName, qty;

    if (itemMatch) {
      itemName = itemMatch[1].trim();
      qty = parseInt(itemMatch[2]);
    } else if (itemMatch3) {
      qty = parseInt(itemMatch3[1]);
      itemName = itemMatch3[2].trim();
    } else if (itemMatch2) {
      itemName = itemMatch2[1].trim();
      qty = parseInt(itemMatch2[2]);
    } else {
      itemName = cleanLine.replace(/,/g, '').trim();
      qty = 1;
    }

    if (!itemName || itemName.length < 2) continue;

    // Skip greeting-like lines
    if (/^(halo|hai|hi|hey|saya|mau|pesan|order|beli|tolong)/i.test(itemName)) continue;

    // Look up product in database
    const product = await findProductByName(itemName);

    if (product) {
      result.items.push({
        productId: product.id,
        name: product.name,
        price: product.price,
        qty,
        subtotal: product.price * qty,
        stockType: product.stock_type,
      });
    } else {
      result.errors.push(`"${itemName}" tidak ditemukan di katalog.`);
    }
  }

  return result;
}

/**
 * Format currency to Indonesian Rupiah
 */
function formatRupiah(amount) {
  return 'Rp ' + Number(amount).toLocaleString('id-ID');
}

/**
 * Build order summary text
 */
function buildOrderSummary(items, deliveryFee, notes) {
  let text = '🧾 *Ringkasan Pesanan:*\n\n';

  let itemsTotal = 0;
  items.forEach((item, i) => {
    const subtotal = item.subtotal || (item.qty * item.price);
    const stockLabel = item.stockType === 'po' ? ' _(PO)_' : '';
    text += `${i + 1}. ${item.name}${stockLabel}\n`;
    text += `   ${item.qty}x ${formatRupiah(item.price)} = ${formatRupiah(subtotal)}\n`;
    itemsTotal += subtotal;
  });

  text += `\n📦 Subtotal: ${formatRupiah(itemsTotal)}`;

  if (deliveryFee !== undefined && deliveryFee !== null) {
    text += `\n🚚 Ongkir: ${formatRupiah(deliveryFee)}`;
    text += `\n━━━━━━━━━━━━━━━━━━`;
    text += `\n💰 *TOTAL: ${formatRupiah(itemsTotal + deliveryFee)}*`;
  }
  
  if (notes) {
    text += `\n\n📝 *Catatan Khusus:* ${notes}`;
  }

  return { text, itemsTotal };
}

/**
 * Parse template format yang diisi pelanggan.
 * Mengembalikan object dengan semua field yang terdeteksi.
 */
function parseOrderTemplate(text) {
  if (!text) return { isTemplate: false };
  const lines = text.split('\n');
  const result = {
    customerName: null,
    items: null,
    deliveryMethod: null,
    address: null,
    phone: null,
    notes: null,
    isTemplate: false
  };

  const keys = [
    { field: 'customerName', regex: /^(nama|name|nama\s+penerima)\s*[:=]/i },
    { field: 'items', regex: /^(pesanan|pesnaan|order|pesan|items?|produk)\s*[:=]/i },
    { field: 'deliveryMethod', regex: /^(pengiriman|kirim\s*[\/\-]\s*ambil|metode|tipe|delivery)\s*[:=]/i },
    { field: 'address', regex: /^(alamat|address|lokasi|tujuan)\s*[:=]/i },
    { field: 'phone', regex: /^(no\s*hp|hp|nomor|wa|whatsapp|handphone|telepon|telp)\s*[:=]/i },
    { field: 'notes', regex: /^(catatan|notes?|pesan\s+tambahan)\s*[:=]/i }
  ];

  let currentField = null;
  let matchesCount = 0;

  for (let line of lines) {
    let trimmed = line.trim();
    if (!trimmed) continue;

    // Check if this line starts a new field
    let foundNewField = false;
    for (const key of keys) {
      const match = trimmed.match(key.regex);
      if (match) {
        // Find where the colon or equal sign is, and get the rest of the line
        const colonIndex = trimmed.indexOf(':') !== -1 ? trimmed.indexOf(':') : trimmed.indexOf('=');
        const val = trimmed.slice(colonIndex + 1).trim();
        result[key.field] = val;
        currentField = key.field;
        foundNewField = true;
        matchesCount++;
        break;
      }
    }

    if (!foundNewField && currentField) {
      // Append to the current field (for multiline items or address)
      if (result[currentField]) {
        result[currentField] += '\n' + trimmed;
      } else {
        result[currentField] = trimmed;
      }
    }
  }

  // Determine if it is a template fill
  if (matchesCount >= 3) {
    result.isTemplate = true;
  }

  // Post-process values (clean up placeholders, default instructions, or dashes)
  if (result.customerName) {
    if (/^(contoh|john\s+doe)/i.test(result.customerName)) {
      result.customerName = null;
    }
  }
  if (result.items) {
    if (result.items.includes('contoh:') || result.items.includes('(contoh:')) {
      result.items = null;
    }
  }
  if (result.deliveryMethod) {
    const dm = result.deliveryMethod.toLowerCase();
    if (dm.includes('kirim')) {
      result.deliveryMethod = 'kirim';
    } else if (dm.includes('ambil') || dm.includes('toko') || dm.includes('pickup')) {
      result.deliveryMethod = 'pickup';
    } else {
      result.deliveryMethod = null;
    }
  }
  if (result.address) {
    if (result.address.includes('mohon diisi') || result.address.includes('kosongkan bila') || result.address.includes('opsional')) {
      result.address = null;
    }
  }
  if (result.phone) {
    if (result.phone.includes('contoh:')) {
      result.phone = null;
    }
  }
  if (result.notes) {
    if (result.notes.includes('opsional') || result.notes.trim() === '-') {
      result.notes = null;
    }
  }

  // Clean empty strings / single dashes
  for (const field of ['customerName', 'items', 'address', 'phone', 'notes']) {
    if (result[field]) {
      const cleaned = result[field].replace(/^\s*[-—]\s*$/, '').trim();
      result[field] = cleaned || null;
    }
  }

  return result;
}

module.exports = { parseOrderText, formatRupiah, buildOrderSummary, parseOrderTemplate };
