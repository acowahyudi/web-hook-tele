require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const projects = require('./config/projects');
const gitlabService = require('./services/gitlab');
const telegramService = require('./services/telegram');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware body-parser JSON
app.use(express.json());

/**
 * Validasi timing-safe untuk header X-Telegram-Bot-Api-Secret-Token
 * @param {string|undefined} receivedToken 
 * @param {string|undefined} expectedToken 
 * @returns {boolean}
 */
function isSecretTokenValid(receivedToken, expectedToken) {
  // Jika secret token tidak diatur di environment, tolak secara default demi keamanan
  if (!expectedToken) {
    console.warn('[Security Warning] TELEGRAM_SECRET_TOKEN tidak diatur pada environment variable.');
    return false;
  }
  if (!receivedToken) {
    return false;
  }
  const receivedBuf = Buffer.from(receivedToken);
  const expectedBuf = Buffer.from(expectedToken);
  if (receivedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(receivedBuf, expectedBuf);
}

/**
 * Validasi Whitelist Telegram Chat ID
 * @param {string|number} chatId 
 * @returns {boolean}
 */
function isChatAllowed(chatId) {
  const allowedStr = process.env.ALLOWED_CHAT_ID;
  if (!allowedStr) {
    console.warn('[Security] ALLOWED_CHAT_ID belum diatur. Pesan diabaikan.');
    return false;
  }
  const allowedList = allowedStr.split(',').map((id) => id.trim());
  return allowedList.includes(String(chatId));
}

/**
 * Endpoint Healthcheck untuk monitoring platform cloud (Render, Koyeb, Docker)
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

/**
 * Root endpoint sederhana
 */
app.get('/', (req, res) => {
  res.status(200).json({
    service: 'Telegram GitLab Webhook Bridge',
    status: 'running'
  });
});

/**
 * Endpoint Telegram Webhook
 * POST /webhook/telegram
 */
app.post('/webhook/telegram', (req, res) => {
  const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
  const expectedSecret = process.env.TELEGRAM_SECRET_TOKEN;

  // 1. Security Layer: Validasi Secret Token Telegram
  if (!isSecretTokenValid(secretHeader, expectedSecret)) {
    console.warn('[Security] Ditolak: X-Telegram-Bot-Api-Secret-Token tidak cocok atau tidak ada.');
    return res.status(403).json({ error: 'Forbidden: Invalid secret token' });
  }

  // 2. Kirim respons HTTP 200 OK sesegera mungkin ke Telegram
  // Hal ini penting untuk mencegah Telegram menganggap request timeout / melakukan retry loop
  res.status(200).json({ ok: true });

  // 3. Proses pesan secara asinkron di background
  processTelegramUpdate(req.body).catch((err) => {
    console.error('[Webhook Error] Terjadi kesalahan dalam pemrosesan pesan:', err);
  });
});

/**
 * Handler asinkron untuk memproses payload Telegram
 * @param {Object} update Payload update dari Telegram Bot API
 */
async function processTelegramUpdate(update) {
  if (!update || !update.message) {
    // Abaikan update selain pesan (misal: channel_post, inline_query, callback_query)
    return;
  }

  const { message } = update;
  const chatId = message.chat?.id;
  const messageId = message.message_id;
  const text = message.text ? message.text.trim() : '';

  if (!chatId || !text) {
    return;
  }

  // 4. Security Layer: Whitelist Chat ID
  if (!isChatAllowed(chatId)) {
    console.warn(`[Security] Diabaikan: Pesan berasal dari chat_id tidak terdaftar (${chatId}).`);
    return;
  }

  // 5. Message Parsing: Deteksi format "git pull <nama-proyek>" (case-insensitive)
  // Mendukung "/git pull <proyek>", "git pull <proyek>", dan mention bot "@botname"
  const commandRegex = /^(?:\/)?git\s+pull(?:\s+([^\s]+))?(?:\s+.*)?$/i;
  const match = text.match(commandRegex);

  if (!match) {
    // Bukan perintah "git pull", abaikan percakapan biasa di grup
    return;
  }

  const rawProjectParam = match[1];

  // Kasus: User hanya mengetik "git pull" tanpa nama proyek
  if (!rawProjectParam) {
    const availableProjects = Object.keys(projects)
      .map((alias) => `• <code>${telegramService.escapeHtml(alias)}</code>`)
      .join('\n');

    const helpMessage = 
      `⚠️ <b>Format Perintah Belum Lengkap</b>\n\n` +
      `Gunakan format: <code>git pull &lt;nama-proyek&gt;</code>\n\n` +
      `<b>Daftar proyek yang tersedia:</b>\n${availableProjects || '<i>(Belum ada proyek terdaftar)</i>'}`;

    await telegramService.sendTelegramMessage({
      chatId,
      text: helpMessage,
      replyToMessageId: messageId
    });
    return;
  }

  // Bersihkan mention bot jika user mengetik "git pull project-a@my_bot"
  const projectAlias = rawProjectParam.replace(/@[a-zA-Z0-9_]+$/, '').trim();

  // 6. Sanitasi input nama alias proyek dengan regex: /^[a-zA-Z0-9_-]+$/
  const aliasRegex = /^[a-zA-Z0-9_-]+$/;
  if (!aliasRegex.test(projectAlias)) {
    const invalidFormatMessage = 
      `❌ <b>Format Nama Proyek Tidak Valid</b>\n\n` +
      `Nama proyek hanya boleh mengandung huruf, angka, dash (<code>-</code>), dan underscore (<code>_</code>).`;

    await telegramService.sendTelegramMessage({
      chatId,
      text: invalidFormatMessage,
      replyToMessageId: messageId
    });
    return;
  }

  // 7. Mapping proyek dari config/projects.js (pencarian case-insensitive)
  const matchedKey = Object.keys(projects).find(
    (key) => key.toLowerCase() === projectAlias.toLowerCase()
  );

  const projectConfig = matchedKey ? projects[matchedKey] : null;

  // Kasus: Proyek tidak ditemukan dalam mapping
  if (!projectConfig) {
    const availableProjects = Object.keys(projects)
      .map((alias) => `• <code>${telegramService.escapeHtml(alias)}</code>`)
      .join('\n');

    const notFoundMessage = 
      `❌ <b>Proyek Tidak Terdaftar</b>\n\n` +
      `Alias <code>${telegramService.escapeHtml(projectAlias)}</code> tidak ditemukan dalam konfigurasi runner.\n\n` +
      `<b>Daftar proyek yang valid:</b>\n${availableProjects || '<i>(Belum ada proyek terdaftar)</i>'}`;

    await telegramService.sendTelegramMessage({
      chatId,
      text: notFoundMessage,
      replyToMessageId: messageId
    });
    return;
  }

  // 8. Hit GitLab CI/CD Pipeline Trigger API
  try {
    const result = await gitlabService.triggerGitlabPipeline(projectConfig);

    const successMessage = 
      `🚀 <b>GitLab CI/CD Pipeline Berhasil Dibuat!</b>\n\n` +
      `📦 <b>Proyek:</b> <code>${telegramService.escapeHtml(matchedKey)}</code>\n` +
      `🌿 <b>Branch:</b> <code>${telegramService.escapeHtml(result.ref || projectConfig.ref)}</code>\n` +
      `🆔 <b>Pipeline ID:</b> <code>#${telegramService.escapeHtml(result.id)}</code>\n` +
      `📊 <b>Status:</b> <code>${telegramService.escapeHtml(result.status || 'created')}</code>\n` +
      `🔗 <b>Tautan Pipeline:</b> <a href="${telegramService.escapeHtml(result.web_url)}">${telegramService.escapeHtml(result.web_url)}</a>`;

    await telegramService.sendTelegramMessage({
      chatId,
      text: successMessage,
      replyToMessageId: messageId
    });
  } catch (err) {
    console.error(`[GitLab Trigger Error] Gagal memicu pipeline untuk ${matchedKey}:`, err.message);

    const errorMessage = 
      `❌ <b>Gagal Memicu GitLab Pipeline</b>\n\n` +
      `📦 <b>Proyek:</b> <code>${telegramService.escapeHtml(matchedKey)}</code>\n` +
      `⚠️ <b>Keterangan:</b> ${telegramService.escapeHtml(err.message)}\n\n` +
      `<i>Periksa branch target, Trigger Token, atau hak akses proyek di GitLab.</i>`;

    await telegramService.sendTelegramMessage({
      chatId,
      text: errorMessage,
      replyToMessageId: messageId
    });
  }
}

// Hanya jalankan app.listen jika file dieksekusi langsung (bukan saat di-import oleh test)
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`[Server] Webhook service berjalan pada port ${PORT}`);
    console.log(`[Config] Whitelist Chat ID: ${process.env.ALLOWED_CHAT_ID ? 'Terkonfigurasi' : 'Belum diatur'}`);
    console.log(`[Config] Secret Token: ${process.env.TELEGRAM_SECRET_TOKEN ? 'Terkonfigurasi' : 'Belum diatur'}`);
  });

  // Graceful shutdown handling untuk Docker / Cloud Platform
  const handleShutdown = (signal) => {
    console.log(`\n[Server] Menerima ${signal}. Mematikan server secara graceful...`);
    server.close(() => {
      console.log('[Server] Server ditutup.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

module.exports = {
  app,
  isSecretTokenValid,
  isChatAllowed,
  processTelegramUpdate
};
