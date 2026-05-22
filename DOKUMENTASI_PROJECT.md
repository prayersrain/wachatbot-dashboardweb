# 📖 Dokumentasi Lengkap — Yoyo Bakery WhatsApp Bot

> **Sistem otomatisasi pemesanan kue via WhatsApp** dengan integrasi AI (Gemini), pengiriman kurir otomatis (Lalamove), dan manajemen pesanan real-time (Supabase).

---

## 📋 Daftar Isi

1. [Ringkasan Proyek](#1-ringkasan-proyek)
2. [Tech Stack](#2-tech-stack)
3. [Arsitektur Sistem](#3-arsitektur-sistem)
4. [Struktur Direktori](#4-struktur-direktori)
5. [Alur Pemesanan Pelanggan](#5-alur-pemesanan-pelanggan)
6. [Modul-Modul Inti](#6-modul-modul-inti)
7. [Perintah Admin](#7-perintah-admin)
8. [Integrasi AI (Gemini)](#8-integrasi-ai-gemini)
9. [Integrasi Lalamove](#9-integrasi-lalamove)
10. [Database & Schema](#10-database--schema)
11. [Sistem Keamanan](#11-sistem-keamanan)
12. [Scheduler & Automasi](#12-scheduler--automasi)
13. [Dashboard Web](#13-dashboard-web)
14. [Konfigurasi Environment](#14-konfigurasi-environment)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Ringkasan Proyek

**Yoyo Bakery Bot** adalah sistem end-to-end yang menangani seluruh siklus pemesanan kue secara otomatis melalui WhatsApp:

- 🤖 **Pelanggan chat** → Bot menyapa, mengenali kota, menampilkan menu
- 🧠 **AI memahami pesanan** → Gemini 3.1 mem-parse bahasa natural menjadi data terstruktur
- 📍 **Hitung ongkir otomatis** → Pelanggan kirim lokasi, bot hitung via Lalamove API
- 💳 **Pembayaran** → Pelanggan transfer BCA, kirim bukti foto, bot deteksi otomatis
- 🚚 **Panggil kurir** → Admin ketik `/kirim`, bot dispatch Lalamove secara otomatis
- 📊 **Dashboard Web** → Admin pantau semua pesanan dari browser (React + Vite PWA)

---

## 2. Tech Stack

| Komponen | Teknologi | Versi |
|---|---|---|
| **Runtime** | Node.js | 20+ |
| **WhatsApp Engine** | Baileys (@whiskeysockets/baileys) | 7.0.0-rc.9 |
| **AI / NLP** | Google Gemini (generative-ai SDK) | 0.24.1 |
| **Database** | Supabase (PostgreSQL) | - |
| **Courier API** | Lalamove REST API v3 | Production |
| **Web Server** | Express.js | 5.2.1 |
| **Excel Export** | ExcelJS | 4.4.0 |
| **Dashboard** | React 19 + Vite + TailwindCSS v4 | - |
| **Logging** | Pino | 10.3.1 |

---

## 3. Arsitektur Sistem

```
┌─────────────────┐    ┌──────────────┐    ┌─────────────────┐
│   Pelanggan WA   │◄──►│  Baileys      │◄──►│  Router         │
│   (WhatsApp)     │    │  (WebSocket)  │    │  (router.js)    │
└─────────────────┘    └──────────────┘    └────────┬────────┘
                                                     │
                                          ┌──────────┴──────────┐
                                          │                     │
                                   ┌──────▼──────┐     ┌───────▼───────┐
                                   │ customerFlow │     │  adminFlow    │
                                   │ (State Machine)│    │ (Slash Cmds)  │
                                   └──────┬───────┘    └───────────────┘
                                          │
                              ┌───────────┼───────────┐
                              │           │           │
                        ┌─────▼─────┐ ┌───▼───┐ ┌────▼─────┐
                        │ aiParser  │ │ Supa- │ │ Lalamove │
                        │ (Gemini)  │ │ base  │ │  API v3  │
                        └───────────┘ └───────┘ └──────────┘
```

**Alur data:** WhatsApp → Baileys → Router → (Admin/Customer Flow) → AI/DB/Lalamove → Baileys → WhatsApp

---

## 4. Struktur Direktori

```
bot-wa-yoyo/
├── src/
│   ├── index.js              # Entry point, startup validation, graceful shutdown
│   ├── app.js                # Express server (webhook endpoints)
│   ├── config.js             # Konfigurasi dari .env
│   │
│   ├── whatsapp/
│   │   ├── baileys.js        # Koneksi WA, message buffering, queue system
│   │   └── sender.js         # Kirim teks, gambar, lokasi, media download
│   │
│   ├── flow/
│   │   ├── router.js         # Routing: Admin vs Customer, rate limit, pause check
│   │   ├── customerFlow.js   # State machine utama (IDLE→ORDER→LOCATION→CONFIRM→PAYMENT)
│   │   ├── adminFlow.js      # 17 perintah slash admin (/status, /kirim, /batal_kurir, dll)
│   │   ├── aiParser.js       # 2-layer parsing: Regex cepat + Gemini AI
│   │   ├── orderParser.js    # Parse teks pesanan → data terstruktur + format rupiah
│   │   └── statusListener.js # Realtime listener: perubahan status di Dashboard → aksi bot
│   │
│   ├── database/
│   │   ├── supabase.js       # CRUD: orders, customers, sessions, products, settings
│   │   ├── schema.sql        # DDL tabel: products, customers, orders, sessions
│   │   └── seed.sql          # Data awal produk Yoyo Bakery
│   │
│   ├── lalamove/
│   │   ├── auth.js           # HMAC-SHA256 signature generator
│   │   ├── client.js         # getQuotation, createOrder, getOrderDetails, cancelOrder
│   │   └── webhook.js        # Handler webhook Lalamove (status kurir)
│   │
│   ├── middleware/
│   │   ├── chatRateLimiter.js # Anti-spam: sliding window + burst detection
│   │   └── rateLimiter.js     # Express rate limiter untuk HTTP endpoints
│   │
│   └── utils/
│       ├── logger.js         # Pino logger
│       ├── scheduler.js      # Payment reminder (jam 8), auto-cancel (2 hari), session cleanup
│       └── excelExporter.js  # Generate laporan Excel 2 sheet (Detail + Rekap Dapur)
│
├── dashboard/                # React PWA (Vite + TailwindCSS v4)
├── auth_info/                # Sesi WhatsApp Baileys (jangan dihapus!)
├── contacts_map.json         # Mapping LID → nomor HP (untuk resolusi admin)
├── .env                      # Konfigurasi rahasia
└── package.json
```

---

## 5. Alur Pemesanan Pelanggan

### State Machine (`customerFlow.js`)

```
IDLE → REGION_SELECT → ORDER → LOCATION → CONFIRM → PAYMENT → (Selesai)
                ↓
           REJECTED (Luar Jakarta → Shopee)
```

| State | Deskripsi | Transisi |
|---|---|---|
| **IDLE** | Pelanggan belum mulai. Chat apa saja → langsung tanya wilayah | → REGION_SELECT |
| **REGION_SELECT** | Bot mengenali 100+ kota Indonesia. Jakarta → lanjut, lainnya → Shopee | → ORDER / REJECTED |
| **REJECTED** | Pelanggan luar Jakarta. Semua chat diarahkan ke Shopee | Terminal |
| **ORDER** | Pelanggan menyebutkan pesanan. AI parsing nama kue + jumlah. Bisa tambah/ubah/hapus item | → LOCATION |
| **LOCATION** | Menunggu shareloc. Bot hitung ongkir via Lalamove + formula anti-nombok | → CONFIRM |
| **CONFIRM** | Tampilkan ringkasan + total. Untuk user @lid, minta nama & HP dulu | → PAYMENT |
| **PAYMENT** | Menunggu foto bukti transfer. Bot simpan ke Supabase Storage | → Pesanan Selesai |

### Smart Interrupt
Bot bisa menjawab pertanyaan (FAQ, tanya menu, Shopee) **di state mana pun** tanpa merusak alur pesanan.

### Fitur Estimasi Ongkir Out-of-Band
Pelanggan bisa kirim shareloc **kapan saja** (bahkan sebelum pesan) dan bot akan menghitung estimasi ongkir tanpa mengubah state.

---

## 6. Modul-Modul Inti

### 6.1 `baileys.js` — WhatsApp Engine

- **Message Buffering:** Chat beruntun dalam 3 detik digabung jadi 1 pesan (menghindari spam multiple bubbles)
- **Per-User Queue:** Setiap user punya antrean sendiri, diproses secara paralel antar user tapi serial per user
- **Auto-Reconnect:** Jika koneksi putus (bukan logout), otomatis reconnect dalam 3 detik
- **Startup Filter:** Mengabaikan pesan lama (sebelum bot nyala) agar tidak memproses backlog
- **QR Code:** Ditampilkan di terminal saat pertama kali koneksi

### 6.2 `router.js` — Message Router

- **Admin Detection:** Mencocokkan nomor pengirim dengan `ADMIN_PHONE` (mendukung format LID via `contacts_map.json`)
- **Global Pause:** Jika `/pause` aktif, semua pesan non-admin diabaikan total
- **Rate Limit:** Setiap pesan dicek anti-spam sebelum diproses
- **Routing:** Admin + slash command → `adminFlow`, sisanya → `customerFlow`

### 6.3 `customerFlow.js` — State Machine

File terbesar (~660 baris). Menangani seluruh alur pelanggan:

- **Region Detection:** Mengenali 100+ kota/provinsi/singkatan (Jaksel, Jabar, Sumut, dll)
- **Order Management:** Tambah, ubah jumlah, hapus item, klarifikasi produk ambigu
- **Delivery Fee:** Formula "Argo Petir" custom (0-3km: 8rb, 4-25km: 2rb/km, >25km: 2.4rb/km) + perbandingan dengan harga Lalamove real-time → ambil yang tertinggi
- **Name/Phone Collection:** Untuk user @lid yang tidak punya nomor HP terdeteksi
- **Finalize Order:** Simpan ke database, pindah ke state PAYMENT
- **Payment Proof:** Terima foto bukti transfer, simpan ke Supabase, notif admin

### 6.4 `orderParser.js` — Order Text Parser

- Parse teks bebas: "nastar classic 2, bolen coklat 1" → data terstruktur
- Lookup produk di database dengan fuzzy matching
- Build ringkasan pesanan dengan format rupiah
- Mendukung format: `Item x2`, `Item 2`, `2x Item`, `2 Item`

### 6.5 `statusListener.js` — Realtime Bridge

Mendengarkan perubahan status pesanan di Supabase secara real-time. Jika Admin mengubah status dari Dashboard Web:

| Perubahan Status | Aksi Otomatis |
|---|---|
| → `confirmed` | Update payment → paid, hapus sesi, notif pelanggan + admin |
| → `shipping` | Panggil Lalamove otomatis, kirim tracking link |
| → `cancelled` | Notif pelanggan pesanan dibatalkan |
| → `completed` | Notif pelanggan pesanan selesai + ucapan terima kasih |

---

## 7. Perintah Admin

Semua perintah diawali `/` dan hanya bisa diakses oleh nomor `ADMIN_PHONE`.

| Perintah | Fungsi |
|---|---|
| `/status` | Ringkasan pesanan hari ini + daftar produksi dapur |
| `/export` | Unduh laporan Excel (2 sheet: Detail Pesanan + Rekap Dapur) |
| `/export semua` | Export 3 hari terakhir |
| `/struk [no]` | Tampilkan rincian lengkap 1 pesanan |
| `/cek [no]` | Cek detail status pesanan |
| `/bayar [no]` | Konfirmasi pembayaran manual |
| `/kirim [no]` | Panggil kurir Lalamove untuk pesanan |
| `/batal_kurir [no]` | Batalkan pencarian Lalamove, kembalikan status ke confirmed |
| `/selesai [no]` | Tandai pesanan sebagai selesai |
| `/batal [no]` | Batalkan pesanan total |
| `/pause` | Matikan bot sementara (semua pesan non-admin diabaikan) |
| `/resume` | Hidupkan bot kembali |
| `/po [roti]` | Set produk sebagai Pre-Order |
| `/ready [roti]` | Set produk sebagai Ready Stock |
| `/habis [roti]` | Tandai stok habis |
| `/ada [roti]` | Tandai stok tersedia |
| `/help` | Tampilkan daftar perintah |

---

## 8. Integrasi AI (Gemini)

### Arsitektur 2-Layer (`aiParser.js`)

**Layer 1 — Regex Cepat (0ms):**
Mendeteksi intent sederhana tanpa memanggil API:
- Sapaan: halo, hai, pagi → `GREETING`
- Konfirmasi: iya, benar, konfirmasi → `CONFIRM`
- Batal: batal, cancel → `CANCEL`
- Terima kasih: makasih, thanks → `THANKS`
- Dan lainnya (ACKNOWLEDGE, ADMIN, BACK, ONBOARD_START)

**Layer 2 — Gemini AI (300-2000ms):**
Jika regex tidak match, panggil Gemini dengan:
- System prompt lengkap (aturan bisnis, produk, harga, FAQ)
- Konteks state pelanggan saat ini
- Daftar produk real-time dari database
- Konteks klarifikasi (jika ada pertanyaan ambigu sebelumnya)
- Info pesanan aktif pelanggan

**Model Fallback Chain:**
```
gemini-3.1-flash-lite-preview → gemini-2.5-flash → gemma-3-27b-it → gemini-3-flash-preview
```

### Intent yang Dikenali AI

| Intent | Kapan Digunakan |
|---|---|
| `ORDER` | Pelanggan menyebutkan nama kue + jumlah |
| `CONFIRM` | Pelanggan mengkonfirmasi pesanan |
| `CANCEL` | Pelanggan membatalkan pesanan |
| `BACK` | Pelanggan ingin kembali ke langkah sebelumnya |
| `QUERY` | Pelanggan menanyakan status pesanan |
| `FAQ` | Pertanyaan umum (jam buka, ongkir, dll) |
| `SHOW_MENU` | Permintaan gambar menu/pricelist |
| `GREETING` | Sapaan pembuka |
| `THANKS` | Ucapan terima kasih |
| `ADMIN` | Komplain/minta bantuan manusia |
| `ACKNOWLEDGE` | Jawaban singkat (ok, sip, ya) |

### Context Locking
Saat pelanggan di state `CONFIRM/LOCATION/PAYMENT`, AI **dilarang** mengkategorikan pesan sebagai `ORDER` kecuali ada kata eksplisit seperti "tambah". Ini mencegah "context blindness" — misalnya pelanggan mengetik "roti sisir" untuk bertanya, bukan menambah pesanan.

---

## 9. Integrasi Lalamove

### API Endpoints yang Digunakan

| Fungsi | Method | Endpoint |
|---|---|---|
| Get Quotation | POST | `/v3/quotations` |
| Create Order | POST | `/v3/orders` |
| Get Order Details | GET | `/v3/orders/{orderId}` |
| Cancel Order | DELETE | `/v3/orders/{orderId}` |

### Autentikasi (HMAC-SHA256)
```
Signature = HMAC_SHA256(timestamp\r\nMETHOD\r\n/path\r\n\r\nbody, API_SECRET)
Header: Authorization: hmac API_KEY:timestamp:signature
```

### Formula Ongkir Anti-Nombok ("Argo Petir")
Bot menghitung ongkir sendiri menggunakan formula:
- **0-3 km:** Rp 8.000 flat
- **4-25 km:** Rp 2.000/km
- **>25 km:** Rp 2.400/km

Kemudian membandingkan dengan harga real-time Lalamove dan **mengambil nilai tertinggi**, sehingga toko tidak rugi saat Lalamove surge pricing di jam sibuk.

### Webhook Lalamove
File `webhook.js` menerima notifikasi status kurir (ASSIGNING_DRIVER, PICKED_UP, COMPLETED, CANCELLED) dan otomatis mengirim update ke pelanggan via WhatsApp.

---

## 10. Database & Schema

### Tabel `products`
```sql
id, name, price, category, description, stock_type (ready/po), is_available, timestamps
```

### Tabel `customers`
```sql
id, wa_number (UNIQUE), name, timestamps
```

### Tabel `orders`
```sql
id, order_number (SERIAL), wa_number, customer_name, items (JSONB),
total_price, delivery_fee, customer_lat, customer_lng, customer_address,
notes, payment_status, order_status,
lalamove_quotation_id, lalamove_order_id, lalamove_share_link, lalamove_status,
timestamps
```

### Tabel `sessions`
```sql
wa_number (PK), state, data (JSONB), updated_at
```
Menyimpan state machine pelanggan. Dihapus otomatis setelah 24 jam tidak aktif.

---

## 11. Sistem Keamanan

### Anti-Spam (`chatRateLimiter.js`)

| Mekanisme | Batas | Aksi |
|---|---|---|
| **Sliding Window** | 5 pesan / 30 detik | Warning "mohon tunggu" |
| **Burst Detection** | 12 pesan / 60 detik | Block 2 menit + notif admin |
| **Auto Cleanup** | Setiap 5 menit | Hapus data user yang sudah expired |

Admin dikecualikan dari semua rate limit.

### Per-User Locking
Saat pesan sedang diproses, user di-lock untuk mencegah race condition. Lock otomatis dilepas setelah selesai (max 5 menit).

### Global Pause
Admin bisa mengetik `/pause` untuk mematikan bot sementara. Semua pesan non-admin akan diabaikan total sampai `/resume` diketik.

---

## 12. Scheduler & Automasi

### Payment Reminder (Jam 08:00 WIB)
Pesanan yang belum dibayar >12 jam akan mendapat reminder otomatis berisi total tagihan + info rekening BCA.

### Auto-Cancel (2 Hari)
Pesanan yang belum dibayar lebih dari 2 hari akan otomatis dibatalkan. Pelanggan dan admin mendapat notifikasi.

### Session Cleanup
Sesi pelanggan yang tidak aktif >24 jam dihapus otomatis untuk menghemat storage.

### Interval
Semua tugas scheduler berjalan **setiap 1 jam** dengan delay awal 30 detik (menunggu koneksi WA stabil).

---

## 13. Dashboard Web

Berlokasi di folder `dashboard/`. Dibangun dengan **React 19 + Vite + TailwindCSS v4** sebagai PWA (Progressive Web App).

### Fitur Dashboard
- **Order Management:** Lihat, filter, ubah status pesanan
- **Sales Analytics:** Grafik pendapatan, produk terlaris
- **Product CRUD:** Kelola produk, harga, stok
- **Customer Ledger:** Riwayat pembelian per pelanggan
- **Audio Notification:** Bunyi saat pesanan baru masuk
- **Excel Export:** Download laporan dari browser
- **Responsive:** Optimized untuk mobile

### Sinkronisasi Realtime
Dashboard terhubung ke Supabase Realtime. Perubahan status dari dashboard otomatis memicu aksi bot melalui `statusListener.js` (konfirmasi bayar, panggil kurir, dll).

---

## 14. Konfigurasi Environment

```env
# Server
PORT=3000
NODE_ENV=development

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJxxx...

# Google Gemini AI
GEMINI_API_KEY=AIzaSyxxx...

# Lalamove
LALAMOVE_API_KEY=pk_prod_xxx
LALAMOVE_API_SECRET=sk_prod_xxx
LALAMOVE_BASE_URL=https://rest.lalamove.com
LALAMOVE_MARKET=ID

# Store Info
STORE_LAT=-6.183677
STORE_LNG=106.861037
STORE_ADDRESS=Gg. L No.16c, Johar Baru, Jakarta Pusat
STORE_PHONE=+628987632552
STORE_NAME=Yoyo Bolen

# Admin WhatsApp
ADMIN_PHONE=162298828218522@lid

# Payment (BCA)
BCA_ACCOUNT_NAME=Cici Yohani
BCA_ACCOUNT_NUMBER=7420414000

# Shopee
SHOPEE_URL=https://shopee.co.id/yoyobolen
```

---

## 15. Troubleshooting

### ❌ "No session found to decrypt message"
**Penyebab:** Library Baileys gagal mendekripsi pesan broadcast WhatsApp (status story).
**Dampak:** Tidak ada. Pesan broadcast bukan pesan pelanggan.
**Solusi:** Logger Baileys sudah diset ke `silent`. Abaikan error ini.

### ❌ "dist is not defined" saat shareloc
**Penyebab:** Variabel jarak tidak didefinisikan setelah refactor.
**Status:** ✅ Sudah diperbaiki — menggunakan `q.distance.value / 1000` langsung.

### ❌ Lalamove tidak dapat driver
**Penyebab:** Supply/demand kurir di lapangan, bukan bug kode.
**Solusi:** Admin ketik `/batal_kurir [no]` untuk membatalkan, lalu `/kirim [no]` untuk coba lagi nanti.

### ❌ Bot tidak merespons
**Cek:**
1. Terminal: apakah `npm start` masih jalan?
2. Apakah `/pause` aktif? Ketik `/resume`
3. Apakah `auth_info/` masih ada? Jika hilang, scan ulang QR
4. Rate limit: pelanggan mungkin ter-block 2 menit karena spam

### ❌ AI salah mengkategorikan intent
**Penyebab:** Gemini bisa salah memahami konteks, terutama pesan singkat.
**Mitigasi yang sudah diterapkan:**
- Context Locking di state CONFIRM/LOCATION/PAYMENT
- Regex Layer 1 untuk intent sederhana (bypass AI)
- Keyword detection langsung di fallback CONFIRM state
- Guard khusus untuk user @lid yang sedang input nama/HP

---

*Dokumentasi ini dibuat pada 19 Mei 2026. Terakhir diperbarui sesuai kondisi kode saat ini.*
