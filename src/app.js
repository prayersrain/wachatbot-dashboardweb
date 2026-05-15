const express = require('express');
const { webhookLimiter } = require('./middleware/rateLimiter');
const { handleLalamoveWebhook } = require('./lalamove/webhook');
const { getSocket } = require('./whatsapp/baileys');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint (informatif)
app.get('/', (req, res) => {
  const sock = getSocket();
  res.json({
    status: 'running',
    bot: 'Yoyo Bakery WhatsApp Bot',
    whatsapp: sock ? 'connected' : 'disconnected',
    uptime: `${Math.floor(process.uptime())} seconds`,
    timestamp: new Date().toISOString(),
  });
});

// Lalamove webhook with rate limiter and verification
app.post('/webhook/lalamove', webhookLimiter, handleLalamoveWebhook);

module.exports = app;
