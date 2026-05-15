const logger = require('../utils/logger');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');
const db = require('../database/supabase');

// ============================================================
// LAYER 1: KEYWORD MATCH (100% GRATIS)
// ============================================================
const GREETINGS = /^(halo|hai|hi|hey|hello|assalamualaikum|assalamu'alaikum|selamat\s*(pagi|siang|sore|malam)|p|permisi|kak|min|mau\s*pesan|mau\s*pesen|mau\s*order|mau\s*beli)(?:\s*(kak|min|bang|pak|bu))?[\s!?.]*$/i;
const CONFIRMS = /^(iya|ya|yaa|yaaa|yoi|yup|yep|yes|ok|oke|okey|okay|sip|siap|benar|betul|setuju|konfirmasi|lanjut|deal|gas|mantap|boleh|bisa|acc|fix|jadi|ayo|let'?s?\s*go)[\s!?.]*$/i;
const CANCELS = /^(batal|cancel|ga\s*jadi|gajadi|tidak|ngga|nggak|gak|no|nope|udah\s*deh|ga\s*usah|skip|stop)[\s!?.]*$/i;
const BACKS = /^(kembali|balik|back|ubah|revisi|ganti|mundur|ulangi|koreksi|salah|edit)[\s!?.]*$/i;
const THANKS = /^(makasih|terima\s*kasih|thanks|thank\s*you|thx|tq|tengkyu|nuhun|matur\s*nuwun)(?:\s*(banyak|banget))?(?:\s*(kak|min|bang|pak|bu|ya))?[\s!?.]*$/i;
const JAKARTA_REGION = /^1$|^satu$|\b(jakarta|jkt|jaksel|jakbar|jaktim|jakpus|jakut|jabodetabek|tangerang|tangsel|bekasi|depok|bogor)\b/i;
const LUAR_JAKARTA = /^2$|^dua$|\b(luar\s*(jakarta|jkt|kota)?|bukan\s*(jakarta|jkt)|daerah|luar|bandung|surabaya|medan|semarang|jogja|bali|makassar)\b/i;

function quickIntentMatch(text) {
  const t = text.trim();
  if (GREETINGS.test(t)) return { intent: 'GREETING', items: [] };
  if (JAKARTA_REGION.test(t)) return { intent: 'REGION_JAKARTA', items: [] };
  if (LUAR_JAKARTA.test(t)) return { intent: 'REGION_LUAR', items: [] };
  if (CONFIRMS.test(t))  return { intent: 'CONFIRM', items: [] };
  if (CANCELS.test(t))   return { intent: 'CANCEL', items: [] };
  if (BACKS.test(t))     return { intent: 'BACK', items: [] };
  if (THANKS.test(t))    return { intent: 'THANKS', items: [], answer: 'Sama-sama Kak! 😊 Senang bisa membantu. Jangan ragu hubungi kami lagi ya! 🍞' };
  return null;
}

// ============================================================
// LAYER 2: FAQ KNOWLEDGE BASE (100% GRATIS)
// ============================================================
const FAQ_DATA = [
  { keywords: ['jam', 'buka', 'operasional'], answer: 'Senin - Sabtu: 08.00 - 20.00 WIB, Minggu: 09.00 - 18.00 WIB. 😊' },
  { keywords: ['alamat', 'dimana', 'posisi'], answer: `📍 Alamat: ${config.store.address} 🚚` },
  { keywords: ['bayar', 'transfer', 'bca'], answer: `💳 Rek BCA: ${config.payment.bcaNumber} a/n ${config.payment.bcaName}.` },
  { keywords: ['ongkir', 'delivery'], answer: '🚚 Ongkir kurir Lalamove sesuai jarak. Kirim shareloc aja Kak nanti dihitung otomatis!' },
  { keywords: ['halal', 'bpom'], answer: '☪️ Produk kami 100% HALAL dan berkualitas Kak. 🙏' },
  { keywords: ['promo', 'diskon'], answer: '🎉 Cek promo terbaru ke Admin ya Kak! Pesan banyak ada harga spesial. 😊' },
  { keywords: ['po', 'preorder'], answer: '📋 Beberapa produk PO 1-2 hari karena dibuat fresh. 😊' },
  { keywords: ['menu', 'katalog', 'jual'], answer: null },
];

function matchFAQ(text) {
  const t = text.toLowerCase().trim();
  for (const faq of FAQ_DATA) {
    if (faq.keywords.some(kw => t.includes(kw))) {
      if (faq.answer === null) return { intent: 'SHOW_MENU', items: [] };
      return { intent: 'FAQ', items: [], answer: faq.answer };
    }
  }
  return null;
}

// ============================================================
// LAYER 3: GEMINI AI
// ============================================================
async function callGeminiAI(text) {
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
    logger.debug('📂 Mengambil daftar produk untuk AI...');
    const products = await db.getProducts();
    if (products && products.length > 0) {
      productList = products.map(p => `- ${p.name} (Rp ${p.price})`).join('\n');
    }
  } catch (err) {
    logger.warn({ err: err.message }, '⚠️ Gagal mengambil produk untuk AI, menggunakan fallback.');
  }

  for (const modelName of modelNames) {
    try {
      logger.info({ model: modelName }, `🤖 Memanggil AI Gemini...`);
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });

      const prompt = `
Anda adalah asisten Yoyo Bakery yang ramah dan luwes. Analisis pesan: "${text}"

PRODUK TERSEDIA:
${productList}

CONTOH:
1. User: "nstr 2 dan bln 4 ya" -> {"intent": "ORDER", "items": [{"name": "nastar", "qty": 2, "action": "add"}, {"name": "bolen", "qty": 4, "action": "add"}]}
2. User: "gajadi nastar, ganti lidah kucing 1" -> {"intent": "ORDER", "items": [{"name": "nastar", "qty": 0, "action": "remove"}, {"name": "lidah kucing", "qty": 1, "action": "add"}]}
3. User: "pesen nastar" -> {"intent": "ORDER", "items": [{"name": "nastar", "qty": null, "action": "add"}]}

FORMAT JSON SAJA:
{
  "intent": "ORDER|CONFIRM|CANCEL|BACK|QUERY|QUESTION|OTHER",
  "items": [{"name": "nama_roti", "qty": 2, "action": "add/update/remove"}],
  "customerName": "nama jika ada",
  "notes": "catatan jika ada",
  "answer": "jawaban ramah jika intent QUESTION"
}

PENTING:
- SANGAT LUWES dengan singkatan/typo (nstr=nastar, bln=bolen, dll).
- JANGAN PERNAH MENEBAK varian jika pelanggan hanya menyebut nama umum. (Contoh: Jika pelanggan bilang "Nastar", tulis "nastar", JANGAN langsung tulis "Nastar Classic").
- Tetap keluarkan nama roti meskipun tidak ada di daftar.
- Jika tidak ada jumlah, beri "qty": null.
- Gunakan action: "remove" untuk pembatalan item.

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

async function aiParseOrder(text) {
  if (!text || text.trim().length === 0) return null;
  return quickIntentMatch(text) || matchFAQ(text) || await callGeminiAI(text);
}

module.exports = { aiParseOrder };
