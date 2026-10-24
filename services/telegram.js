const axios = require('axios');

/**
 * Sanitasi string untuk HTML mode di Telegram
 * @param {string} text 
 * @returns {string}
 */
function escapeHtml(text) {
  if (typeof text !== 'string') return String(text ?? '');
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Mengirim pesan balasan ke Telegram Chat menggunakan Bot API sendMessage
 * 
 * @param {Object} options
 * @param {string|number} options.chatId ID Chat atau Grup Telegram
 * @param {string} options.text Konten pesan (format HTML didukung)
 * @param {number} [options.replyToMessageId] Message ID yang akan dibalas (opsional)
 * @param {string} [options.parseMode='HTML'] Mode parsing (HTML / MarkdownV2)
 * @param {boolean} [options.disableWebPagePreview=false] Nonaktifkan preview tautan web
 * @returns {Promise<Object>} Respons data dari Telegram API
 */
async function sendTelegramMessage({
  chatId,
  text,
  replyToMessageId = null,
  parseMode = 'HTML',
  disableWebPagePreview = false
}) {
  const botToken = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    console.error('[TelegramService] Error: BOT_TOKEN tidak ditemukan pada environment variables.');
    throw new Error('BOT_TOKEN environment variable belum dikonfigurasi.');
  }

  const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: parseMode,
    disable_web_page_preview: disableWebPagePreview
  };

  if (replyToMessageId) {
    payload.reply_to_message_id = replyToMessageId;
    payload.allow_sending_without_reply = true; // Tetap kirim meski pesan asli terhapus
  }

  try {
    const response = await axios.post(endpoint, payload, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    return response.data;
  } catch (error) {
    let errorDetail = error.message;
    if (error.response?.data) {
      errorDetail = JSON.stringify(error.response.data);
    }
    console.error(`[TelegramService] Gagal mengirim pesan ke chat ${chatId}: ${errorDetail}`);
    throw new Error(`Telegram API Error: ${errorDetail}`);
  }
}

module.exports = {
  sendTelegramMessage,
  escapeHtml
};
