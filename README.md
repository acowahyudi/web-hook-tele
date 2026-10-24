# Telegram Bot to GitLab CI/CD Pipeline Webhook Bridge

Microservice webhook berbasis **Node.js (Express)** yang bertindak sebagai jembatan (*bridge*) antara **Telegram Bot Webhook** dan **GitLab CI/CD Pipeline Trigger API**. Aplikasi ini memungkinkan tim DevOps/Developer menjalankan runner job `git pull` atau deployment otomatis pada server target secara aman hanya melalui pesan di grup Telegram resmi.

---

## 🏗 Arsitektur Sistem

```
 ┌─────────────────┐       git pull project-a       ┌─────────────────────┐
 │  Telegram Group │ ─────────────────────────────> │ Telegram Bot Server │
 └─────────────────┘                                └──────────┬──────────┘
                                                               │
                                         POST /webhook/telegram│
                                         (Header: Secret-Token)│
                                                               v
                                                    ┌─────────────────────┐
                                                    │  Microservice Webhook│
                                                    │  (Node.js Express)  │
                                                    └──────────┬──────────┘
                         200 OK (Instant)                      │
                         ◄─────────────────────────────────────┤
                                                               │ 1. Validasi Secret Token
                                                               │ 2. Whitelist Chat ID
                                                               │ 3. Regex Sanitasi Alias
                                                               │ 4. Mapping Proyek
                                                               v
 ┌─────────────────┐   POST /api/v4/projects/...    ┌─────────────────────┐
 │  GitLab CI/CD   │ <───────────────────────────── │ GitLab Trigger API  │
 │  Runner/Pipeline│                                └─────────────────────┘
 └────────┬────────┘
          │ 201 Created (web_url & pipeline_id)
          v
 ┌─────────────────┐     Kirim Feedback Status      ┌─────────────────────┐
 │  Telegram Group │ <───────────────────────────── │ sendMessage API     │
 └─────────────────┘                                └─────────────────────┘
```

---

## 🔒 Fitur Keamanan (Security Layer)

1. **Header Secret Token Validation**:
   - Memvalidasi header `X-Telegram-Bot-Api-Secret-Token` terhadap `TELEGRAM_SECRET_TOKEN` menggunakan `crypto.timingSafeEqual` untuk mencegah *timing attack*.
   - Request tanpa token atau token tidak valid langsung ditolak dengan status `403 Forbidden`.
2. **Chat ID Whitelisting**:
   - Hanya memproses pesan yang berasal dari grup Telegram resmi yang terdaftar pada `ALLOWED_CHAT_ID`. Pesan dari user luar atau grup tidak dikenal akan diabaikan.
3. **Regex Sanitasi Input**:
   - Parameter alias proyek disanitasi ketat menggunakan regex `/^[a-zA-Z0-9_-]+$/` untuk mencegah *command injection* atau payload berbahaya.
4. **Respon Cepat (Anti-Timeout Loop)**:
   - Mengembalikan HTTP status `200 OK` sesegera mungkin di awal ke Telegram sebelum memicu GitLab API, menghindari mekanisme *auto-retry/looping delivery* dari Telegram.
5. **Container Hardening**:
   - Dockerfile menggunakan base image `node:20-alpine`, berjalan dengan user non-root (`USER node`), dan menggunakan `dumb-init` untuk penanganan sinyal proses PID 1 (`SIGTERM`/`SIGINT`).

---

## 📂 Struktur Proyek

```
web-hook-tele/
├── config/
│   └── projects.js        # Pemetaan alias proyek ke Project ID, Token, dan Branch GitLab
├── services/
│   ├── gitlab.js          # Service pemanggil GitLab Pipeline Trigger API (x-www-form-urlencoded)
│   └── telegram.js        # Service pengirim pesan balasan ke grup Telegram (sendMessage)
├── test/
│   └── app.test.js        # Unit & Integration Tests (Node Test Runner bawaan)
├── .dockerignore
├── .env.example           # Template environment variable
├── .gitignore
├── Dockerfile             # Multi-stage/hardened container build
├── docker-compose.yml     # Konfigurasi orkestrasi container
├── package.json           # Dependensi minimal (express, axios, dotenv)
└── app.js                 # Handler webhook utama, routing, & lifecycle server
```

---

## ⚙️ Konfigurasi Environment (`.env`)

Salin file `.env.example` ke `.env`:

```bash
cp .env.example .env
```

Sesuaikan nilai variabel berikut:

| Variabel | Deskripsi | Contoh |
|---|---|---|
| `PORT` | Port server mikroservice | `3000` |
| `BOT_TOKEN` | Token Bot Telegram dari [@BotFather](https://t.me/BotFather) | `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ` |
| `ALLOWED_CHAT_ID` | ID grup Telegram yang diizinkan (pisahkan koma untuk multiple) | `-1001234567890` |
| `TELEGRAM_SECRET_TOKEN` | Secret token acak 1-256 karakter (`A-Za-z0-9_-`) | `my_super_secret_token_abc123` |
| `GITLAB_HOST` | Host GitLab (`https://gitlab.com` atau domain self-hosted) | `https://gitlab.com` |
| `TRIGGER_TOKEN_PROJECT_A` | Pipeline Trigger Token untuk Project A | `glptt-xxxxxxxxxxxxxxxxxxxx` |
| `PROJECT_ID_PROJECT_A` | Numeric ID proyek GitLab untuk Project A | `12345678` |
| `REF_PROJECT_A` | Target branch runner untuk Project A | `main` |

---

## 🚀 Panduan Setup Langkah Demi Langkah

### 1. Registrasi Webhook Telegram (via cURL)

Setelah aplikasi memiliki domain publik ber-HTTPS (misal via Render, Koyeb, atau ngrok):

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://nama-app-anda.onrender.com/webhook/telegram",
    "secret_token": "my_super_secret_token_abc123",
    "allowed_updates": ["message"]
  }'
```

> **Penting**: Pastikan nilai `secret_token` sama persis dengan `TELEGRAM_SECRET_TOKEN` pada file `.env` Anda.

Untuk mengecek status webhook:
```bash
curl -s "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo" | jq
```

Untuk menghapus webhook jika diperlukan:
```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook"
```

---

### 2. Konfigurasi di GitLab CI/CD

#### A. Membuat Pipeline Trigger Token di GitLab
1. Buka repositori proyek GitLab Anda.
2. Masuk ke menu **Settings** > **CI/CD**.
3. Cari bagian **Pipeline trigger tokens**, klik **Expand**.
4. Masukkan deskripsi (misal: `Telegram Webhook Runner`), lalu klik **Add trigger token**.
5. Salin token yang dihasilkan (format diawali `glptt-...`) dan masukkan ke variabel `TRIGGER_TOKEN_PROJECT_<NAME>` di `.env`.
6. Catat **Project ID** numerik dari halaman **Settings** > **General**.

#### B. Contoh Konfigurasi `.gitlab-ci.yml` untuk Runner `git pull`
Tambahkan job berikut pada file `.gitlab-ci.yml` repositori target Anda:

```yaml
stages:
  - deploy

deploy_git_pull:
  stage: deploy
  rules:
    # Hanya jalankan job jika pipeline dipicu oleh Trigger API dan variabel ACTION sesuai
    - if: '$CI_PIPELINE_SOURCE == "trigger" && $ACTION == "git_pull"'
  tags:
    - production-runner # Ganti dengan tag runner server Anda
  script:
    - echo "Menerima sinyal deploy dari Telegram Bot..."
    - cd /var/www/nama-aplikasi
    - git fetch origin $CI_COMMIT_REF_NAME
    - git reset --hard origin/$CI_COMMIT_REF_NAME
    - echo "Git pull berhasil diselesaikan untuk branch $CI_COMMIT_REF_NAME"
```

---

### 3. Menambahkan Proyek Baru di `config/projects.js`

Untuk menambahkan proyek baru, cukup tambahkan entri pada file `config/projects.js`:

```javascript
module.exports = {
  'project-a': {
    gitlabHost: process.env.GITLAB_HOST || 'https://gitlab.com',
    projectId: process.env.PROJECT_ID_PROJECT_A || '12345678',
    token: process.env.TRIGGER_TOKEN_PROJECT_A,
    ref: process.env.REF_PROJECT_A || 'main',
    variables: { ACTION: 'git_pull' }
  },
  'project-b': {
    gitlabHost: process.env.GITLAB_HOST || 'https://gitlab.com',
    projectId: process.env.PROJECT_ID_PROJECT_B || '87654321',
    token: process.env.TRIGGER_TOKEN_PROJECT_B,
    ref: process.env.REF_PROJECT_B || 'production',
    variables: { ACTION: 'git_pull' }
  }
};
```

---

## 💬 Penggunaan di Grup Telegram

Kirim pesan ke grup Telegram resmi:

| Perintah | Deskripsi |
|---|---|
| `git pull project-a` | Menjalankan pipeline untuk `project-a` |
| `/git pull project-a` | Format perintah slash didukung |
| `git pull PROJECT-A` | Case-insensitive (huruf besar/kecil diabaikan) |
| `git pull project-a@NamaBot` | Otomatis membersihkan mention username bot |
| `git pull` | Menampilkan pesan panduan & daftar alias proyek yang tersedia |

### Respon Balasan Bot:

1. **Berhasil (`201 Created`)**:
   > 🚀 **GitLab CI/CD Pipeline Berhasil Dibuat!**
   >
   > 📦 **Proyek:** `project-a`  
   > 🌿 **Branch:** `main`  
   > 🆔 **Pipeline ID:** `#12345678`  
   > 📊 **Status:** `created`  
   > 🔗 **Tautan Pipeline:** https://gitlab.com/group/repo/-/pipelines/12345678

2. **Format Salah / Ilegal**:
   > ❌ **Format Nama Proyek Tidak Valid**  
   > Nama proyek hanya boleh mengandung huruf, angka, dash (`-`), dan underscore (`_`).

3. **Proyek Tidak Terdaftar**:
   > ❌ **Proyek Tidak Terdaftar**  
   > Alias `unknown-service` tidak ditemukan dalam konfigurasi runner.  
   > **Daftar proyek yang valid:**  
   > • `project-a`  
   > • `project-b`

4. **GitLab Menolak (misal: token salah / branch tidak ada)**:
   > ❌ **Gagal Memicu GitLab Pipeline**  
   > 📦 **Proyek:** `project-a`  
   > ⚠️ **Keterangan:** GitLab API Error [HTTP 400]: {"message":{"base":["Reference not found"]}}

---

## 🧪 Pengujian Lokal & Test Suite

### Menjalankan Unit & Integration Test
Aplikasi menyertakan unit & integration test komprehensif menggunakan Node.js test runner bawaan:

```bash
npm test
```

### Menjalankan Server Lokal
```bash
# Mode development dengan auto-reload (Node.js 18+)
npm run dev

# Mode production
npm start
```

### Healthcheck Endpoint
```bash
curl http://localhost:3000/health
# Output: {"status":"ok","uptime":12.34,"timestamp":"2026-10-23T12:00:00.000Z"}
```

### Simulasi Webhook via cURL Lokal
```bash
curl -X POST http://localhost:3000/webhook/telegram \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: my_super_secret_token_abc123" \
  -d '{
    "update_id": 10001,
    "message": {
      "message_id": 101,
      "chat": { "id": -1001234567890 },
      "text": "git pull project-a"
    }
  }'
```

---

## 🚢 Panduan Deployment

### Opsi 1: Docker & Docker Compose

1. Siapkan file `.env` di server.
2. Jalankan dengan Docker Compose:
   ```bash
   docker compose up -d --build
   ```
3. Cek log aplikasi:
   ```bash
   docker compose logs -f webhook-bridge
   ```

### Opsi 2: Deploy ke Render (Gratis)
1. Buat akun di [Render.com](https://render.com).
2. Buat **New Web Service** dan hubungkan ke repositori Git ini.
3. Konfigurasi service:
   - **Environment**: `Node`
   - **Build Command**: `npm ci --only=production`
   - **Start Command**: `node app.js`
   - **Health Check Path**: `/health`
4. Tambahkan seluruh environment variable dari file `.env` ke menu **Environment** di Render.
5. Salin URL HTTPS yang diberikan oleh Render (misal: `https://my-bridge.onrender.com`), lalu daftarkan ke Telegram menggunakan cURL `setWebhook`.

### Opsi 3: Deploy ke Koyeb (Gratis)
1. Buat akun di [Koyeb.com](https://koyeb.com).
2. Buat App baru dengan metode **GitHub** atau **Docker**.
3. Set Port ke `3000` dan Healthcheck path ke `/health`.
4. Masukkan Environment Variables di dashboard Koyeb.
5. Deploy & lakukan registrasi `setWebhook` Telegram.

### Opsi 4: Deploy ke Vercel (Serverless)
Repositori sudah dilengkapi dengan konfigurasi serverless [vercel.json](file:///Users/mac/Documents/AllProject/web-hook-tele/vercel.json) dan [api/index.js](file:///Users/mac/Documents/AllProject/web-hook-tele/api/index.js).
1. Import repositori Git ini ke project baru di [Vercel](https://vercel.com).
2. **Sangat Penting**: Karena file `.env` tidak diunggah ke Git, masukkan seluruh variabel lingkungan di menu **Project Settings > Environment Variables** di dashboard Vercel (`BOT_TOKEN`, `ALLOWED_CHAT_ID`, `TELEGRAM_SECRET_TOKEN`, `GITLAB_HOST`, dll).
3. Klik **Deploy**.
4. Daftarkan URL webhook Telegram dengan endpoint `https://<nama-project>.vercel.app/webhook/telegram`.

---

## 📄 Lisensi
MIT License.
