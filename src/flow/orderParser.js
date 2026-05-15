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

module.exports = { parseOrderText, formatRupiah, buildOrderSummary };
