const logger = require('../utils/logger');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');
const db = require('../database/supabase');

// ============================================================
// LAYER 1: REGEX CEPAT UNTUK INTENT DASAR
// ============================================================
const GREETINGS = /^(halo|hi|hai|pagi|siang|sore|malam|assalamu|ping|p)$/i;
const ORDER_GREETINGS = /^(pesan|order|mau beli|beli|mau pesen|pesen|mau order)$/i;
const CONFIRMS = /^(konfirmasi|benar|betul|iya|yak|yep|ya bener|sudah benar)$/i;
const CANCELS = /^(batal|cancel|ngga jadi|tidak jadi|kembali|ulang|ubah)$/i;
const BACKS = /^(kembali|back|ubah|edit)$/i;
const THANKS = /^(makasih|terima kasih|thanks|tq|suwun|thank you|nuhun)$/i;
const ACKNOWLEDGES = /^(ok|oke|okee|okey|sip|siap|baik|baiklah|ya|ngga ada|tidak ada|udah|sudah|👍|🙏)$/i;
const COMPLAINS = /^(monyet|anjing|babi|bangsat|lama banget|rusak|basi|admin|cs|kecewa)$/i;
const MULAIS = /^(mulai|start|gas)$/i;

function quickIntentMatch(text) {
  const t = text.trim();
  if (MULAIS.test(t)) return { intent: 'ONBOARD_START', items: [] };
  if (ACKNOWLEDGES.test(t)) return { intent: 'ACKNOWLEDGE', items: [] };
  if (COMPLAINS.test(t)) return { intent: 'ADMIN', items: [] };
  if (GREETINGS.test(t)) return { intent: 'GREETING', items: [], answer: 'Halo Kak! Selamat datang di Yoyo Bakery 🍞 Ada yang bisa kami bantu hari ini?' };
  if (ORDER_GREETINGS.test(t)) return { intent: 'ORDER', items: [], answer: 'Siap Kak! Yuk langsung pesan! 😊' };
  if (CONFIRMS.test(t))  return { intent: 'CONFIRM', items: [], answer: 'Siap Kak, pesanan dikonfirmasi! ✅' };
  if (CANCELS.test(t))   return { intent: 'CANCEL', items: [], answer: 'Baik Kak, pesanan dibatalkan. 🙏' };
  if (BACKS.test(t))     return { intent: 'BACK', items: [] };
  if (THANKS.test(t))    return { intent: 'THANKS', items: [], answer: 'Sama-sama Kak! 😊 Senang bisa membantu. Jangan ragu hubungi kami lagi ya! 🍞' };
  return null;
}

// ============================================================
// LAYER 2: FAQ & QUICK MATCH DIHAPUS (Dialihkan ke Gemini agar lebih cerdas)

// ============================================================
// LAYER 3: GEMINI AI
// ============================================================
async function callGeminiAI(text, state = null, ambiguousContext = null, activeOrderContext = '', history = []) {
  const apiKey = config.geminiApiKey?.trim();
  if (!apiKey) {
    logger.error('❌ GEMINI_API_KEY tidak ditemukan di .env!');
    return null;
  }

  const modelNames = [
    "gemini-3.1-flash-lite-preview",
    "gemini-2.5-flash",
    "gemma-3-27b-it",
    "gemini-3-flash-preview"
  ];
  
  let productList = "Daftar produk tidak tersedia saat ini.";
  try {
    const products = await db.getProducts();
    if (products && products.length > 0) {
      productList = products.map(p => `- ${p.name} (Rp ${p.price})`).join('\n');
    }
  } catch (err) {
    logger.warn({ err: err.message }, '⚠️ Gagal mengambil produk untuk AI, menggunakan fallback.');
  }

  let faqList = "";
  try {
    const faqs = await db.getFaqs();
    if (faqs && faqs.length > 0) {
      faqList = faqs.map(f => `- ${f.question}: ${f.answer}`).join('\n');
    }
  } catch (err) {
    logger.warn({ err: err.message }, '⚠️ Gagal mengambil FAQ untuk AI, menggunakan fallback.');
  }

  let bolenSoldOutToday = false;
  try {
    const bolenSetting = await db.getGlobalSetting('bolen_sold_out_today');
    if (bolenSetting === 'true') bolenSoldOutToday = true;
  } catch(err) {}

  // Build state context for AI
  let stateContext = '';
  if (state === 'REJECTED') {
    stateContext = `\nKONTEKS PERCAKAPAN:\n- Pelanggan ini dari LUAR JAKARTA dan sudah DITOLAK pesan via WA.\n- JANGAN PERNAH bilang "bisa pesan via WA".\n- Arahkan ke Shopee. Tetap ramah.\n`;
  } else if (state === 'CONFIRM' || state === 'LOCATION' || state === 'PAYMENT') {
    stateContext = `\nKONTEKS PERCAKAPAN:\n- Pelanggan SUDAH SELESAI memilih pesanan dan sedang berada di tahap penyelesaian (konfirmasi/shareloc/bayar).\n- PENTING: JANGAN menambahkan pesanan baru (JANGAN set intent "ORDER") kecuali pelanggan secara TEGAS menggunakan kata 'tambah', 'jadi [angka]', dll. Jika mereka hanya menyebutkan pesanan untuk memastikan, set intent "FAQ" atau "QUERY".\n`;
  }
  
  let contextAddon = '';
  if (ambiguousContext && ambiguousContext.length > 0) {
    contextAddon += `\n[KONTEKS KLARIFIKASI PENTING]:\nSebelumnya bot bertanya kepada pelanggan untuk memperjelas pesanan berikut:\n${JSON.stringify(ambiguousContext)}\nJika pesan pelanggan ("${text}") hanya berisi angka (misal: "3 aja") atau pilihan singkat (misal: "yang keju"), pelanggan sedang menjawab pertanyaan di atas! Pahami maksudnya, gabungkan dengan produk di atas, lalu set intent="ORDER" dengan items yang tepat.`;
  }
  if (activeOrderContext && activeOrderContext.length > 0) {
    contextAddon += activeOrderContext;
  }

  if (history && history.length > 0) {
    historyAddon = `\nRIWAYAT PERCAKAPAN TERAKHIR:\n${history.map(h => `[${h.role.toUpperCase()}]: ${h.content}`).join('\n')}\n`;
  }

  let bolenContext = '';
  if (bolenSoldOutToday) {
    bolenContext = `\n[INFO PENTING HARI INI]:\nKhusus HARI INI, pengiriman instan untuk BOLEN (Bolen Lilit, dll) sedang KOSONG/HABIS karena hari ini kami hanya mengirimkan bolen untuk antrean PO kemarin. JIKA pelanggan mencoba memesan Bolen (baik lilit atau lainnya) untuk dikirim hari ini, beri tahu mereka secara sopan bahwa bolen hari ini habis dan pesanan bolen mereka otomatis akan dikirim BESOK. Catat saja pesanannya dengan wajar, tidak usah menolak, cukup berikan informasi tersebut di 'answer'. Jika tidak ada bolen dalam pesanan mereka, abaikan info ini.\n`;
  }

  for (const modelName of modelNames) {
    try {
      logger.info({ model: modelName }, `🤖 Memanggil AI Gemini...`);
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });

      const prompt = `
Anda adalah asisten Yoyo Bakery yang cerdas, ramah, sangat sopan kepada orang tua (gunakan sapaan Ibu/Bapak/Kak), dan solutif. Analisis pesan pelanggan: "${text}"
${stateContext}${contextAddon}${historyAddon}
${bolenContext}

ATURAN OUTPUT JSON:
1. Pastikan valid JSON. TIDAK BOLEH ada teks di luar JSON (tanpa markdown).

PRODUK TERSEDIA:
${productList}

ATURAN BISNIS & FAQ (WAJIB DITAATI 100%):
- Shopee: Jika ditanya tentang Shopee/Toko Online, WAJIB berikan link ini: ${config.shopeeUrl || 'https://shopee.co.id/yoyobakery'}
${faqList}
ATURAN KLASIFIKASI INTENT:
1. Jika pelanggan menyebutkan nama kota, kecamatan, provinsi, atau daerah pengiriman (contoh: "Jatiasih", "Bekasi", "Bandung", "Cempaka Putih", "Jakarta Pusat") -> set intent "REGION_MATCH" dan tentukan apakah daerah tersebut masuk area Jakarta (DKI Jakarta) atau luar Jakarta. Isi field "region" dengan "jakarta" atau "luar_jakarta".
2. Jika pelanggan menanyakan daftar menu, harga, katalog, pricelist, atau bertanya "ada produk/menu apa saja?" -> set intent "SHOW_MENU" (kosongkan answer). Sistem kami yang akan mengirimkan gambar katalognya. JIKA pelanggan menanyakan menu bersamaan dengan FAQ lain dan Anda terpaksa harus menjawab menggunakan teks, maka JANGAN sebutkan harga dan nama varian satu per satu. Cukup sebutkan kategori utama kami yaitu: "Roti dan Pastry" serta "Cake dan Dessert".
3. Jika isi pesan murni/mayoritas menanyakan FAQ (seperti jam buka, shopee, ongkir, cara shareloc, halal tidaknya, dsb) di luar permintaan daftar menu -> set intent "FAQ" dan JAWAB SECARA LENGKAP & SOPAN.
4. Jika pelanggan komplain, merevisi pesanan yang sudah dibayar, atau membuat permintaan khusus yang rumit -> set intent "ADMIN" (kosongkan answer).
5. Jika pelanggan memiliki PESANAN AKTIF (lihat INFO PENTING) dan mereka hanya menyebutkan nama rotinya untuk menanyakan pengiriman/jadwal/status (bukan memesan baru) -> set intent "FAQ" atau "ADMIN". JANGAN set intent "ORDER".
6. Jika pelanggan menjawab singkat (misal: "oke", "ok", "sip", "sudah", "ya") -> JIKA konteksnya sedang ditanya konfirmasi, set intent "CONFIRM". Jika bukan, set intent "ACKNOWLEDGE".
7. Jika pelanggan mengetik "mulai" -> set intent "ONBOARD_START".
8. Jika pelanggan menyebutkan nama makanan (contoh: "brownies 1") untuk pesanan baru, ekstrak ke array "items" dengan intent "ORDER".

ATURAN EKSTRAKSI ORDER (Jika intent = ORDER):
- Bolen/Roll Cake: 10 pcs per kotak. Roti: 4 pcs per kotak.
- JIKA pelanggan hanya menyebutkan nama umum (contoh: "nastar" atau "bolen"), gunakan nama umum tersebut sebagai nama item (contoh: "nastar", "bolen"). JANGAN menebak atau menggabungkan varian sendiri seperti "Nastar Classic/Keju" or "Bolen Coklat/Keju". Biarkan program kami yang mencocokkan fuzzy matching-nya nanti.
- Gunakan action: "remove" untuk pembatalan item.
- KHUSUS intent ORDER: Jika pelanggan menanyakan pertanyaan (FAQ) bersamaan dengan pesanan mereka, WAJIB isi field "answer" dengan jawaban dari pertanyaan tersebut. Jika tidak ada pertanyaan, biarkan null.
- KHUSUS intent CANCEL: WAJIB isi "answer" dengan kalimat pembatalan yang ramah. JIKA pelanggan membatalkan KARENA ONGKIR MAHAL, tunjukkan empati dan berikan alternatif link Shopee (${config.shopeeUrl || 'https://shopee.co.id/yoyobakery'}) untuk ongkir yang lebih hemat.

CONTOH JSON JAWABAN:
{"intent": "FAQ", "items": [], "customerName": null, "notes": null, "answer": "Ada dong Bu! Ibu bisa langsung mampir ke toko Shopee kami di link berikut ya: https://shopee.co.id/yoyobakery 😊"}

FORMAT JSON SAJA:
{
  "intent": "ORDER|CONFIRM|CANCEL|BACK|QUERY|GREETING|THANKS|FAQ|SHOW_MENU|OTHER|ACKNOWLEDGE|ADMIN|ONBOARD_START|REGION_MATCH",
  "items": [{"name": "nama_roti", "qty": 2, "action": "add/update/remove"}],
  "customerName": "nama jika ada",
  "customerPhone": "nomor HP JIKA pelanggan mengoreksi/memberikan nomor HP (contoh: 0812345). Jika tidak ada, null.",
  "notes": "catatan pesanan jika ada (contoh: jangan manis, dsb). JANGAN masukkan alamat ke field ini!",
  "address": "alamat pengiriman teks JIKA pelanggan mengetikkannya secara eksplisit (contoh: Jl. Merdeka No 1). Jika tidak ada, null.",
  "region": "jakarta|luar_jakarta (hanya jika intent = REGION_MATCH)",
  "answer": "WAJIB ISI untuk FAQ/GREETING/THANKS/OTHER/REGION_MATCH. Boleh diisi jika intent = ORDER dan pelanggan menanyakan FAQ."
}

GAYA JAWABAN:
- Gunakan bahasa yang sopan, sabar, dan mudah dipahami orang tua (gunakan sebutan Ibu/Bapak/Kak).
- Jawaban ringkas, to the point, tapi tetap ramah.

HANYA JSON.`;

      const result = await model.generateContent(prompt);
      const resText = result.response.text();
      logger.info({ model: modelName, response: resText }, '✅ AI Response');
      
      const match = resText.match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : null;
    } catch (err) {
      logger.warn({ model: modelName, error: err.message }, '⚠️ AI Error');
      continue;
    }
  }
  return null;
}

async function aiParseOrder(text, state = null, ambiguousContext = null, activeOrderContext = '', history = []) {
  if (!text || text.trim().length === 0) return null;
  return quickIntentMatch(text) || await callGeminiAI(text, state, ambiguousContext, activeOrderContext, history);
}

module.exports = { aiParseOrder };
