const { handleCustomerMessage } = require('../src/flow/customerFlow');
const sender = require('../src/whatsapp/sender');

// Mematikan (Mocking) fungsi kirim pesan WhatsApp aslinya, 
// agar pesan simulasi hanya dicetak di layar/console, bukan dikirim ke WA beneran.
sender.sendText = async (to, text) => {
  console.log(`\n[BOT MENGIRIM KE ${to}]:\n${text}\n----------------------`);
  return true;
};
sender.sendImage = async (to, buffer, caption) => {
  console.log(`\n[BOT MENGIRIM GAMBAR KE ${to}]:\n${caption}\n----------------------`);
  return true;
};

// Fungsi pembantu untuk membuat jeda/delay
const delay = ms => new Promise(res => setTimeout(res, ms));

async function runSimulation() {
  console.log('🚀 MEMULAI SIMULASI 10 PELANGGAN BERSAMAAN...\n');

  // Daftar 10 pelanggan fiktif dengan pesan yang berbeda-beda
  const customers = [
    { from: '62811111101@s.whatsapp.net', name: 'Agus', text: 'halo pesan bolen 2 dong' },
    { from: '62811111102@s.whatsapp.net', name: 'Budi', text: 'toko buka jam berapa?' },
    { from: '62811111103@s.whatsapp.net', name: 'Citra', text: 'ada menu apa aja kak' },
    { from: '62811111104@s.whatsapp.net', name: 'Dewi', text: 'mau pesen nastar 1 kirim ke jakarta pusat' },
    { from: '62811111105@s.whatsapp.net', name: 'Eko', text: 'batal' }, // Skenario batal
    { from: '62811111106@s.whatsapp.net', name: 'Fani', text: 'pesan roti sisir coklat 3 box' },
    { from: '62811111107@s.whatsapp.net', name: 'Gita', text: 'alamat tokonya di mana ya?' },
    { from: '62811111108@s.whatsapp.net', name: 'Hadi', text: 'aku pesen bolen 1 sama roll cake 1 ya' },
    { from: '62811111109@s.whatsapp.net', name: 'Indah', text: 'halo siang' },
    { from: '62811111110@s.whatsapp.net', name: 'Joko', text: 'min kok pesenan saya lama banget sampenya' } // Skenario marah/komplain
  ];

  // Eksekusi semua pesan secara BERSAMAAN (Paralel / Concurrent) dalam 1 milidetik yang sama
  const promises = customers.map(customer => {
    console.log(`[PELANGGAN] ${customer.name} mengirim: "${customer.text}"`);
    // Simulasi memanggil "otak" bot secara langsung
    return handleCustomerMessage(customer.from, customer.name, { text: { body: customer.text } });
  });

  // Tunggu semua proses selesai
  await Promise.all(promises);

  console.log('\n✅ SIMULASI SELESAI!');
  process.exit(0);
}

// Jalankan fungsi simulasi
runSimulation();
