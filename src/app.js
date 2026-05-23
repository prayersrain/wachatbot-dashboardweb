const express = require('express');
const cors = require('cors');
const { webhookLimiter } = require('./middleware/rateLimiter');
const { handleLalamoveWebhook } = require('./lalamove/webhook');
const { getSocket } = require('./whatsapp/baileys');
const sender = require('./whatsapp/sender');
const { getSession, upsertSession } = require('./database/supabase');

const app = express();
app.use(cors());
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

// Endpoint for Dashboard to send message to user
app.post('/api/send-message', async (req, res) => {
  try {
    const { wa_number, message } = req.body;
    if (!wa_number || !message) {
      return res.status(400).json({ success: false, error: 'wa_number and message are required' });
    }

    // Send the message via WhatsApp
    await sender.sendText(wa_number, message);

    // Update session history so AI knows what the admin replied
    const session = await getSession(wa_number);
    if (session) {
      let curHistory = session.data?.history || [];
      curHistory.push({ role: 'bot', content: message });
      if (curHistory.length > 100) curHistory = curHistory.slice(-100);
      
      await upsertSession(wa_number, session.state, { 
        ...session.data, 
        history: curHistory 
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error in /api/send-message:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = app;
