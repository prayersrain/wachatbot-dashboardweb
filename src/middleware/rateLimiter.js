const rateLimit = require('express-rate-limit');

const webhookLimiter = rateLimit({
  windowMs: 10 * 1000, // 10 seconds
  max: 20, // 20 requests per 10 seconds (Meta can send multiple webhook events)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

module.exports = { webhookLimiter };
