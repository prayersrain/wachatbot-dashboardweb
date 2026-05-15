const logger = require('../utils/logger');
const config = require('../config');
const { handleCustomerMessage } = require('./customerFlow');
const { handleAdminCommand, isAdminCommand } = require('./adminFlow');
const { checkRateLimit } = require('../middleware/chatRateLimiter');

/**
 * Route incoming messages to the correct handler
 */
async function handleIncomingMessage(from, name, message) {
  // Bersihkan ID pengirim
  const senderID = from.split('@')[0];
  const cleanFrom = senderID.replace(/\D/g, '').replace(/^0/, '62');
  
  // Bersihkan nomor Admin dari config
  const cleanAdmin = config.adminPhone.replace(/\D/g, '').replace(/^0/, '62');
  
  // Cek Admin (Sangat Fleksibel)
  let isAdmin = cleanFrom === cleanAdmin || from === config.adminPhone || from.includes(config.adminPhone);
  
  // Tampilkan di terminal siapa yang chat (Selalu muncul di INFO)
  logger.info({ from, name }, `📩 Chat masuk dari: ${from}`);

  // Jika belum terdeteksi admin, coba cek di contacts_map.json (Resolving LID)
  if (!isAdmin && from.endsWith('@lid')) {
    try {
      const fs = require('fs');
      const path = require('path');
      const mapPath = path.join(process.cwd(), 'contacts_map.json');
      if (fs.existsSync(mapPath)) {
        const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
        const resolvedJid = map[from];
        if (resolvedJid) {
          const resolvedNumber = resolvedJid.split('@')[0].replace(/\D/g, '');
          if (resolvedNumber === cleanAdmin) {
            isAdmin = true;
            logger.debug({ from, resolvedNumber }, '🔍 LID resolved to Admin Number via map');
          }
        }
      }
    } catch (e) {
      // Ignore error reading map
    }
  }

  logger.debug({ from, isAdmin }, '📨 Routing Message');

  // GLOBAL PAUSE CHECK
  const db = require('../database/supabase');
  const isPaused = await db.getGlobalSetting('is_paused');
  if (isPaused && !isAdmin) {
    logger.debug({ from }, '⏭️ Bot is paused. Skipping message.');
    return; // Completely ignore all messages from non-admins if paused
  }

  // Check rate limit and anti-spam
  const isAllowed = await checkRateLimit(from);
  if (!isAllowed) {
    return; // Drop message if rate limited or blocked
  }

  const text = message.text?.body || '';

  // Jika bukan admin tapi mencoba pakai perintah /
  if (!isAdmin && text.startsWith('/')) {
    logger.warn({ from }, '⚠️ Akses Admin Ditolak');
  }

  // Check if admin is sending a command
  if (isAdmin && text.startsWith('/') && isAdminCommand(text)) {
    return handleAdminCommand(from, text);
  }

  // Jika Admin chat biasa (bukan perintah), bot diam saja (tidak masuk alur pemesanan)
  if (isAdmin) {
    return;
  }

  // Everything else goes to customer flow
  return handleCustomerMessage(from, name, message);
}

module.exports = { handleIncomingMessage };
