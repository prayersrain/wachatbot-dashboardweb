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
 * Message Queue Logic
 */
const MAX_QUEUE_SIZE = 200;
const messageQueue = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing || messageQueue.length === 0) return;
  isProcessing = true;

  try {
    while (messageQueue.length > 0) {
      const { from, name, normalizedMsg } = messageQueue.shift();
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
  } finally {
    isProcessing = false;
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
    logger: logger.child({}, { level: 'warn' }),
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

      if (messageQueue.length >= MAX_QUEUE_SIZE) {
        logger.warn({ from, queueSize: messageQueue.length }, '⚠️ Queue penuh, pesan di-skip');
        continue;
      }
      
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
          
          // Setelah digabung, masukkan ke antrean utama
          const existingIndex = messageQueue.findIndex(m => m.from === from);
          if (existingIndex !== -1) {
            messageQueue[existingIndex] = { from, name, normalizedMsg: buffer.msg };
          } else {
            messageQueue.push({ from, name, normalizedMsg: buffer.msg });
          }
          
          userBuffers.delete(from);
          processQueue();
        }, 3000); 
        
      } else {
        // Untuk gambar/lokasi, langsung masuk antrean tanpa delay
        messageQueue.push({ from, name, normalizedMsg });
        processQueue();
      }
    }
  });

  return sock;
}

function getSocket() {
  return sock;
}

module.exports = { connectToWhatsApp, getSocket };
