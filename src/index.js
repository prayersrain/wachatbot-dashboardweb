const logger = require('./utils/logger');
const app = require('./app');
const config = require('./config');
const { connectToWhatsApp } = require('./whatsapp/baileys');
const { handleIncomingMessage } = require('./flow/router');
const { startScheduler, stopScheduler } = require('./utils/scheduler');
const { startStatusListener } = require('./flow/statusListener');

// ============================================================
// STARTUP VALIDATION
// ============================================================

const requiredEnvVars = [
  { key: 'SUPABASE_URL', label: 'Supabase URL' },
  { key: 'SUPABASE_ANON_KEY', label: 'Supabase Anon Key' },
  { key: 'GEMINI_API_KEY', label: 'Gemini API Key' },
  { key: 'ADMIN_PHONE', label: 'Admin Phone Number' },
  { key: 'STORE_LAT', label: 'Store Latitude' },
  { key: 'STORE_LNG', label: 'Store Longitude' },
  { key: 'STORE_ADDRESS', label: 'Store Address' },
  { key: 'STORE_PHONE', label: 'Store Phone' },
  { key: 'BCA_ACCOUNT_NAME', label: 'BCA Account Name' },
  { key: 'BCA_ACCOUNT_NUMBER', label: 'BCA Account Number' },
];

const missing = requiredEnvVars.filter(v => !process.env[v.key]);
if (missing.length > 0) {
  console.error('\n❌ FATAL: Environment variables berikut belum diset di .env:\n');
  missing.forEach(v => console.error(`   - ${v.key} (${v.label})`));
  console.error('\n   Lihat .env.example untuk referensi.\n');
  process.exit(1);
}

// ============================================================
// START SERVER
// ============================================================

const PORT = config.port || 3000;

app.listen(PORT, () => {
  logger.info(`🚀 Server is listening on port ${PORT}`);
  
  // Start Baileys connection
  logger.info('🔌 Connecting to WhatsApp...');
  connectToWhatsApp(handleIncomingMessage).then(() => {
    // Start scheduler and status listener after WhatsApp is connected
    startScheduler();
    startStatusListener();
  }).catch(err => {
    logger.error({ err }, '❌ Failed to connect to WhatsApp');
  });
});

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

function gracefulShutdown(signal) {
  logger.info(`🛑 ${signal} received. Shutting down gracefully...`);
  stopScheduler();
  
  // Beri waktu 5 detik untuk menyelesaikan request yang sedang berjalan
  setTimeout(() => {
    logger.info('👋 Bot stopped.');
    process.exit(0);
  }, 3000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  logger.error({ err }, '💥 Uncaught Exception! Bot tetap jalan, tapi perlu dicek.');
});

process.on('unhandledRejection', (reason) => {
  // Baileys sering throw rejection kosong ({}) saat sinkronisasi internal — ini aman diabaikan
  const isEmptyObject = reason && typeof reason === 'object' && !(reason instanceof Error) && Object.keys(reason).length === 0;
  if (isEmptyObject) {
    logger.debug('⏭️ Baileys internal rejection (aman, diabaikan)');
    return;
  }
  logger.error({ reason: reason instanceof Error ? reason.message : reason }, '💥 Unhandled Rejection!');
});
