const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

/**
 * Generate HMAC-SHA256 signature for Lalamove API
 */
function generateSignature(timestamp, method, path, body = '') {
  const rawSignature = `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`;
  return crypto
    .createHmac('sha256', config.lalamove.apiSecret)
    .update(rawSignature)
    .digest('hex');
}

/**
 * Build auth headers for a Lalamove API request
 */
function getAuthHeaders(method, path, body = '') {
  const timestamp = Date.now().toString();
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const signature = generateSignature(timestamp, method, path, method === 'GET' ? '' : bodyStr);

  return {
    Authorization: `hmac ${config.lalamove.apiKey}:${timestamp}:${signature}`,
    'Content-Type': 'application/json',
    Market: config.lalamove.market,
    'Request-ID': uuidv4(),
  };
}

module.exports = { generateSignature, getAuthHeaders };
