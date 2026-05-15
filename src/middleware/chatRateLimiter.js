const logger = require('../utils/logger');
const config = require('../config');

// In-memory store for rate limiting
const userActivity = new Map();
const userLocks = new Map();

// Configuration
const MAX_MESSAGES_PER_WINDOW = 3; // Kurangi dari 5 menjadi 3
const WINDOW_MS = 30000; // 30 seconds
const BURST_THRESHOLD = 7; // Kurangi dari 10 menjadi 7
const BURST_WINDOW_MS = 60000; // 60 seconds
const BLOCK_DURATION_MS = 120000; // 2 minutes

/**
 * Cleanup expired entries to prevent memory leaks
 */
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [jid, data] of userActivity.entries()) {
    if (now - data.lastMessageTime > Math.max(WINDOW_MS, BURST_WINDOW_MS, BLOCK_DURATION_MS)) {
      userActivity.delete(jid);
    }
  }
  for (const [jid, lockTime] of userLocks.entries()) {
    // If a lock is stuck for more than 5 minutes, clear it
    if (now - lockTime > 5 * 60000) {
      userLocks.delete(jid);
    }
  }
}, 5 * 60000); // Run every 5 minutes

// Allow tests/process to exit gracefully despite this active timer
cleanupInterval.unref();

/**
 * Set processing lock for a user
 * @param {string} jid User ID
 */
function lockUser(jid) {
  userLocks.set(jid, Date.now());
}

/**
 * Release processing lock for a user
 * @param {string} jid User ID
 */
function unlockUser(jid) {
  userLocks.delete(jid);
}

/**
 * Check if user is currently locked (being processed)
 * @param {string} jid User ID
 * @returns {boolean}
 */
function isUserLocked(jid) {
  return userLocks.has(jid);
}

/**
 * Check rate limit and anti-spam rules for a user
 * @param {string} from Sender JID
 * @returns {Promise<boolean>} True if message should be processed, false if dropped
 */
async function checkRateLimit(from) {
  // Exception for Admin
  const cleanFrom = from.split('@')[0].replace(/\D/g, '').replace(/^0/, '62');
  const cleanAdmin = config.adminPhone.replace(/\D/g, '').replace(/^0/, '62');
  if (cleanFrom === cleanAdmin || from === config.adminPhone || from.includes(config.adminPhone)) {
    return true; // Admin is never rate limited
  }

  const now = Date.now();

  if (!userActivity.has(from)) {
    userActivity.set(from, {
      messages: [],
      lastMessageTime: now,
      isBlocked: false,
      blockExpiresAt: 0,
      warnedInWindow: false
    });
  }

  const activity = userActivity.get(from);

  // 1. Check if user is currently blocked
  if (activity.isBlocked) {
    if (now < activity.blockExpiresAt) {
      logger.debug({ from }, '🚫 User is blocked. Dropping message.');
      return false; // Silently drop
    } else {
      // Unblock
      activity.isBlocked = false;
      activity.blockExpiresAt = 0;
      activity.messages = []; // Reset queue
      activity.warnedInWindow = false;
      logger.info({ from }, '✅ User unblocked.');
    }
  }

  // 2. Add current message timestamp
  activity.messages.push(now);
  activity.lastMessageTime = now;

  // 3. Clean up old messages from sliding windows
  activity.messages = activity.messages.filter(time => now - time <= BURST_WINDOW_MS);

  // 4. Burst Detection (Anti-Flood)
  const burstCount = activity.messages.length;
  if (burstCount >= BURST_THRESHOLD) {
    const sender = require('../whatsapp/sender');
    activity.isBlocked = true;
    activity.blockExpiresAt = now + BLOCK_DURATION_MS;
    logger.warn({ from, burstCount }, '🚨 Burst threshold exceeded! Blocking user for 2 minutes.');
    
    // Notify User
    await sender.sendText(from, '⚠️ Kakak terdeteksi mengirim pesan terlalu cepat. Bot akan merespon lagi dalam 2 menit.');
    
    // Notify Admin
    await sender.sendText(config.adminPhone, `🚨 *SPAM ALERT*\nUser ${from.split('@')[0]} mengirim ${burstCount} pesan dalam semenit. Diblokir otomatis selama 2 menit.`);
    
    return false;
  }

  // 5. Normal Rate Limiting (Sliding Window)
  const windowCount = activity.messages.filter(time => now - time <= WINDOW_MS).length;
  if (windowCount > MAX_MESSAGES_PER_WINDOW) {
    if (!activity.warnedInWindow) {
      const sender = require('../whatsapp/sender');
      logger.warn({ from, windowCount }, '⚠️ Rate limit exceeded. Sending warning.');
      await sender.sendText(from, 'Mohon tunggu sebentar ya Kak, pesan Kakak sedang kami proses 🙏');
      activity.warnedInWindow = true; // Only warn once per window
    } else {
      logger.debug({ from }, '⚠️ Rate limit exceeded. Warning already sent. Dropping.');
    }
    return false;
  }

  // Reset warning flag if user drops below threshold
  if (windowCount <= MAX_MESSAGES_PER_WINDOW) {
      activity.warnedInWindow = false;
  }

  return true;
}

module.exports = {
  checkRateLimit,
  lockUser,
  unlockUser,
  isUserLocked
};
