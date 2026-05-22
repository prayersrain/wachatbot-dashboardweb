const { handleCustomerMessage } = require('../src/flow/customerFlow');
const sender = require('../src/whatsapp/sender');
const fs = require('fs');

let mdLog = '# Hasil Simulasi E2E\n\n';
function appendLog(text) {
  console.log(text);
  mdLog += text + '\n';
}

// Mematikan koneksi WhatsApp asli agar hanya jalan di Console
sender.sendText = async (to, text) => {
  appendLog(`\n🤖 **[BOT ➔ ${to}]**:\n> ${text.replace(/\n/g, '\n> ')}\n---`);
  return true;
};
sender.sendImage = async (to, buffer, caption) => {
  appendLog(`\n🤖 **[BOT ➔ ${to} (GAMBAR)]**:\n> ${caption.replace(/\n/g, '\n> ')}\n---`);
  return true;
};

const delay = ms => new Promise(res => setTimeout(res, ms));

// ==========================================
// MENGHASILKAN 50 PELANGGAN BERVARIASI
// ==========================================
const scenarios = [];

const archetypes = [
  // 1. Pembeli Langsung (Lancar)
  [{ wait: 1000, text: "pesan bolen coklat 2" }, { wait: 15000, text: "jakarta" }, { wait: 20000, text: "konfirmasi" }],
  
  // 2. Pembeli Labil (Ganti pesanan)
  [{ wait: 1500, text: "mau pesan nastar 1" }, { wait: 18000, text: "eh gajadi nastar, ganti bolen keju 2 aja" }, { wait: 25000, text: "bekasi" }, { wait: 30000, text: "konfirm" }],
  
  // 3. Hanya Bertanya (Basa-basi)
  [{ wait: 2000, text: "halo min ada menu apa aja ya?" }, { wait: 15000, text: "toko bukanya jam berapa?" }, { wait: 20000, text: "oke makasih infonya" }],
  
  // 4. Orang Luar Kota (Ditolak)
  [{ wait: 2500, text: "pesen roll cake 3 box" }, { wait: 16000, text: "kirim ke bandung ya kak" }, { wait: 22000, text: "yah jauh ya, oke deh aku pesen di shopee aja" }],
  
  // 5. Tukang Komplain
  [{ wait: 1200, text: "min kok pesanan saya belum sampai dari kemarin ya?" }, { wait: 18000, text: "tolong di cek ya nomer pesanan saya 123" }],

  // 6. Nanya Alamat Toko & Pickup
  [{ wait: 1800, text: "alamat tokonya di mana kak?" }, { wait: 16000, text: "oh deket, bisa ambil sendiri (pickup) ngga pesenannya?" }],

  // 7. Pesanan Ambigu (Bot harus klarifikasi)
  [{ wait: 1400, text: "pesen roti 2 kak" }, { wait: 17000, text: "roti sisir yang original maksudnya" }, { wait: 25000, text: "depok" }],

  // 8. Beli Campur-campur (Multiple Items)
  [{ wait: 2200, text: "mau pesan kue soes 1 box sama brownies 1 ya" }, { wait: 19000, text: "jakarta pusat" }, { wait: 24000, text: "lanjut" }],

  // 9. Cuma Nyapa & Minta Menu
  [{ wait: 1000, text: "selamat pagi min" }, { wait: 15000, text: "mau lihat daftar menu rotinya dong" }],

  // 10. Mengurangi Pesanan (Remove item)
  [{ wait: 1700, text: "pesan bolen 2 dan nastar 1 ya" }, { wait: 18000, text: "eh maaf kak, batalin yang nastarnya deh, bolennya aja" }, { wait: 26000, text: "jakarta barat" }, { wait: 30000, text: "oke bener" }],

  // 11. Batal Total (Cancel Flow)
  [{ wait: 2100, text: "pesan marmer cake 1 dong" }, { wait: 16000, text: "aduh maaf kak uangnya kepake, batalin aja pesanan saya ya" }],

  // 12. Nanya Halal & Langsung Pesan
  [{ wait: 1300, text: "permisi, kuenya disini 100% halal ngga ya?" }, { wait: 15000, text: "alhamdulillah, kalau gitu mau pesan roti abon ayam 1 ya" }, { wait: 22000, text: "tangerang" }],

  // 13. Nanya Ongkir Dulu
  [{ wait: 2600, text: "kak ongkir ke bogor kira-kira berapa ya?" }, { wait: 18000, text: "oh masuk jakarta ya itungannya? yaudah pesen bolu potong 1 kirim ke bogor" }],

  // 14. Pesanan Partai Besar (Bulk)
  [{ wait: 1100, text: "mau pesan roti sisir original 50 box buat acara arisan bisa?" }, { wait: 19000, text: "jakarta timur" }, { wait: 23000, text: "sip konfirmasi" }],

  // 15. Pelanggan Ngebut (Pesanan + Alamat langsung)
  [{ wait: 1600, text: "halo pesen bolen coklat keju 1 kirim ke jl sudirman no 10 jakarta ya" }, { wait: 16000, text: "konfirmasi" }],

  // 16. Pelanggan Berterima Kasih
  [{ wait: 2400, text: "kak terima kasih banyak ya, kemarin kuenya enak banget" }, { wait: 16000, text: "nanti kapan-kapan saya order lagi" }],

  // 17. Typo Parah (Uji Kepintaran AI)
  [{ wait: 1900, text: "pesam blen colkt 1 sm chse roll 1 y bg" }, { wait: 17000, text: "jkrta sltan" }, { wait: 22000, text: "ok" }],

  // 18. Minta Rekomendasi
  [{ wait: 1500, text: "kak ada rekomendasi roti yang paling laris dan enak ngga?" }, { wait: 16000, text: "wah boleh deh mau pesan yang itu 1 aja" }, { wait: 23000, text: "jakarta utara" }],

  // 19. Update Kompleks (Tambah, Ubah Qty)
  [{ wait: 2800, text: "pesan nastar 1" }, { wait: 17000, text: "tambahin bolen coklat 1 dong" }, { wait: 24000, text: "oh iya nastarnya jadiin 2 box ya" }, { wait: 31000, text: "jakarta" }],

  // 20. Bertele-tele ngetik Alamat
  [{ wait: 2300, text: "pesan bolen 1 kak" }, { wait: 18000, text: "dikirimnya ke rumahku ya kak di daerah jakarta pokoknya" }, { wait: 26000, text: "konfirmasi aja deh" }],

  // 21. Curhat Panjanng Lebar (Menyembunyikan pesanan)
  [{ wait: 3000, text: "halo min, aduh hari ini panas banget ya pengen yang manis-manis, tadinya mau beli es krim tapi mikir lagi mending makan kue aja sekeluarga, jadi tolong pesankan brownies 2 box ya buat anak saya" }, { wait: 15000, text: "jakarta" }],

  // 22. Cek Ketersediaan Stok
  [{ wait: 1500, text: "kak bolu potongnya masih ready ngga ya buat hari ini?" }, { wait: 14000, text: "syukurlah, pesen 1 ya" }, { wait: 20000, text: "jakarta pusat" }],

  // 23. Nanya Harga Spesifik
  [{ wait: 1200, text: "roti sisir yang full keju harganya berapaan kak per box?" }, { wait: 13000, text: "oh 58rb ya oke pesen itu aja 1" }, { wait: 18000, text: "depok" }],

  // 24. Nanya Kapan Sampai (Delivery Time Inquiry)
  [{ wait: 1600, text: "kalau pesen bolen coklat sekarang, kira-kira sampainya kapan kak?" }, { wait: 17000, text: "oh bisa instan ya, pesen 2 deh" }, { wait: 22000, text: "jakarta selatan" }],

  // 25. Pelanggan Kaku (Jawab seadanya berulang-ulang)
  [{ wait: 1100, text: "pesan marmer cake 1" }, { wait: 12000, text: "jakarta" }, { wait: 15000, text: "iya" }, { wait: 17000, text: "benar" }]
];

// Kita buat 25 orang pas, masing-masing memegang 1 skenario unik
let phoneCounter = 100;
for (let i = 0; i < 25; i++) {
  scenarios.push({
    name: `Pelanggan-${i+1}`,
    phone: `62899999${phoneCounter++}@s.whatsapp.net`,
    messages: JSON.parse(JSON.stringify(archetypes[i]))
  });
}

async function simulateConversation(customer) {
  appendLog(`\n### 🟢 MASUK: ${customer.name}\n*(Skenario Tipe ${customer.messages.length} chat) memulai obrolan...*`);

  for (let i = 0; i < customer.messages.length; i++) {
    const msg = customer.messages[i];
    
    // Tunggu pelanggan memikirkan ketikannya (tetap dipertahankan agar natural)
    await delay(msg.wait);
    
    appendLog(`\n👤 **[${customer.name}]** mengetik:\n\`\`\`text\n${msg.text}\n\`\`\``);
    
    // Eksekusi ke otak bot
    await handleCustomerMessage(customer.phone, customer.name, { text: { body: msg.text } });
  }
}

async function runMassiveSimulation() {
  appendLog(`🚀 **MEMULAI SIMULASI BERINGAS**: ${scenarios.length} PELANGGAN MASUK BERSAMAAN TANPA JEDA!\n`);

  // Jalankan semua fungsi secara paralel
  const allConversations = scenarios.map(customer => simulateConversation(customer));

  // Tunggu sampai kelima puluh orang selesai semua urusannya
  await Promise.all(allConversations);

  appendLog('\n✅ **SIMULASI MASIF SELESAI!**');
  
  // Tulis ke file MD
  fs.writeFileSync('simulation-log.md', mdLog);
  console.log('\n📁 Log percakapan lengkap telah disimpan di: simulation-log.md');
  process.exit(0);
}

runMassiveSimulation();
