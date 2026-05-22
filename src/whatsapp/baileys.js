const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');
const { lockUser, unlockUser, isUserLocked } = require('../middleware/chatRateLimiter');

let sock;
let onMessageCallback;

// BUKU TELEPON CUSTOM (LID -> Phone Mapping) - Dihapus karena sudah tidak dipakai

/**
 * Message Debounce / Buffering Logic
 */
const userBuffers = new Map();

/**
 * Message Queue Logic (Parallel Per-User)
 */
const MAX_QUEUE_SIZE = 500;
let totalQueueSize = 0;
const userQueues = new Map();
const processingUsers = new Set();

async function processUserQueue(from) {
  if (processingUsers.has(from)) return;
  processingUsers.add(from);

  try {
    const queue = userQueues.get(from);
    while (queue && queue.length > 0) {
      // 1. Batch semua pesan teks berturut-turut untuk menghindari SPAM multiple bubbles
      if (queue[0].normalizedMsg.type === 'text') {
        let batchedText = '';
        let firstMsgObj = null;
        let firstName = null;

        while (queue.length > 0 && queue[0].normalizedMsg.type === 'text') {
          const item = queue.shift();
          totalQueueSize--;
          
          if (!firstMsgObj) {
            firstMsgObj = item.normalizedMsg;
            firstName = item.name;
            batchedText = item.normalizedMsg.text.body;
          } else {
            batchedText += '\n' + item.normalizedMsg.text.body;
          }
        }

        firstMsgObj.text.body = batchedText;
        try {
          if (onMessageCallback) {
            lockUser(from);
            await onMessageCallback(from, firstName, firstMsgObj);
          }
        } catch (err) {
          logger.error({ err, from }, '❌ Error handling message in queue');
        } finally {
          unlockUser(from);
        }
      } else {
        // 2. Proses pesan non-text (gambar, lokasi, dll) satu per satu
        const { name, normalizedMsg } = queue.shift();
        totalQueueSize--;
        try {
          if (onMessageCallback) {
            lockUser(from);
            await onMessageCallback(from, name, normalizedMsg);
          }
        } catch (err) {
          logger.error({ err, from }, '❌ Error handling message in queue');
        } finally {
          unlockUser(from);
        }
      }
    }
  } finally {
    processingUsers.delete(from);
    if (userQueues.has(from) && userQueues.get(from).length === 0) {
      userQueues.delete(from);
    }
  }
}

/**
 * Initialize Baileys Connection
 */
async function connectToWhatsApp(handler) {
  onMessageCallback = handler;
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, '../../auth_info'));
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: logger.child({}, { level: 'silent' }),
    browser: ['Mac OS', 'Chrome', '121.0.6167.85'],
  });

  sock.ev.on('creds.update', saveCreds);

  // Pantau Sinkronisasi Kontak (Fitur Buku Telepon LID dimatikan)
  sock.ev.on('contacts.upsert', (contacts) => {
    // Tidak melakukan mapping LID lagi
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      logger.info('📷 Silakan scan QR Code:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      logger.info({ statusCode, shouldReconnect }, '🔌 Koneksi terputus');
      if (shouldReconnect) {
        logger.info('🔄 Mencoba reconnect dalam 3 detik...');
        setTimeout(() => connectToWhatsApp(handler), 3000);
      } else {
        logger.error('❌ Bot telah di-logout. Hapus folder auth_info/ dan scan ulang QR.');
      }
    } else if (connection === 'open') {
      logger.info('✅ Bot WhatsApp Berhasil Terhubung!');
    }
  });

  const startupTime = Math.floor(Date.now() / 1000);

  sock.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;

    for (const msg of m.messages) {
      if (!msg.message || msg.key.fromMe) continue;

      let from = msg.key.remoteJid;
      
      // KONVERSI LID KE NOMOR HP (Dimatikan)
      // from tetap dibiarkan @lid karena sistem customerFlow akan menanyakan nomor HP langsung.

      const isPersonal = from.endsWith('@s.whatsapp.net') || from.endsWith('@lid');
      if (!from || !isPersonal) continue;

      const messageTimestamp = msg.messageTimestamp;
      if (messageTimestamp < (startupTime - 60)) continue;

      const botNumber = sock.user.id.split(':')[0];
      if (from.includes(botNumber)) continue;

      const name = msg.pushName || 'Pelanggan';
      const messageContent = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.buttonsResponseMessage?.selectedButtonId || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId || '';

      const normalizedMsg = {
        from,
        name,
        text: { body: messageContent },
        type: 'text',
        raw: msg
      };

      const locMsg = msg.message.locationMessage || msg.message.liveLocationMessage;
      if (locMsg) {
        normalizedMsg.type = 'location';
        normalizedMsg.location = { latitude: locMsg.degreesLatitude, longitude: locMsg.degreesLongitude, name: locMsg.name || locMsg.address || '' };
      } else if (Object.keys(msg.message)[0] === 'imageMessage') {
        normalizedMsg.type = 'image';
      }

      if (totalQueueSize >= MAX_QUEUE_SIZE) {
        logger.warn({ from, totalQueueSize }, '⚠️ Queue penuh, pesan di-skip');
        continue;
      }
      
      const pushToQueue = (f, n, msg) => {
        if (!userQueues.has(f)) userQueues.set(f, []);
        userQueues.get(f).push({ name: n, normalizedMsg: msg });
        totalQueueSize++;
        processUserQueue(f);
      };
      
      // Message Debouncing (Buffering) untuk menggabungkan chat yang beruntun
      if (normalizedMsg.type === 'text') {
        if (!userBuffers.has(from)) {
          userBuffers.set(from, {
            text: normalizedMsg.text.body,
            timer: null,
            msg: normalizedMsg // Simpan object pesan terakhir
          });
        } else {
          const buffer = userBuffers.get(from);
          // Gabungkan teks dengan spasi
          buffer.text += ' ' + normalizedMsg.text.body;
          buffer.msg = normalizedMsg; 
          clearTimeout(buffer.timer); // Reset timer
        }

        const buffer = userBuffers.get(from);
        
        // Set delay 3 detik untuk menunggu chat tambahan
        buffer.timer = setTimeout(() => {
          buffer.msg.text.body = buffer.text; // Update object dengan teks gabungan
          userBuffers.delete(from);
          pushToQueue(from, name, buffer.msg);
        }, 3000); 
        
      } else {
        // Untuk gambar/lokasi, langsung masuk antrean tanpa delay
        pushToQueue(from, name, normalizedMsg);
      }
    }
  });

  return sock;
}

function getSocket() {
  return sock;
}

module.exports = { connectToWhatsApp, getSocket };
