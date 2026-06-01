const logger = require("../utils/logger");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("../config");
const db = require("../database/supabase");

// ============================================================
// LAYER 1: REGEX CEPAT UNTUK INTENT DASAR
// ============================================================
const GREETINGS = /^(halo|hi|hai|pagi|siang|sore|malam|assalamu|ping|p)$/i;
const ORDER_GREETINGS =
  /^(pesan|order|mau beli|beli|mau pesen|pesen|mau order)$/i;
const CONFIRMS = /^(konfirmasi|benar|betul|iya|yak|yep|ya bener|sudah benar)$/i;
const CANCELS = /^(batal|cancel|ngga jadi|tidak jadi|kembali|ulang|ubah)$/i;
const BACKS = /^(kembali|back|ubah|edit)$/i;
const THANKS = /^(makasih|terima kasih|thanks|tq|suwun|thank you|nuhun)$/i;
const ACKNOWLEDGES =
  /^(ok|oke|okee|okey|sip|siap|baik|baiklah|ya|ngga ada|tidak ada|udah|sudah|👍|🙏)$/i;
const COMPLAINS =
  /^(monyet|anjing|babi|bangsat|lama banget|rusak|basi|admin|cs|kecewa)$/i;
const MULAIS = /^(mulai|start|gas)$/i;

function quickIntentMatch(text) {
  const t = text.trim();
  if (MULAIS.test(t)) return { intent: "ONBOARD_START", items: [] };
  if (ACKNOWLEDGES.test(t)) return { intent: "ACKNOWLEDGE", items: [] };
  if (COMPLAINS.test(t)) return { intent: "ADMIN", items: [] };
  if (GREETINGS.test(t))
    return {
      intent: "GREETING",
      items: [],
      answer:
        "Halo Kak! Selamat datang di Yoyo Bakery 🍞 Ada yang bisa kami bantu hari ini?",
    };
  if (ORDER_GREETINGS.test(t))
    return {
      intent: "ORDER",
      items: [],
      answer: "Siap Kak! Yuk langsung pesan! 😊",
    };
  if (CONFIRMS.test(t))
    return {
      intent: "CONFIRM",
      items: [],
      answer: "Siap Kak, pesanan dikonfirmasi! ✅",
    };
  if (CANCELS.test(t))
    return {
      intent: "CANCEL",
      items: [],
      answer: "Baik Kak, pesanan dibatalkan. 🙏",
    };
  if (BACKS.test(t)) return { intent: "BACK", items: [] };
  if (THANKS.test(t))
    return {
      intent: "THANKS",
      items: [],
      answer:
        "Sama-sama Kak! 😊 Senang bisa membantu. Jangan ragu hubungi kami lagi ya! 🍞",
    };
  return null;
}

// ============================================================
// LAYER 2: FAQ & QUICK MATCH DIHAPUS (Dialihkan ke Gemini agar lebih cerdas)

// ============================================================
// LAYER 3: GEMINI AI
// ============================================================
async function callGeminiAI(
  text,
  state = null,
  ambiguousContext = null,
  activeOrderContext = "",
  history = [],
) {
  const apiKey = config.geminiApiKey?.trim();
  if (!apiKey) {
    logger.error("❌ GEMINI_API_KEY tidak ditemukan di .env!");
    return null;
  }

  const modelNames = [
    "gemini-3.1-flash-lite",
    "gemini-3.1-flash",
    "gemini-3.0-flash",
    "gemini-3.1-flash-lite-preview",
    "gemini-2.5-flash",
  ];

  let productList = "Daftar produk tidak tersedia saat ini.";
  try {
    const products = await db.getProducts();
    if (products && products.length > 0) {
      productList = products
        .map(
          (p) =>
            `- ${p.name} (Rp ${p.price}) [Status: ${p.stock_type === "ready" ? "Tersedia / Bisa Kirim Hari Ini" : "Pre-Order"}]`,
        )
        .join("\n");
    }
  } catch (err) {
    logger.warn(
      { err: err.message },
      "⚠️ Gagal mengambil produk untuk AI, menggunakan fallback.",
    );
  }

  let faqList = "";
  try {
    const faqs = await db.getFaqs();
    if (faqs && faqs.length > 0) {
      faqList = faqs.map((f) => `- ${f.question}: ${f.answer}`).join("\n");
    }
  } catch (err) {
    logger.warn(
      { err: err.message },
      "⚠️ Gagal mengambil FAQ untuk AI, menggunakan fallback.",
    );
  }

  let bolenSoldOutToday = false;
  try {
    const bolenSetting = await db.getGlobalSetting("bolen_sold_out_today");
    if (bolenSetting === "true") bolenSoldOutToday = true;
  } catch (err) {}

  let holidays = [];
  try {
    const holidaySetting = await db.getGlobalSetting("holiday_dates");
    if (holidaySetting) holidays = JSON.parse(holidaySetting);
  } catch (err) {}

  // Compute next shipping dates skipping holidays
  const computeNextShipping = (daysToAdd) => {
    let date = new Date();
    let added = 0;
    while (added < daysToAdd) {
      date.setDate(date.getDate() + 1);
      // Format YYYY-MM-DD in Jakarta Time
      const dateStr = date.toLocaleDateString("en-CA", {
        timeZone: "Asia/Jakarta",
      });
      if (!holidays.includes(dateStr)) {
        added++;
      }
    }
    return date;
  };

  const nextDate = computeNextShipping(1);
  const nonaManisDate = computeNextShipping(2);
  const dateOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Jakarta",
  };
  const nextShippingStr = nextDate.toLocaleDateString("id-ID", dateOptions);
  const nonaManisShippingStr = nonaManisDate.toLocaleDateString(
    "id-ID",
    dateOptions,
  );
  const todayStr = new Date().toLocaleDateString("id-ID", dateOptions);

  let holidayContext = "";
  if (holidays && holidays.length > 0) {
    const formattedHolidays = holidays.map((h) => {
      // Create date object correctly recognizing YYYY-MM-DD
      const d = new Date(h + "T00:00:00+07:00");
      return d.toLocaleDateString("id-ID", dateOptions);
    });
    holidayContext = `\n- JADWAL LIBUR TOKO (TUTUP & TIDAK ADA PENGIRIMAN): ${formattedHolidays.join(", ")}. Jika pelanggan bertanya tentang pengiriman pada tanggal ini atau komplain mengapa pengirimannya bukan besok, jelaskan dengan ramah bahwa toko kami memang sedang LIBUR pada tanggal tersebut.`;
  }

  // Build state context for AI
  let stateContext = "";
  if (state === "REJECTED") {
    stateContext = `\nKONTEKS PERCAKAPAN:\n- Pelanggan ini dari LUAR JAKARTA.\n- TUGAS ANDA: Sampaikan dengan ramah bahwa pengiriman kami baru mencakup Jakarta, TETAPI mereka MASIH BISA memesan produk melalui Shopee di link berikut: ${config.shopeeUrl || "https://shopee.co.id/yoyobakery"}. Jangan tolak secara mentah-mentah, langsung arahkan pesanan ke Shopee saja.\n`;
  } else if (
    state === "CONFIRM" ||
    state === "LOCATION" ||
    state === "PAYMENT"
  ) {
    stateContext = `\nKONTEKS PERCAKAPAN:\n- Pelanggan SUDAH SELESAI memilih pesanan dan sedang berada di tahap penyelesaian (konfirmasi/shareloc/bayar).\n- PENTING: JANGAN menambahkan pesanan baru (JANGAN set intent "ORDER") kecuali pelanggan secara TEGAS menggunakan kata 'tambah', 'jadi [angka]', dll. Jika mereka hanya menyebutkan pesanan untuk memastikan, set intent "FAQ" atau "QUERY".\n`;
  }

  let contextAddon = "";
  if (ambiguousContext && ambiguousContext.length > 0) {
    contextAddon += `\n[KONTEKS KLARIFIKASI PENTING]:\nSebelumnya bot bertanya kepada pelanggan untuk memperjelas pesanan berikut:\n${JSON.stringify(ambiguousContext)}\nJika pesan pelanggan ("${text}") hanya berisi angka (misal: "3 aja") atau pilihan singkat (misal: "yang keju"), pelanggan sedang menjawab pertanyaan di atas! Pahami maksudnya, gabungkan dengan produk di atas, lalu set intent="ORDER" dengan items yang tepat.`;
  }
  if (activeOrderContext && activeOrderContext.length > 0) {
    contextAddon += activeOrderContext;
  }

  if (history && history.length > 0) {
    historyAddon = `\nRIWAYAT PERCAKAPAN TERAKHIR:\n${history.map((h) => `[${h.role.toUpperCase()}]: ${h.content}`).join("\n")}\n`;
  }

  let bolenContext = "";
  if (bolenSoldOutToday) {
    bolenContext = `\n[INFO PENTING HARI INI]:\nKhusus HARI INI, pengiriman instan untuk BOLEN (Bolen Lilit, dll) sedang KOSONG/HABIS karena hari ini kami hanya mengirimkan bolen untuk antrean PO kemarin. JIKA pelanggan mencoba memesan Bolen (baik lilit atau lainnya) untuk dikirim hari ini, beri tahu mereka secara sopan bahwa bolen hari ini habis dan pesanan bolen mereka otomatis akan dikirim ${nextShippingStr}. Catat saja pesanannya dengan wajar, tidak usah menolak, cukup berikan informasi tersebut di 'answer'. Jika tidak ada bolen dalam pesanan mereka, abaikan info ini.\n`;
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

ATURAN WAKTU & PENGIRIMAN (SANGAT PENTING):
- HARI INI ADALAH: ${todayStr} (Waktu Indonesia Barat).${holidayContext}
- UNTUK PRODUK DENGAN STATUS "Pre-Order" (selain Nona Manis dan Kue Soes): Pengiriman terdekat berikutnya adalah H+1 yaitu: ${nextShippingStr}. Anda WAJIB menyebutkan nama hari pengirimannya secara eksplisit.
- KHUSUS produk "Nona Manis" dan "Kue Soes" adalah sistem Pre-Order H+2. Pengiriman terdekat untuk kedua produk ini adalah: ${nonaManisShippingStr}. Anda WAJIB menyebutkannya secara eksplisit.
- UNTUK PRODUK DENGAN STATUS "Tersedia / Bisa Kirim Hari Ini": Produk ini BISA DIKIRIM HARI INI. JANGAN sebutkan ini Pre-Order. Jika pelanggan pesan hari ini, sampaikan bahwa produk akan dikirim hari ini juga.
- Selalu beritahu pelanggan aturan pengiriman ini dengan sopan saat mereka selesai memesan atau saat mereka bertanya kapan dikirim.

ATURAN OUTPUT JSON:
1. Pastikan valid JSON. TIDAK BOLEH ada teks di luar JSON (tanpa markdown).

PRODUK TERSEDIA:
${productList}

ATURAN KOMPLAIN / CEK STATUS PESANAN:
- JIKA pelanggan menanyakan status pesanan, dan Anda TIDAK MELIHAT 'INFO PESANAN AKTIF' pada konteks yang diberikan, Anda DILARANG meminta nama atau nomor HP mereka (karena Anda tidak punya akses ke sistem pencarian).
- Jawablah dengan sopan bahwa Anda tidak menemukan pesanan aktif pada nomor WhatsApp ini, lalu gunakan intent "ADMIN" agar percakapan diteruskan ke admin manusia yang bisa memeriksanya secara manual.

ATURAN BISNIS & FAQ (WAJIB DITAATI 100%):
- Shopee: Jika ditanya tentang Shopee/Toko Online atau jika pengiriman ke luar Jakarta, WAJIB arahkan untuk order ke Shopee dan berikan link ini: ${config.shopeeUrl || "https://shopee.co.id/yoyobakery"}
${faqList}
ATURAN KLASIFIKASI INTENT:
1. Jika pelanggan menyebutkan nama kota, kecamatan, provinsi, atau daerah pengiriman -> set intent "REGION_MATCH" dan tentukan apakah daerah tersebut masuk area Jakarta (DKI Jakarta) atau luar Jakarta. Isi field "region" dengan "jakarta" atau "luar_jakarta". JIKA "luar_jakarta", maka WAJIB isi "answer" dengan pemberitahuan bahwa mereka tetap MASIH BISA MEMESAN melalui Shopee dan berikan link Shopee.
2. Jika pelanggan menanyakan daftar menu, harga, katalog -> set intent "SHOW_MENU" (kosongkan answer).
3. Jika isi pesan murni/mayoritas menanyakan FAQ -> set intent "FAQ" dan JAWAB SECARA LENGKAP & SOPAN.
4. Jika pelanggan komplain atau merevisi pesanan yang sudah dibayar -> set intent "ADMIN" (kosongkan answer).
5. Jika pelanggan memiliki PESANAN AKTIF dan hanya menanyakan status -> set intent "FAQ" atau "ADMIN". JANGAN set "ORDER".
6. Jika pelanggan menjawab singkat (misal: "oke", "ok", "sip", "sudah", "ya") -> JIKA konteksnya sedang ditanya konfirmasi, set intent "CONFIRM". Jika bukan, set intent "ACKNOWLEDGE".
7. Jika pelanggan mengetik "mulai" -> set intent "ONBOARD_START".
8. Jika pelanggan menyebutkan nama makanan untuk pesanan baru, ekstrak ke array "items" dengan intent "ORDER".

ATURAN EKSTRAKSI ORDER & PENYEBUTAN PRODUK (Jika intent = ORDER):
- Bolen/Roll Cake/Nona Manis: 10 pcs per kotak. Roti (termasuk Roti Sisir): 4 pcs per bungkus/kotak. Jangan pernah sebut isinya 5!
- KONVERSI SATUAN PENTING: Harga kami adalah PER KOTAK/BOX. Jika pelanggan memesan dengan sebutan "biji" / "pcs" / "buah", Anda WAJIB mengkonversinya ke jumlah box!
  Contoh: "nona manis 10 biji" -> 1 box (qty: 1).
  Contoh: "bolen lilit 20 pcs" -> 2 box (qty: 2).
  Contoh: "roti sisir 4 buah" -> 1 box (qty: 1).
  JANGAN PERNAH mengisi qty: 10 jika maksud pelanggan adalah 10 biji (1 box)!
- JIKA Anda harus memberikan penjelasan panjang mengenai daftar pilihan varian/menu, WAJIB gunakan format daftar ke bawah (bullet points atau nomor 1, 2, 3). JANGAN menggunakan format paragraf panjang yang menyambung agar pelanggan mudah membacanya.
- Gunakan action: "remove" untuk pembatalan item.
- Gunakan action: "update" jika pelanggan bermaksud MENGUBAH / MENGGANTI jumlah pesanan yang sudah ada di keranjang menjadi jumlah baru, ATAU jika mereka mengulangi pesanan mereka (re-listing) untuk mengoreksi kesalahan (contoh: "jadinya nastar 1 aja", "kue soes 1, sisir keju 1 ya", atau menyebut daftar "1. kue soes 1. sisir keju").
- Gunakan action: "add" HANYA jika pelanggan dengan tegas menyatakan ingin MENAMBAH pesanan (contoh: "tambah nastar 1"). Jika tidak ada kata tambah, dan pelanggan berada di tahap konfirmasi/lokasi, asumsikan mereka sedang mengoreksi pesanan (gunakan "update").
- KHUSUS intent CANCEL: JIKA pelanggan membatalkan KARENA ONGKIR MAHAL, berikan alternatif link Shopee (${config.shopeeUrl || "https://shopee.co.id/yoyobakery"}) untuk ongkir yang lebih hemat.

CONTOH JSON JAWABAN:
{"intent": "FAQ", "items": [], "customerName": null, "notes": null, "answer": "Ada dong Bu! Ibu bisa langsung mampir ke toko Shopee kami di link berikut ya: https://shopee.co.id/yoyobakery 😊"}

FORMAT JSON SAJA:
{
  "intent": "ORDER|CONFIRM|CANCEL|BACK|QUERY|GREETING|THANKS|FAQ|SHOW_MENU|OTHER|ACKNOWLEDGE|ADMIN|ONBOARD_START|REGION_MATCH",
  "items": [{"name": "nama_roti", "qty": 2, "action": "add/update/remove"}],
  "customerName": "HANYA NAMA ORANG pelanggan/penerima (contoh: Budi). JANGAN masukkan alamat, nomor HP, atau kata lain. Jika tidak ada, null.",
  "customerPhone": "nomor HP JIKA pelanggan mengoreksi/memberikan nomor HP (contoh: 0812345). Jika tidak ada, null.",
  "notes": "catatan pesanan jika ada",
  "address": "HANYA teks ALAMAT PENGIRIMAN jika diketik eksplisit. JANGAN masukkan nama orang. Jika tidak ada, null.",
  "region": "jakarta|luar_jakarta",
  "answer": "WAJIB ISI untuk FAQ/GREETING/THANKS/OTHER/REGION_MATCH."
}

GAYA JAWABAN:
- Gunakan bahasa yang sopan, sabar, dan mudah dipahami orang tua.
- SANGAT PENTING: Jawab dengan SANGAT RINGKAS, padat, dan jelas. MAKSIMAL 2-3 kalimat pendek saja. Jangan berbasa-basi kepanjangan.
- WAJIB gunakan bullet points jika melist banyak varian/produk agar ringkas.

HANYA JSON.`;

      const result = await model.generateContent(prompt);
      const resText = result.response.text();
      logger.info({ model: modelName, response: resText }, "✅ AI Response");

      const match = resText.match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : null;
    } catch (err) {
      logger.warn({ model: modelName, error: err.message }, "⚠️ AI Error");
      continue;
    }
  }
  return null;
}

async function aiParseOrder(
  text,
  state = null,
  ambiguousContext = null,
  activeOrderContext = "",
  history = [],
) {
  if (!text || text.trim().length === 0) return null;
  return (
    quickIntentMatch(text) ||
    (await callGeminiAI(
      text,
      state,
      ambiguousContext,
      activeOrderContext,
      history,
    ))
  );
}

module.exports = { aiParseOrder };
