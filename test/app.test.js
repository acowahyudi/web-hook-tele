const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Set environment test variables sebelum modul di-load
process.env.PORT = '0';
process.env.TELEGRAM_SECRET_TOKEN = 'secret_token_123';
process.env.ALLOWED_CHAT_ID = '-1001234567890,-1009876543210';
process.env.BOT_TOKEN = 'mock_bot_token';

const { app, isSecretTokenValid, isChatAllowed, processTelegramUpdate } = require('../app');
const { escapeHtml } = require('../services/telegram');
const projects = require('../config/projects');
const gitlabService = require('../services/gitlab');
const telegramService = require('../services/telegram');

describe('Security & Validation Helper Tests', () => {
  test('isSecretTokenValid harus mengembalikan true jika token cocok', () => {
    assert.strictEqual(isSecretTokenValid('secret_token_123', 'secret_token_123'), true);
  });

  test('isSecretTokenValid harus mengembalikan false jika token salah atau berbeda panjang', () => {
    assert.strictEqual(isSecretTokenValid('wrong_token', 'secret_token_123'), false);
    assert.strictEqual(isSecretTokenValid('short', 'secret_token_123'), false);
    assert.strictEqual(isSecretTokenValid(undefined, 'secret_token_123'), false);
  });

  test('isChatAllowed harus mengizinkan chat ID yang terdaftar dalam whitelist', () => {
    assert.strictEqual(isChatAllowed('-1001234567890'), true);
    assert.strictEqual(isChatAllowed('-1009876543210'), true);
    assert.strictEqual(isChatAllowed(-1001234567890), true);
  });

  test('isChatAllowed harus menolak chat ID yang tidak terdaftar', () => {
    assert.strictEqual(isChatAllowed('-999999999999'), false);
    assert.strictEqual(isChatAllowed('123456'), false);
  });

  test('escapeHtml harus melakukan sanitasi karakter rawan XSS/HTML inject', () => {
    const raw = '<script>alert("test & test")</script>';
    const sanitized = escapeHtml(raw);
    assert.strictEqual(sanitized, '&lt;script&gt;alert(&quot;test &amp; test&quot;)&lt;/script&gt;');
  });

  test('Regex alias proyek harus memvalidasi nama proyek alfanumerik, dash, dan underscore', () => {
    const aliasRegex = /^[a-zA-Z0-9_-]+$/;
    assert.strictEqual(aliasRegex.test('project-a'), true);
    assert.strictEqual(aliasRegex.test('Project_123'), true);
    assert.strictEqual(aliasRegex.test('my-api-service_v2'), true);

    // Kasus ilegal (karakter berbahaya atau spasi)
    assert.strictEqual(aliasRegex.test('project a'), false);
    assert.strictEqual(aliasRegex.test('project;rm -rf'), false);
    assert.strictEqual(aliasRegex.test('project$name'), false);
    assert.strictEqual(aliasRegex.test(''), false);
  });
});

describe('HTTP Endpoints Integration Tests', () => {
  let server;
  let baseUrl;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('GET /health harus mengembalikan status 200 dan {"status": "ok"}', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'ok');
    assert.ok(typeof data.uptime === 'number');
  });

  test('GET / harus mengembalikan status 200', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'running');
  });

  test('POST /webhook/telegram harus menolak request tanpa X-Telegram-Bot-Api-Secret-Token dengan HTTP 403', async () => {
    const res = await fetch(`${baseUrl}/webhook/telegram`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: { text: 'test' } })
    });

    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.error, 'Forbidden: Invalid secret token');
  });

  test('POST /webhook/telegram harus menolak request dengan X-Telegram-Bot-Api-Secret-Token salah dengan HTTP 403', async () => {
    const res = await fetch(`${baseUrl}/webhook/telegram`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'wrong_secret_token'
      },
      body: JSON.stringify({ message: { text: 'test' } })
    });

    assert.strictEqual(res.status, 403);
  });

  test('POST /webhook/telegram harus mengembalikan HTTP 200 OK dengan secret token yang valid', async () => {
    const res = await fetch(`${baseUrl}/webhook/telegram`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'secret_token_123'
      },
      body: JSON.stringify({
        update_id: 10001,
        message: {
          message_id: 42,
          chat: { id: -1001234567890 },
          text: 'halo bot'
        }
      })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
  });
});

describe('Telegram Message Processing Logic Tests (Mocked Services)', () => {
  let originalSendMessage;
  let originalTriggerPipeline;
  let sentMessages = [];
  let triggeredPipelines = [];

  before(() => {
    originalSendMessage = telegramService.sendTelegramMessage;
    originalTriggerPipeline = gitlabService.triggerGitlabPipeline;

    // Mock sendTelegramMessage
    telegramService.sendTelegramMessage = async (options) => {
      sentMessages.push(options);
      return { ok: true };
    };

    // Mock triggerGitlabPipeline
    gitlabService.triggerGitlabPipeline = async (projectConfig) => {
      triggeredPipelines.push(projectConfig);
      if (projectConfig.token === 'error_token') {
        throw new Error('GitLab API Error [HTTP 401]: {"message":"401 Unauthorized"}');
      }
      return {
        success: true,
        id: 987654,
        web_url: 'https://gitlab.com/org/repo/-/pipelines/987654',
        status: 'created',
        ref: projectConfig.ref || 'main'
      };
    };
  });

  after(() => {
    telegramService.sendTelegramMessage = originalSendMessage;
    gitlabService.triggerGitlabPipeline = originalTriggerPipeline;
  });

  beforeEach(() => {
    sentMessages = [];
    triggeredPipelines = [];
  });

  test('Mengabaikan pesan dari grup yang tidak di-whitelist', async () => {
    await processTelegramUpdate({
      message: {
        message_id: 1,
        chat: { id: -999999999 }, // Tidak terdaftar
        text: 'git pull project-a'
      }
    });

    assert.strictEqual(sentMessages.length, 0);
    assert.strictEqual(triggeredPipelines.length, 0);
  });

  test('Mengabaikan pesan non-command biasa di dalam grup resmi', async () => {
    await processTelegramUpdate({
      message: {
        message_id: 2,
        chat: { id: -1001234567890 },
        text: 'halo guys, ada update apa hari ini?'
      }
    });

    assert.strictEqual(sentMessages.length, 0);
    assert.strictEqual(triggeredPipelines.length, 0);
  });

  test('Memberikan pesan bantuan jika hanya mengetik "git pull" tanpa alias', async () => {
    await processTelegramUpdate({
      message: {
        message_id: 3,
        chat: { id: -1001234567890 },
        text: 'git pull'
      }
    });

    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].text.includes('Format Perintah Belum Lengkap'));
    assert.ok(sentMessages[0].text.includes('project-a'));
    assert.strictEqual(sentMessages[0].replyToMessageId, 3);
  });

  test('Menolak format alias yang mengandung karakter ilegal (regex)', async () => {
    await processTelegramUpdate({
      message: {
        message_id: 4,
        chat: { id: -1001234567890 },
        text: 'git pull project;rm -rf'
      }
    });

    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].text.includes('Format Nama Proyek Tidak Valid'));
    assert.strictEqual(triggeredPipelines.length, 0);
  });

  test('Memberitahukan jika proyek tidak terdaftar di config/projects.js', async () => {
    await processTelegramUpdate({
      message: {
        message_id: 5,
        chat: { id: -1001234567890 },
        text: 'git pull project-unknown'
      }
    });

    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].text.includes('Proyek Tidak Terdaftar'));
    assert.ok(sentMessages[0].text.includes('project-unknown'));
    assert.strictEqual(triggeredPipelines.length, 0);
  });

  test('Berhasil memicu pipeline GitLab jika proyek terdaftar (case-insensitive + bot mention)', async () => {
    projects['project-a'].token = 'valid_trigger_token';

    await processTelegramUpdate({
      message: {
        message_id: 6,
        chat: { id: -1001234567890 },
        text: '/git pull PROJECT-A@DeployBot'
      }
    });

    assert.strictEqual(triggeredPipelines.length, 1);
    assert.strictEqual(triggeredPipelines[0].projectId, '12345678');
    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].text.includes('GitLab CI/CD Pipeline Berhasil Dibuat!'));
    assert.ok(sentMessages[0].text.includes('#987654'));
    assert.ok(sentMessages[0].text.includes('https://gitlab.com/org/repo/-/pipelines/987654'));
  });

  test('Mengirim pesan error jika GitLab menolak trigger pipeline', async () => {
    projects['project-a'].token = 'error_token';

    await processTelegramUpdate({
      message: {
        message_id: 7,
        chat: { id: -1001234567890 },
        text: 'git pull project-a'
      }
    });

    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].text.includes('Gagal Memicu GitLab Pipeline'));
    assert.ok(sentMessages[0].text.includes('401 Unauthorized'));
  });
});
