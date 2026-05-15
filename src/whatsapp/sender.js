const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { getSocket } = require('./baileys');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Send an image via Baileys
 */
async function sendImage(to, buffer, caption) {
  const sock = getSocket();
  if (!sock) return null;

  const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;

  try {
    const sendPromise = sock.sendMessage(jid, { 
      image: buffer, 
      caption: caption 
    });
    
    // Timeout 15 detik agar tidak stuck
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout sending image')), 15000)
    );
    
    return await Promise.race([sendPromise, timeoutPromise]);
  } catch (err) {
    logger.error({ err: err.message }, '❌ Baileys sendImage error');
    return null;
  }
}
/**
 * Send a plain text message via Baileys
 */
async function sendText(to, text) {
  const sock = getSocket();
  if (!sock) return logger.error('❌ Cannot send message: Baileys socket not connected.');

  let jid = to;
  if (!jid.includes('@')) {
    // Bersihkan dari karakter non-digit
    const cleanNumber = jid.replace(/\D/g, '');
    jid = `${cleanNumber}@s.whatsapp.net`;
  }
  
  // Jika nomor diawali 0, ganti ke 62
  if (jid.startsWith('0')) {
    jid = '62' + jid.slice(1);
    if (!jid.includes('@')) jid += '@s.whatsapp.net';
  }
  
  try {
    // Simulasi mengetik dihapus agar respon instan

    return await sock.sendMessage(jid, { 
      text: text,
      linkPreview: null // Permanent disable for stability
    });
  } catch (err) {
    logger.error({ err }, '❌ Baileys sendText error');
    return null;
  }
}

async function sendButtons(to, bodyText, buttons, headerText) {
  let fullText = (headerText ? `*${headerText}*\n\n` : '') + bodyText + '\n\n';
  buttons.forEach(btn => {
    fullText += `👉 *${btn.text || btn.title}*\n`;
  });
  return sendText(to, fullText);
}

/**
 * Send interactive list message
 */
async function sendInteractiveList(to, bodyText, buttonText, sections, headerText) {
  const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
  
  let fullText = `*${headerText || 'Menu'}*\n\n${bodyText}\n\n`;
  
  sections.forEach(section => {
    fullText += `*${section.title}*\n`;
    section.rows.forEach(row => {
      fullText += `• ${row.title} - ${row.description || ''}\n`;
    });
    fullText += '\n';
  });

  return sendText(to, fullText);
}

/**
 * Request user to send their location
 */
async function sendLocationRequest(to, bodyText) {
  const msg = `${bodyText}\n\n📍 Klik ikon *Lampiran* (📎) -> *Lokasi* -> *Kirim Lokasi Terkini*`;
  return sendText(to, msg);
}

/**
 * Download an image from a Baileys message
 */
async function downloadMedia(msg) {
  try {
    const { downloadMediaMessage } = require('@whiskeysockets/baileys');
    const rawMsg = msg.raw; // Kunci asli dari Baileys
    
    if (!rawMsg) {
      logger.error('❌ Tidak ada data raw message untuk diunduh');
      return null;
    }

    const buffer = await downloadMediaMessage(rawMsg, 'buffer', {});
    return buffer;
  } catch (err) {
    logger.error({ err }, '❌ Error downloading media');
    return null;
  }
}

module.exports = {
  sendText,
  sendImage,
  sendButtons,
  sendInteractiveList,
  sendLocationRequest,
  downloadMedia,
};
