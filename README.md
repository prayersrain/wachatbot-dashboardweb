# 🍞 Yoyo Bakery Ecosystem

Sistem ekosistem pintar untuk **Yoyo Bakery** yang terdiri dari **WhatsApp Order Bot** (AI-Powered) dan **PWA Backoffice Dashboard** untuk manajemen operasional yang modern, cepat, dan terintegrasi.

---

## 🌟 Fitur Utama

### 🤖 WhatsApp Bot (AI-Powered)
- **🧠 Natural Language Understanding**: Menggunakan **Google Gemini AI** untuk memahami pesanan bebas format.
- **🚚 Lalamove Automation**: Hitung ongkir real-time dan panggil kurir otomatis via chat.
- **🛡️ Privacy Handling**: Menangani nomor tersembunyi (@lid) dengan validasi cerdas.
- **📊 Auto-Reporting**: Ekspor laporan Excel langsung dari chat WhatsApp.
- **⚙️ Auto-Cancel**: Pembatalan otomatis untuk pesanan yang tidak dibayar (48 jam).

### 📱 PWA Backoffice Dashboard (Web App)
- **🎨 Warm Bakery Theme**: Desain antarmuka modern dengan nuansa toko roti yang hangat dan profesional.
- **📊 Real-time Monitoring**: Pantau pesanan masuk secara instan dengan notifikasi suara.
- **📈 Dynamic Sales Charts**: Grafik penjualan harian yang terintegrasi langsung dengan data Supabase.
- **📦 Inventory Management**: Update harga, stok (Ready/PO), dan gambar produk dengan mudah.
- **🔍 Advanced Filtering**: Filter pesanan berdasarkan status (Menunggu, Packing, Dikirim, Selesai).
- **📶 PWA Ready**: Bisa di-install di Android/iOS layaknya aplikasi native (Workbox & Vite PWA).

---

## 🛠️ Tech Stack

| Komponen | Teknologi |
| :--- | :--- |
| **Backend/Bot** | Node.js, Baileys (WA Library), Gemini AI, Lalamove API |
| **Frontend/Dashboard** | **React 19**, **Vite 8**, **TailwindCSS v4** |
| **Database** | **Supabase** (PostgreSQL) |
| **Infrastructure** | GitHub, Vercel (Frontend), Local/Server (Bot) |

---

## 🚀 Instalasi & Setup

### 1. Kloning Repository
```bash
git clone <repository_url>
cd bot-wa-yoyo
npm install
```

### 2. Setup WhatsApp Bot
Isi file `.env` di root folder sesuai dengan `.env.example`.
```bash
npm run dev
```
*Scan QR Code yang muncul untuk menghubungkan WhatsApp.*

### 3. Setup Dashboard (PWA)
```bash
cd dashboard
npm install
# Isi file .env di folder dashboard dengan VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY
npm run dev
```

---

## 👨‍💻 Perintah Admin (WhatsApp)

| Command | Fungsi |
| :--- | :--- |
| `/status` | Cek semua pesanan aktif. |
| `/bayar [ID]` | Konfirmasi pembayaran lunas. |
| `/kirim [ID]` | Panggil kurir Lalamove + Link Tracking ke User. |
| `/selesai [ID]` | Tandai pesanan sebagai selesai. |
| `/stok [Nama] [ready/po/out]` | Update ketersediaan produk. |
| `/export` | Download laporan Excel hari ini. |

---

## 🔐 Keamanan & RLS
Pastikan **Supabase Storage Policies** sudah dikonfigurasi untuk bucket `products` agar fitur upload gambar di Dashboard berjalan lancar:
1. `SELECT`: Allow for `public`.
2. `INSERT/UPDATE`: Allow for `authenticated`.

---

**Dibuat Khusus untuk Yoyo Bakery 🍞**
*Modernizing traditional bakery operations with AI.*
