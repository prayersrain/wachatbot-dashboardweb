# 🍞 Yoyo Bakery Bot — Setup Guide (Windows)

Panduan lengkap untuk setup project **Yoyo Bakery WhatsApp Bot + Dashboard** dari nol di komputer baru (Windows).

---

## 📋 Daftar Isi

1. [Install Software yang Dibutuhkan](#1--install-software-yang-dibutuhkan)
2. [Clone / Copy Project](#2--clone--copy-project)
3. [Setup Backend (Bot WhatsApp)](#3--setup-backend-bot-whatsapp)
4. [Setup Dashboard (Frontend)](#4--setup-dashboard-frontend)
5. [Menjalankan Project](#5--menjalankan-project)
6. [Troubleshooting](#6--troubleshooting)

---

## 1. 💻 Install Software yang Dibutuhkan

### A. Node.js (WAJIB)

Download dan install **Node.js v20 LTS** (atau lebih baru):

🔗 https://nodejs.org/en/download

Pilih **Windows Installer (.msi)** → Next-next sampai selesai.

Verifikasi setelah install — buka **PowerShell** atau **Command Prompt**:

```bash
node -v      # Harus v20.x.x atau lebih baru
npm -v       # Harus v10.x.x atau lebih baru
```

### B. Git (WAJIB)

Download dan install Git:

🔗 https://git-scm.com/download/win

Pilih **64-bit Git for Windows Setup** → Next-next (default semua oke).

Verifikasi:

```bash
git --version    # Harus muncul versi git
```

### C. Code Editor (OPSIONAL tapi disarankan)

Download **Visual Studio Code**:

🔗 https://code.visualstudio.com/download

---

## 2. 📦 Clone / Copy Project

### Opsi A: Clone dari Git (Jika sudah di-push ke GitHub/GitLab)

```bash
cd C:\Users\NamaUser\Projects
git clone <URL_REPOSITORY> bot-wa-yoyo
cd bot-wa-yoyo
```

### Opsi B: Copy Manual via Flashdisk / Google Drive

1. Copy seluruh folder `bot-wa-yoyo` ke komputer client
2. **JANGAN** copy folder-folder berikut (bisa di-generate ulang):
   - `node_modules/` (besar, akan di-install ulang)
   - `auth_info/` (session WA lama, harus scan QR baru)
3. Pastikan folder-folder ini **ADA** setelah copy:

```
bot-wa-yoyo/
├── src/                  ← Source code bot
│   ├── assets/           ← Gambar menu (menu-page1.jpg, menu-page2.jpg)
│   ├── database/
│   ├── flow/
│   ├── lalamove/
│   ├── middleware/
│   ├── utils/
│   ├── whatsapp/
│   ├── app.js
│   ├── config.js
│   └── index.js
├── dashboard/            ← Frontend React (Vite)
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── vite.config.js
├── .env.example          ← Template environment variables
├── package.json
└── README.md
```

---

## 3. ⚙️ Setup Backend (Bot WhatsApp)

### Langkah 1: Install Dependencies

Buka **PowerShell** di folder project:

```bash
cd C:\Users\NamaUser\Projects\bot-wa-yoyo
npm install
```

> ⏳ Ini akan mengunduh semua package (~500MB). Tunggu sampai selesai.
>
> ⚠️ Jika muncul error terkait `sharp`, jalankan:
> ```bash
> npm install --ignore-scripts
> npm rebuild sharp
> ```

### Langkah 2: Buat File `.env`

Copy template `.env.example` menjadi `.env`:

```bash
copy .env.example .env
```

Buka file `.env` dengan Notepad / VS Code, lalu isi sesuai data berikut:

```env
# Server
PORT=3000
NODE_ENV=production

# Supabase (Database)
SUPABASE_URL=https://wmepobvbojrifdeimznk.supabase.co
SUPABASE_ANON_KEY=<minta ke developer / copy dari .env komputer utama>

# Google Gemini AI
GEMINI_API_KEY=<minta ke developer / buat di https://aistudio.google.com/apikey>

# Lalamove (Kurir)
LALAMOVE_API_KEY=<minta ke developer>
LALAMOVE_API_SECRET=<minta ke developer>
LALAMOVE_BASE_URL=https://rest.lalamove.com
LALAMOVE_MARKET=ID

# Store Info (Lokasi Toko)
STORE_LAT=-6.1835727
STORE_LNG=106.8609913
STORE_ADDRESS=Gg. L No.16c, RT.4/RW.5, Johar Baru, Jakarta Pusat 10560
STORE_PHONE=+6281xxxxxxxxx
STORE_NAME=Yoyo Bakery

# Admin WhatsApp (Nomor admin yang terima notifikasi)
ADMIN_PHONE=628xxxxxxxxxx

# Payment BCA
BCA_ACCOUNT_NAME=<Nama Pemilik Rekening>
BCA_ACCOUNT_NUMBER=<Nomor Rekening BCA>

# Logging
LOG_LEVEL=info

# Shopee (untuk customer Luar Jakarta)
SHOPEE_URL=https://id.shp.ee/i3fhwEoz
```

> [!IMPORTANT]
> **Semua value yang bertanda `<...>` HARUS diisi dengan data yang benar!**
> Minta credential ke developer atau copy dari `.env` komputer utama.

### Langkah 3: Pastikan Menu Images Ada

Cek bahwa file gambar menu sudah ada:

```
src/assets/menu-page1.jpg
src/assets/menu-page2.jpg
```

Jika tidak ada, copy dari komputer utama.

---

## 4. 🖥️ Setup Dashboard (Frontend)

### Langkah 1: Install Dependencies Dashboard

```bash
cd dashboard
npm install
```

### Langkah 2: Buat File `.env` Dashboard

```bash
copy .env.example .env
```

> Jika tidak ada `.env.example` di dashboard, buat manual:

Buat file `dashboard/.env` dengan isi:

```env
VITE_SUPABASE_URL=https://wmepobvbojrifdeimznk.supabase.co
VITE_SUPABASE_ANON_KEY=<sama dengan SUPABASE_ANON_KEY di .env root>
```

### Langkah 3: Build Dashboard untuk Production

```bash
npm run build
```

Ini akan menghasilkan folder `dashboard/dist/` yang berisi file-file static HTML/JS/CSS.

### Langkah 4: Kembali ke Root

```bash
cd ..
```

---

## 5. 🚀 Menjalankan Project

### Menjalankan Bot (Backend)

```bash
cd C:\Users\NamaUser\Projects\bot-wa-yoyo
npm start
```

Saat pertama kali jalan, akan muncul **QR Code** di terminal:

```
█████████████████████████
██ ▄▄▄▄▄ ██▄█ ▄▄▄▄▄ ██
██ █   █ ██▄█ █   █ ██
██ █▄▄▄█ ██▄█ █▄▄▄█ ██
...
```

**Scan QR Code ini dengan WhatsApp di HP:**
1. Buka WhatsApp di HP
2. Ketuk **⋮ (titik 3)** → **Linked Devices** → **Link a Device**
3. Scan QR code yang tampil di terminal

> [!WARNING]
> **Satu nomor WhatsApp hanya bisa terhubung ke SATU bot.**
> Jika komputer utama masih menjalankan bot, matikan dulu sebelum scan QR di komputer client.

Setelah scan berhasil, akan muncul:

```
✅ Bot WhatsApp Berhasil Terhubung!
```

### Menjalankan Dashboard (Development)

Buka **terminal baru** (jangan tutup terminal bot):

```bash
cd C:\Users\NamaUser\Projects\bot-wa-yoyo\dashboard
npm run dev
```

Dashboard akan buka di: **http://localhost:5173**

### Menjalankan Dashboard (Production)

Jika sudah di-build (`npm run build`), serve dengan:

```bash
npx serve dist -l 5173
```

Atau deploy folder `dashboard/dist/` ke hosting seperti **Vercel**, **Netlify**, dll.

---

## 6. 🔧 Troubleshooting

### ❌ Error: `node is not recognized`

→ Node.js belum terinstall atau belum masuk PATH.
→ Install ulang Node.js dan **restart PowerShell/CMD**.

### ❌ Error: `npm ERR! sharp`

→ Jalankan:
```bash
npm install --ignore-scripts
npm rebuild sharp
```

### ❌ Error: `FATAL: Environment variables belum diset`

→ File `.env` belum dibuat atau ada value yang kosong.
→ Cek ulang semua value di `.env`.

### ❌ QR Code tidak muncul

→ Pastikan folder `auth_info/` **tidak ada** atau kosong (hapus jika ada).
→ Restart bot: `Ctrl+C` lalu `npm start` lagi.

### ❌ Error: `Cannot find module`

→ Dependencies belum ter-install:
```bash
npm install
```

### ❌ Bot jalan tapi tidak membalas chat

Cek:
1. WhatsApp sudah tersambung? (Lihat log `✅ Bot WhatsApp Berhasil Terhubung!`)
2. Nomor yang chat bukan nomor admin? (Admin dihandle terpisah)
3. Cek log error di terminal

### ❌ Dashboard blank / error

→ Cek file `dashboard/.env` — pastikan `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` sudah benar.
→ Jalankan ulang `npm run dev`.

---

## 📌 Ringkasan Quick Start

```bash
# === INSTALL ===
# 1. Install Node.js v20+ dari https://nodejs.org
# 2. Install Git dari https://git-scm.com

# === SETUP ===
cd C:\Users\NamaUser\Projects\bot-wa-yoyo

# Backend
npm install
copy .env.example .env
# → Edit .env, isi semua credential

# Dashboard
cd dashboard
npm install
copy .env.example .env
# → Edit dashboard/.env, isi Supabase credential
npm run build
cd ..

# === RUN ===
npm start                  # Jalankan bot (scan QR saat pertama kali)

# Terminal baru:
cd dashboard
npm run dev                # Jalankan dashboard di http://localhost:5173
```

---

## 🔑 Daftar Credential yang Dibutuhkan

| Credential | Dari Mana | Contoh Format |
|---|---|---|
| `SUPABASE_URL` | Supabase Dashboard | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API | `eyJhbGciOi...` |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey | `AIzaSy...` |
| `LALAMOVE_API_KEY` | Lalamove Developer Portal | `pk_live_xxx` |
| `LALAMOVE_API_SECRET` | Lalamove Developer Portal | `sk_live_xxx` |
| `ADMIN_PHONE` | Nomor WA admin (format 628xxx) | `6281234567890` |
| `BCA_ACCOUNT_NAME` | Pemilik rekening | `John Doe` |
| `BCA_ACCOUNT_NUMBER` | Nomor rekening BCA | `1234567890` |

> [!TIP]
> Cara paling gampang: **copy file `.env` dari komputer utama** ke komputer client, lalu sesuaikan jika perlu.
