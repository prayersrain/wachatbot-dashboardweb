require('dotenv').config();

const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Shopee (untuk customer Luar Jakarta)
  shopeeUrl: process.env.SHOPEE_URL || 'https://shopee.co.id/yoyobakery',


  // Supabase
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
  },

  // Lalamove
  lalamove: {
    apiKey: process.env.LALAMOVE_API_KEY,
    apiSecret: process.env.LALAMOVE_API_SECRET,
    baseUrl: process.env.LALAMOVE_BASE_URL || 'https://rest.sandbox.lalamove.com',
    market: process.env.LALAMOVE_MARKET || 'ID',
  },

  // Store
  store: {
    lat: process.env.STORE_LAT || '',
    lng: process.env.STORE_LNG || '',
    address: process.env.STORE_ADDRESS || '',
    phone: process.env.STORE_PHONE || '',
    name: process.env.STORE_NAME || 'Yoyo Bakery',
  },

  // Admin
  adminPhone: process.env.ADMIN_PHONE,

  // AI
  geminiApiKey: process.env.GEMINI_API_KEY,
  
  // Geocoding
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,

  // Payment
  payment: {
    bcaName: process.env.BCA_ACCOUNT_NAME || '',
    bcaNumber: process.env.BCA_ACCOUNT_NUMBER || '',
  },
};

module.exports = config;
