const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

/**
 * Buat Laporan Excel dari data pesanan
 * @param {Array} orders - Daftar pesanan dari database
 * @returns {Promise<string>} - Path absolute ke file Excel yang berhasil dibuat
 */
async function generateDailyReport(orders) {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Yoyo Bakery Bot';
    workbook.created = new Date();

    // ==========================================
    // SHEET 1: DETAIL PESANAN
    // ==========================================
    const wsDetails = workbook.addWorksheet('Detail Pesanan', {
      views: [{ state: 'frozen', ySplit: 1 }] // Freeze baris pertama (header)
    });

    wsDetails.columns = [
      { header: 'No Order', key: 'id', width: 12 },
      { header: 'Tanggal', key: 'date', width: 20 },
      { header: 'Nama Customer', key: 'name', width: 25 },
      { header: 'No WhatsApp', key: 'phone', width: 18 },
      { header: 'Pesanan', key: 'items', width: 45 },
      { header: 'Catatan', key: 'notes', width: 30 },
      { header: 'Belanja', key: 'subtotal', width: 15 },
      { header: 'Ongkir', key: 'ongkir', width: 15 },
      { header: 'Total Bayar', key: 'total', width: 15 },
      { header: 'Status Pembayaran', key: 'payment_status', width: 22 },
      { header: 'Status Pengiriman', key: 'order_status', width: 20 },
      { header: 'Alamat Tujuan', key: 'address', width: 40 }
    ];

    // Styling Header
    wsDetails.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD35400' } }; // Warna Orange Bakery
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' }
      };
    });

    orders.forEach(o => {
      let itemsStr = '';
      if (Array.isArray(o.items)) {
        itemsStr = o.items.map(i => `${i.name} (x${i.qty})`).join(', ');
      }

      // Ekstrak nomor HP asli dari notes jika ada (karena wa_number mungkin LID)
      let displayPhone = o.wa_number ? o.wa_number.split('@')[0] : '-';
      let cleanNotes = o.notes || '-';
      if (o.notes) {
        const phoneMatch = o.notes.match(/\(HP:\s*(\d+)\)/);
        if (phoneMatch) {
          displayPhone = phoneMatch[1];
          cleanNotes = o.notes.replace(/\s*\(HP:\s*\d+\)/, '').trim() || '-';
        }
      }

      const row = wsDetails.addRow({
        id: o.order_number || o.id,
        date: new Date(o.created_at).toLocaleString('id-ID'),
        name: o.customer_name || '-',
        phone: displayPhone,
        items: itemsStr,
        notes: cleanNotes,
        subtotal: (o.total_price || 0) - (o.delivery_fee || 0),
        ongkir: o.delivery_fee || 0,
        total: o.total_price || 0,
        payment_status: o.payment_status.toUpperCase(),
        order_status: o.order_status.toUpperCase(),
        address: o.customer_address || '-'
      });

      // Styling Data Rows
      row.eachCell((cell, colNumber) => {
        cell.alignment = { vertical: 'middle', wrapText: colNumber === 5 || colNumber === 12 };
        cell.border = {
          top: { style: 'hair' }, left: { style: 'hair' },
          bottom: { style: 'hair' }, right: { style: 'hair' }
        };
      });

      // Format Uang untuk kolom Belanja, Ongkir, Total
      row.getCell('subtotal').numFmt = '"Rp"#,##0';
      row.getCell('ongkir').numFmt = '"Rp"#,##0';
      row.getCell('total').numFmt = '"Rp"#,##0';
      
      // Warna untuk status pembayaran
      const statusCell = row.getCell('payment_status');
      if (o.payment_status === 'paid') {
        statusCell.font = { color: { argb: 'FF007A33' }, bold: true }; // Hijau
      } else if (o.payment_status === 'pending') {
        statusCell.font = { color: { argb: 'FFC0392B' }, bold: true }; // Merah
      } else {
        statusCell.font = { color: { argb: 'FFF39C12' }, bold: true }; // Kuning
      }
    });

    // ==========================================
    // SHEET 2: REKAP DAPUR
    // ==========================================
    const wsDapur = workbook.addWorksheet('Rekap Dapur', {
      views: [{ state: 'frozen', ySplit: 1 }]
    });

    wsDapur.columns = [
      { header: 'Nama Produk', key: 'name', width: 35 },
      { header: 'Total Produksi (Qty)', key: 'qty', width: 25 }
    ];

    // Styling Header Dapur
    wsDapur.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2980B9' } }; // Warna Biru
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    const itemCounts = {};
    orders.forEach(o => {
      if (['paid', 'reviewing'].includes(o.payment_status) && Array.isArray(o.items)) {
        o.items.forEach(item => {
          itemCounts[item.name] = (itemCounts[item.name] || 0) + item.qty;
        });
      }
    });

    const dapurSummary = Object.keys(itemCounts)
      .map(name => ({ name, qty: itemCounts[name] }))
      .sort((a, b) => b.qty - a.qty);

    let totalBox = 0;
    dapurSummary.forEach(item => {
      const row = wsDapur.addRow(item);
      totalBox += item.qty;
      row.getCell('qty').alignment = { horizontal: 'center' };
      row.eachCell(cell => { cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } } });
    });

    // Tambahkan Total Keseluruhan
    const totalRow = wsDapur.addRow({ name: 'TOTAL KESELURUHAN', qty: totalBox });
    totalRow.font = { bold: true };
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1C40F' } }; // Kuning
    totalRow.getCell('qty').alignment = { horizontal: 'center' };

    // ==========================================
    // SIMPAN FILE
    // ==========================================
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `Rekap_Pesanan_YoyoBakery_${dateStr}.xlsx`;
    const tempPath = path.join(__dirname, '../../scratch', fileName);
    
    const scratchDir = path.dirname(tempPath);
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }

    await workbook.xlsx.writeFile(tempPath);
    
    logger.info({ file: tempPath }, '✅ Laporan Excel (ExcelJS) berhasil dibuat');
    return tempPath;
  } catch (err) {
    logger.error({ err }, '❌ Gagal membuat laporan ExcelJS');
    return null;
  }
}

module.exports = { generateDailyReport };
