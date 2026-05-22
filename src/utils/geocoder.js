const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

/**
 * Mengubah alamat teks menjadi koordinat menggunakan Google Maps Geocoding API.
 * @param {string} address Teks alamat dari pengguna
 * @returns {Promise<{lat: number, lng: number, formattedAddress: string} | null>}
 */
async function geocodeAddress(address) {
  if (!address) return null;
  
  const apiKey = config.googleMapsApiKey;
  if (!apiKey) {
    logger.warn('⚠️ GOOGLE_MAPS_API_KEY tidak dikonfigurasi. Geocoding otomatis dilewati.');
    return null; // Fallback otomatis ke Shareloc manual
  }

  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        address: address,
        key: apiKey,
        region: 'id', // Bias to Indonesia
      }
    });

    const data = response.data;
    if (data.status === 'OK' && data.results && data.results.length > 0) {
      const result = data.results[0];
      const location = result.geometry.location;
      
      return {
        lat: location.lat,
        lng: location.lng,
        formattedAddress: result.formatted_address,
      };
    } else {
      logger.warn({ address, status: data.status }, '⚠️ Geocoding gagal menemukan alamat yang akurat.');
      return null;
    }
  } catch (error) {
    logger.error({ error: error.message, address }, '❌ Error saat memanggil Google Maps Geocoding API');
    return null;
  }
}

module.exports = { geocodeAddress };
