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
async function callGeminiAI(text, state = null, ambiguousContext = null) {
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

  // Build state context for AI
  let stateContext = '';
  if (state === 'REJECTED') {
    stateContext = `\nKONTEKS PERCAKAPAN:\n- Pelanggan ini dari LUAR JAKARTA dan sudah DITOLAK pesan via WA.\n- JANGAN PERNAH bilang "bisa pesan via WA".\n- Arahkan ke Shopee. Tetap ramah.\n`;
  }
  
  let contextAddon = '';
  if (ambiguousContext && ambiguousContext.length > 0) {
    contextAddon = `\n[KONTEKS KLARIFIKASI PENTING]:\nSebelumnya bot bertanya kepada pelanggan untuk memperjelas pesanan berikut:\n${JSON.stringify(ambiguousContext)}\nJika pesan pelanggan ("${text}") hanya berisi angka (misal: "3 aja") atau pilihan singkat (misal: "yang keju"), pelanggan sedang menjawab pertanyaan di atas! Pahami maksudnya, gabungkan dengan produk di atas, lalu set intent="ORDER" dengan items yang tepat.`;
  }

  for (const modelName of modelNames) {
    try {
      logger.info({ model: modelName }, `🤖 Memanggil AI Gemini...`);
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });

      const prompt = `
Anda adalah asisten Yoyo Bakery yang cerdas, ramah, dan solutif. Analisis pesan pelanggan: "${text}"
${stateContext}${contextAddon}

PRODUK TERSEDIA:
${productList}

ATURAN BISNIS & FAQ (WAJIB DITAATI 100%):
- Jam Operasional: Senin - Sabtu: 08.00 - 20.00 WIB, Minggu: 09.00 - 18.00 WIB.
- Alamat Toko: ${config.store.address} (Bisa pickup ASALKAN SUDAH PESAN VIA WA TERLEBIH DAHULU). Tidak bisa datang mendadak.
- Pembayaran/Rekening: BCA ${config.payment.bcaNumber} a/n ${config.payment.bcaName}.
- Ongkir Lalamove: Sesuai jarak (khusus area Jakarta). Akan dihitung otomatis setelah pelanggan mengirim shareloc.
- Pengiriman HARI INI (Instan): BISA DILAKUKAN, TAPI HANYA untuk pesanan BOLEN (khusus area Jakarta).
- Pengiriman BESOK (PO H+1): Semua produk ROTI dan ROLL CAKE sistemnya PRE-ORDER H+1. Jika pesanan campur (Bolen + Roti), maka SEMUANYA otomatis ikut PO H+1.
- Estimasi Waktu Sampai (ETA): Jika ditanya jam berapa sampai, JAWAB: "Mohon maaf Kak, kami tidak bisa menentukan pesanan akan sampai jam berapa karena tergantung jarak dan kurir Lalamove. Namun pesanan Kakak akan segera kami proses pengirimannya setelah konfirmasi pembayaran berhasil (untuk pesanan Bolen hari ini) atau dikirim besok (untuk pesanan PO)." JANGAN suruh kirim shareloc lagi jika mereka bertanya ETA.
- Halal: 100% Halal.
- Promo/Diskon: Bisa ditanyakan ke Admin untuk pembelian jumlah banyak.
- Mix/Campur: HANYA tersedia untuk Roti Sisir (mix 1 kotak Coklat, 1 kotak Keju, minim beli 2 kotak). Bolen/Kue lain TIDAK BISA MIX rasa dalam 1 kotak.

ATURAN KLASIFIKASI INTENT:
1. Jika isi pesan murni/mayoritas menanyakan pertanyaan seputar produk, jam buka, toko, ongkir, dsb -> set intent "FAQ" dan JAWAB PERTANYAAN TERSEBUT SECARA LENGKAP & GABUNGKAN jika ada banyak pertanyaan sekaligus.
2. Jika pelanggan HANYA ingin dikirimkan gambar menu/katalog/pricelist -> set intent "SHOW_MENU" (kosongkan answer).
3. Jika pelanggan komplain, marah, mengumpat (misal: "admin mana", "lama banget") -> set intent "ADMIN" (kosongkan answer).
4. Jika pelanggan menjawab singkat (misal: "oke", "ok", "sip", "baik", "sudah", "ya", "benar") -> JIKA konteksnya sedang ditanya konfirmasi pesanan, set intent "CONFIRM" (kosongkan answer). Jika konteksnya BUKAN konfirmasi, set intent "ACKNOWLEDGE".
5. Jika pelanggan mengetik "mulai" -> set intent "ONBOARD_START".
6. Jika pelanggan menyebutkan nama makanan (contoh: "brownies 1", "roti sisir 2"), TETAP EKSTRAK ke dalam array "items" dengan intent "ORDER" meskipun nama makanan tersebut TIDAK ADA di PRODUK TERSEDIA. Sistem kami yang akan memvalidasinya nanti!

ATURAN EKSTRAKSI ORDER (Jika intent = ORDER):
- Bolen: isi 10 pcs per kotak (semua varian bolen)
- Roll Cake: isi 10 pcs per kotak (semua varian roll)
- Roti: isi 4 pcs per kotak
- JANGAN MENEBAK varian jika pelanggan hanya sebut nama umum (Contoh: "Nastar" → tulis "nastar", JANGAN "Nastar Classic").
- Jika tidak ada jumlah, beri "qty": null.
- Gunakan action: "remove" untuk pembatalan item.

CONTOH JSON JAWABAN:
{"intent": "FAQ", "items": [], "customerName": null, "notes": null, "answer": "Iya Kak, untuk menu Roti Sisir bisa di mix! 😊 Dan untuk pesanan Kakak, bisa dikirim HARI INI asal isinya Bolen saja ya Kak."}

FORMAT JSON SAJA:
{
  "intent": "ORDER|CONFIRM|CANCEL|BACK|QUERY|GREETING|THANKS|FAQ|SHOW_MENU|OTHER|ACKNOWLEDGE|ADMIN|ONBOARD_START",
  "items": [{"name": "nama_roti", "qty": 2, "action": "add/update/remove"}],
  "customerName": "nama jika ada",
  "notes": "catatan jika ada",
  "answer": "WAJIB ISI untuk FAQ/GREETING/THANKS/OTHER. Untuk ORDER boleh kosong."
}

GAYA JAWABAN:
- JANGAN selalu mulai dengan "Halo Kak!". Variasikan: "Siap Kak!", "Boleh banget!", atau langsung jawab intinya.
- Jawaban ringkas dan to the point.

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

async function aiParseOrder(text, state = null, ambiguousContext = null) {
  if (!text || text.trim().length === 0) return null;
  return quickIntentMatch(text) || await callGeminiAI(text, state, ambiguousContext);
}

module.exports = { aiParseOrder };
