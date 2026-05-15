# 🍞 Yoyo Bakery WhatsApp Bot

Bot WhatsApp pintar (AI-Powered) untuk otomatisasi pemesanan roti, perhitungan ongkir (Lalamove), konfirmasi pembayaran, hingga pembuatan laporan Excel otomatis untuk tim dapur **Yoyo Bakery**.

---

## 🚀 Fitur Utama

- **🧠 Pemahaman Bahasa Alami (Google Gemini AI)**:
  Bot memahami pesanan pelanggan yang diketik dengan bahasa sehari-hari tanpa format kaku (misal: *"Pesan nastar 2 sama roti sisir coklat 1 dong kirim besok"*). Bot juga cerdas menangani ambiguitas (jika pelanggan mengetik "Bolen", bot akan menanyakan varian rasanya).
- **🚚 Otomatisasi Lalamove**:
  Menghitung ongkos kirim secara otomatis dan *real-time* berdasarkan titik *ShareLoc* pelanggan. Admin dapat memanggil kurir langsung dari WhatsApp hanya dengan satu perintah.
- **🛡️ Penanganan Nomor Rahasia (@lid)**:
  Secara pintar mengatasi pelanggan yang menyembunyikan nomor WA-nya (fitur privasi WA) dengan mewajibkan mereka memasukkan nomor telepon aktif sebelum memproses lokasi Lalamove.
- **📊 Ekspor Laporan Excel Otomatis**:
  Admin dapat mengekstrak laporan pesanan harian atau akumulatif dalam format `.xlsx` yang sudah diformat dengan cantik dan rapi (berguna untuk rekap dapur dan rekap penjualan).
- **🤖 Filter Pesanan Luar Kota**:
  Mendeteksi jika pelanggan berada di luar wilayah pengiriman Lalamove (Luar Jakarta) dan otomatis mengarahkan mereka untuk bertransaksi via Shopee.
- **⚙️ Job Scheduler**:
  Membatalkan pesanan secara otomatis (Auto-Cancel) jika tidak dibayar dalam 48 jam, dan fitur reminder otomatis.

---

## 🛠️ Persiapan & Prasyarat

Pastikan sistem Anda memenuhi persyaratan berikut:
1. **Node.js** (Minimal v18 atau lebih baru).
2. Akun **Supabase** (Database PostgreSQL gratis).
3. Akun **Google AI Studio** (Untuk mendapatkan Gemini API Key).
4. Akun **Lalamove Developer** (API Key & Secret untuk Sandbox/Production).
5. Nomor WhatsApp khusus untuk Bot.

---

## ⚙️ Instalasi & Setup

### 1. Kloning & Install Dependencies
```bash
git clone <repository_url>
cd bot-wa-yoyo
npm install
```

### 2. Konfigurasi Environment Variables
Copy file template `.env.example` menjadi `.env` lalu isi data kredensial Anda.
```bash
cp .env.example .env
```
Isi konfigurasi pada file `.env`:
```env
# Supabase Configuration
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=ey...

# Gemini API Configuration
GEMINI_API_KEY=AIzaSy...

# Lalamove Configuration
LALAMOVE_API_KEY=pk_test_...
LALAMOVE_API_SECRET=sk_test_...
LALAMOVE_MARKET=ID
LALAMOVE_IS_SANDBOX=true

# Admin / Bot Configuration
ADMIN_PHONE=6281234567890
BOT_NAME="Yoyo Bakery"
SHOPEE_URL="https://shopee.co.id/yoyobakery"

# Payment
PAYMENT_BCA_NAME="Ariel Zan"
PAYMENT_BCA_NUMBER="1234567890"
```

### 3. Setup Database (Supabase)
1. Buka SQL Editor di Dashboard Supabase.
2. *Copy* isi file `src/database/schema.sql` dan *Run* untuk membuat struktur tabel (`products`, `orders`, `sessions`).
3. *Copy* isi file `src/database/seed.sql` dan *Run* untuk memasukkan data menu roti & pastry awal.

*(Penting: Pastikan kolom `wa_number` pada tabel di-set sebagai `TEXT`, bukan `VARCHAR(20)` agar kebal terhadap perubahan format nomor WA)*.

---

## 🚀 Menjalankan Bot

Jalankan perintah berikut pada terminal:
```bash
npm run dev
```
1. Tunggu hingga terminal memunculkan **QR Code**.
2. Buka aplikasi WhatsApp dari HP khusus Bot -> Buka opsi **Perangkat Tertaut (Linked Devices)**.
3. *Scan* QR Code yang muncul di layar komputer.
4. Bot siap melayani pelanggan!

> **💡 Catatan Ganti Nomor:** 
> Jika ingin mengganti nomor bot, *Stop* terminal (Ctrl+C), **hapus folder `auth_info/`**, lalu jalankan kembali `npm run dev` untuk mendapatkan QR Code baru.

---

## 📱 Panduan Penggunaan (Workflow)

### 🙍‍♂️ Alur Pelanggan (Customer Flow)
1. Customer menyapa bot (misal: "Halo", "Mau pesan").
2. Bot menanyakan asal daerah (Jakarta / Luar Jakarta).
3. Jika Jakarta, bot akan mengirim gambar Menu.
4. Customer mengetik pesanan (misal: "Bolen Coklat Keju 2 box").
5. Bot meringkas pesanan & menanyakan **Titik Lokasi (Shareloc)**.
6. Bot menghitung harga + ongkir dan menerbitkan tagihan BCA.
7. Customer mengirim gambar/foto Bukti Transfer. Bot meneruskan gambar tersebut ke nomor WA Admin untuk divalidasi.

### 👨‍💻 Perintah Admin (Admin Commands)
Admin dapat mengetik perintah berikut langsung di chat WhatsApp bot:

| Command | Fungsi |
| :--- | :--- |
| `/status` | Melihat seluruh pesanan yang sedang aktif (belum selesai). |
| `/struk [ID]` | Melihat struk pesanan secara detail lengkap dengan rincian per-item. |
| `/bayar [ID]` | Mengonfirmasi bahwa pembayaran untuk pesanan tersebut sudah masuk ke rekening. |
| `/kirim [ID]` | Memanggil kurir Lalamove. Bot otomatis mengabari pelanggan dan memberikan *link tracking*. |
| `/batal [ID]` | Membatalkan pesanan secara manual. |
| `/export` | Mengunduh file **Excel Laporan Harian** (Rekapitulasi Dapur & Detail Pesanan) untuk hari ini. |
| `/export semua` | Mengunduh file Excel laporan untuk seluruh pesanan aktif (hingga 3 hari ke belakang). |
| `/stok [Nama] [ready/po]` | Mengubah status ketersediaan produk (Contoh: `/stok Nastar Keju po`). |

---

## 📁 Struktur Folder Utama
```text
bot-wa-yoyo/
├── src/
│   ├── index.js              # Entry point & Scheduler
│   ├── config.js             # Validasi Environment Variables
│   ├── whatsapp/             # Koneksi Baileys & Sender Module
│   ├── flow/                 # Logika AI, Customer Flow & Admin Commands
│   ├── database/             # Koneksi Supabase, Schema & Seeding SQL
│   ├── lalamove/             # Integrasi API Lalamove Quotation & Order
│   ├── utils/                # Fitur Excel Exporter & Logger
│   └── assets/               # Folder tempat menyimpan gambar menu (menu-page1.jpg)
├── .env                      # Variabel rahasia (TIDAK DIBAGIKAN!)
└── package.json              # Daftar library (Baileys, exceljs, supabase, dll)
```

---
**Dibuat Khusus untuk Yoyo Bakery 🍞**
