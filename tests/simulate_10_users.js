require('dotenv').config();
const { handleCustomerMessage } = require('../src/flow/customerFlow');
const db = require('../src/database/supabase');
const sender = require('../src/whatsapp/sender');

sender.sendText = async (to, text) => {
  console.log(`\n🟢 [BOT -> ${to}]:\n${text}\n`);
};
sender.sendImage = async (to, buffer, caption) => {
  console.log(`\n🟢 [BOT -> ${to} (GAMBAR)]:\n${caption}\n`);
};

const SCENARIOS = [
  {
    name: "Ahmad (Gaul)", 
    phone: "628999900001",
    messages: ["halo bro", "1", "mau pesen bolcok 2 dan ns 1", "jakarta selatan fatmawati"]
  },
  {
    name: "Budi (Ditolak)", 
    phone: "628999900002",
    messages: ["Pagi", "bandung", "yah sayang banget"]
  },
  {
    name: "Citra (Ambigu Bolen)", 
    phone: "628999900003",
    messages: ["hi", "jakarta", "beli bolen 1", "bolen coklat", "alamat di sudirman"]
  },
  {
    name: "Deni (Langsung Alamat)", 
    phone: "628999900004",
    messages: ["Halo yoyo bakery", "dki jakarta", "saya mau beli bolju 2 dikirim ke kalibata city tower akasia"]
  },
  {
    name: "Euis (Ambil Sendiri)", 
    phone: "628999900005",
    messages: ["halo", "jakarta", "pesan nastar 1", "nanti saya pickup jam 3", "08123456"]
  },
  {
    name: "Fajar (Revisi)", 
    phone: "628999900006",
    messages: ["halo", "1", "beli nonis 2", "jl kemang raya", "ubah pesanan", "tambah bolen keju 1"]
  },
  {
    name: "Gina (Angka & Typo)", 
    phone: "628999900007",
    messages: ["halo", "1", "bli bln full cklat 1 ajah", "tebet barat"]
  },
  {
    name: "Hadi (Full Format)", 
    phone: "628999900008",
    messages: ["halo", "jakarta", "Nama: Hadi\nPesanan: ks 2\nPengiriman: Kirim\nAlamat: Monas\nNo HP: 08111\nCatatan: yg gurih"]
  },
  {
    name: "Intan (Banyak Tanya)", 
    phone: "628999900009",
    messages: ["halo", "jakarta", "menu apa aja?", "oh gitu, pesen nonis 1", "senayan"]
  },
  {
    name: "Joko (Pembatalan)", 
    phone: "628999900010",
    messages: ["halo", "1", "bolen coklat 2", "batal"]
  }
];

async function run() {
  for (const s of SCENARIOS) {
    console.log(`\n\n======================================================`);
    console.log(`🚀 SKENARIO: ${s.name} (${s.phone})`);
    console.log(`======================================================`);
    
    // Reset session
    await db.deleteSession(s.phone);

    for (const msg of s.messages) {
      console.log(`\n👤 [USER ${s.name}]: ${msg}`);
      await handleCustomerMessage(s.phone, s.name, { text: { body: msg } });
      await new Promise(r => setTimeout(r, 100)); // Tanpa jeda lama
    }
  }
  
  console.log("\n✅ SIMULASI SELESAI.");
  process.exit(0);
}

run();
