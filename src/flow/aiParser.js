const logger = require('../utils/logger');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');
const db = require('../database/supabase');

// ============================================================
// LAYER 1: KEYWORD MATCH (100% GRATIS)
// ============================================================
const GREETINGS = /^(halo|hai|hi|hey|hello|assalamualaikum|assalamu'alaikum|selamat\s*(pagi|siang|sore|malam)|p|permisi|kak|min)(\s*(kak|min|bang|pak|bu))?[\s!?.]*$/i;
const ORDER_GREETINGS = /^\s*(aku\s+)?(mau\s*(pesan|pesen|order|beli)|pesan\s*dong|order\s*dong|beli\s*dong)(\s*(dong|kak|min|ya|yuk))?\s*[!?.]*$/i;
const CONFIRMS = /^(iya|ya|yaa|yaaa|yoi|yup|yep|yes|ok|oke|okey|okay|sip|siap|benar|betul|setuju|konfirmasi|lanjut|deal|gas|mantap|boleh|bisa|acc|fix|jadi|ayo|let'?s?\s*go)[\s!?.]*$/i;
const CANCELS = /^(batal|cancel|ga\s*jadi|gajadi|tidak|ngga|nggak|gak|no|nope|udah\s*deh|ga\s*usah|skip|stop)[\s!?.]*$/i;
const BACKS = /^(kembali|balik|back|ubah|revisi|ganti|mundur|ulangi|koreksi|salah|edit)[\s!?.]*$/i;
const THANKS = /^(makasih|terima\s*kasih|thanks|thank\s*you|thx|tq|tengkyu|nuhun|matur\s*nuwun)(?:\s*(banyak|banget))?(?:\s*(kak|min|bang|pak|bu|ya))?[\s!?.]*$/i;
const JAKARTA_REGION = /^1$|^satu$|\b(jakarta|jkt|jaksel|jakbar|jaktim|jakpus|jakut)\b/i;
const LUAR_JAKARTA = /^2$|^dua$|\b(luar\s*(jakarta|jkt|kota)?|bukan\s*(jakarta|jkt)|daerah|luar|bandung|surabaya|medan|semarang|jogja|bali|makassar|tangerang|tangsel|bekasi|depok|bogor|jabodetabek)\b/i;

function quickIntentMatch(text) {
  const t = text.trim();
  if (GREETINGS.test(t)) return { intent: 'GREETING', items: [], answer: 'Halo Kak! Selamat datang di Yoyo Bakery 🍞 Ada yang bisa kami bantu hari ini?' };
  if (ORDER_GREETINGS.test(t)) return { intent: 'GREETING', items: [], answer: 'Halo Kak! Siap, yuk langsung pesan! 😊' };
  if (JAKARTA_REGION.test(t)) return { intent: 'REGION_JAKARTA', items: [] };
  if (LUAR_JAKARTA.test(t)) return { intent: 'REGION_LUAR', items: [] };
  if (CONFIRMS.test(t))  return { intent: 'CONFIRM', items: [], answer: 'Siap Kak, pesanan dikonfirmasi! ✅' };
  if (CANCELS.test(t))   return { intent: 'CANCEL', items: [], answer: 'Baik Kak, pesanan dibatalkan. 🙏' };
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
  { keywords: ['ongkir', 'delivery'], answer: '🚚 Ongkir kurir Lalamove sesuai jarak (khusus area Jakarta). Kirim shareloc aja Kak nanti dihitung otomatis!' },
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
async function callGeminiAI(text, state = null) {
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

      // Build state context for AI
      let stateContext = '';
      if (state === 'REJECTED') {
        stateContext = `\nKONTEKS PERCAKAPAN:\n- Pelanggan ini sudah diketahui dari LUAR JAKARTA dan sudah DITOLAK untuk pesan via WhatsApp.\n- JANGAN PERNAH bilang "bisa pesan via WA" atau sejenisnya.\n- Jika ditanya soal pemesanan, SELALU jawab bahwa WA hanya untuk Jakarta dan arahkan ke Shopee.\n- Tetap ramah dan sopan.\n`;
      } else if (state === 'REGION_CHECK') {
        stateContext = `\nKONTEKS PERCAKAPAN:\n- Sistem sedang menanyakan apakah pelanggan di Jakarta atau luar Jakarta.\n- Jika pelanggan menyebut daerah, tentukan apakah itu Jakarta atau luar Jakarta.\n`;
      }

      const prompt = `
Anda adalah asisten Yoyo Bakery yang ramah dan luwes. Analisis pesan: "${text}"
${stateContext}

PRODUK TERSEDIA:
${productList}

ATURAN PRODUK (WAJIB DIIKUTI):
- Bolen: isi 10 pcs per kotak (semua varian bolen)
- Roll Cake: isi 10 pcs per kotak (semua varian roll)
- Roti: isi 4 pcs per kotak
- Mix HANYA tersedia untuk Roti Sisir, pilihannya: full Coklat ATAU full Keju (masing-masing 2 kotak, jadi 2-2)
- JANGAN mengarang aturan mix untuk produk selain Roti Sisir

ATURAN PENTING:
- Pemesanan via WhatsApp HANYA untuk area Jakarta. BUKAN Jabodetabek, BUKAN Tangerang/Bekasi/Depok/Bogor.
- Jika customer bertanya apakah bisa pesan via WA untuk luar Jakarta, TOLAK dengan sopan. Arahkan ke Shopee.
- Jangan pernah bilang "bisa pesan via WA" untuk daerah luar Jakarta.
- Jika customer ngeyel mau pesan via WA padahal luar Jakarta, tetap tolak dan arahkan ke Shopee.

CONTOH:
1. User: "nstr 2 dan bln 4 ya" -> {"intent": "ORDER", "items": [{"name": "nastar", "qty": 2, "action": "add"}, {"name": "bolen", "qty": 4, "action": "add"}]}
2. User: "gajadi nastar, ganti lidah kucing 1" -> {"intent": "ORDER", "items": [{"name": "nastar", "qty": 0, "action": "remove"}, {"name": "lidah kucing", "qty": 1, "action": "add"}]}
3. User: "pesen nastar" -> {"intent": "ORDER", "items": [{"name": "nastar", "qty": null, "action": "add"}]}
4. User: "lewat wa gabisa kak?" (konteks luar Jakarta) -> {"intent": "QUESTION", "items": [], "answer": "Maaf Kak, pemesanan via WhatsApp hanya untuk area Jakarta ya. Untuk luar Jakarta, Kakak bisa pesan melalui Shopee kami. 🙏"}

FORMAT JSON SAJA:
{
  "intent": "ORDER|CONFIRM|CANCEL|BACK|QUERY|GREETING|THANKS|QUESTION|FAQ|OTHER",
  "items": [{"name": "nama_roti", "qty": 2, "action": "add/update/remove"}],
  "customerName": "nama jika ada",
  "notes": "catatan jika ada",
  "answer": "WAJIB ISI! Jawaban ramah untuk SEMUA intent. Untuk ORDER bisa kosongkan, tapi untuk QUESTION/OTHER/GREETING/THANKS/FAQ/QUERY selalu isi jawaban yang informatif dan ramah."
}

PENTING:
- SANGAT LUWES dengan singkatan/typo (nstr=nastar, bln=bolen, dll).
- JANGAN PERNAH MENEBAK varian jika pelanggan hanya menyebut nama umum. (Contoh: Jika pelanggan bilang "Nastar", tulis "nastar", JANGAN langsung tulis "Nastar Classic").
- Tetap keluarkan nama roti meskipun tidak ada di daftar.
- Jika tidak ada jumlah, beri "qty": null.
- Gunakan action: "remove" untuk pembatalan item.

GAYA JAWABAN:
- JANGAN selalu memulai jawaban dengan "Halo Kak!". Variasikan pembukaan secara ALAMI sesuai konteks pesan.
- Contoh variasi: "Siap Kak!", "Boleh banget Kak!", "Oh iya Kak,", "Wah,", "Tentu Kak!", langsung jawab tanpa sapaan, dll.
- "Halo Kak!" HANYA untuk intent GREETING (sapaan awal). Untuk QUESTION/FAQ/OTHER, langsung jawab inti pertanyaannya.
- Jawaban harus ringkas, to the point, dan tidak bertele-tele.

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

async function aiParseOrder(text, state = null) {
  if (!text || text.trim().length === 0) return null;
  return quickIntentMatch(text) || matchFAQ(text) || await callGeminiAI(text, state);
}

module.exports = { aiParseOrder };
