const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const logger = require('../utils/logger');

// Initialize Supabase client
const supabase = createClient(config.supabase.url, config.supabase.anonKey);

// Product Cache (hemat query DB)
let _productCache = null;
let _productCacheTime = 0;
const PRODUCT_CACHE_TTL = 5 * 60 * 1000; // 5 menit

// FAQ Cache
let _faqCache = null;
let _faqCacheTime = 0;
const FAQ_CACHE_TTL = 5 * 60 * 1000; // 5 menit

function invalidateProductCache() {
  _productCache = null;
  _productCacheTime = 0;
}

function invalidateFaqCache() {
  _faqCache = null;
  _faqCacheTime = 0;
}

// ==================== CUSTOMERS ====================

async function upsertCustomer(waNumber, name) {
  const { data, error } = await supabase
    .from('customers')
    .upsert(
      { wa_number: waNumber, name, updated_at: new Date().toISOString() },
      { onConflict: 'wa_number' }
    )
    .select()
    .single();

  if (error) {
    logger.error({ error: error.message }, '❌ upsertCustomer error');
    return null;
  }
  return data;
}

async function getCustomerByPhone(waNumber) {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('wa_number', waNumber)
    .single();

  if (error || !data) return null;
  return data;
}

// ==================== PRODUCTS ====================

async function getProducts() {
  // Return cache jika masih valid
  if (_productCache && Date.now() - _productCacheTime < PRODUCT_CACHE_TTL) {
    return _productCache;
  }

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_available', true)
    .order('category')
    .order('price');

  if (error) {
    logger.error({ error: error.message }, '❌ getProducts error');
    return _productCache || []; // Return stale cache if available
  }

  _productCache = data;
  _productCacheTime = Date.now();
  return data;
}

async function getProductsByCategory(category) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_available', true)
    .eq('category', category)
    .order('price');

  if (error) {
    logger.error({ error: error.message }, '❌ getProductsByCategory error');
    return [];
  }
  return data;
}

async function findProductByName(searchName) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_available', true);

  if (error) {
    logger.error({ error: error.message }, '❌ findProductByName error');
    return null;
  }

  // Fuzzy match - case insensitive partial match
  const normalizedSearch = searchName.toLowerCase().trim();
  return data.find((p) => {
    const normalizedName = p.name.toLowerCase();
    return (
      normalizedName === normalizedSearch ||
      normalizedName.includes(normalizedSearch) ||
      normalizedSearch.includes(normalizedName)
    );
  });
}

// ==================== ORDERS ====================

async function createOrder(orderData) {
  const { data, error } = await supabase
    .from('orders')
    .insert(orderData)
    .select()
    .single();

  if (error) {
    logger.error({ error: error.message }, '❌ createOrder error');
    return null;
  }
  return data;
}

async function updateOrder(orderId, updates) {
  updates.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('orders')
    .update(updates)
    .eq('id', orderId)
    .select()
    .single();

  if (error) {
    logger.error({ error: error.message }, '❌ updateOrder error');
    return null;
  }
  return data;
}

async function getOrderById(orderId) {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (error) return null;
  return data;
}

async function getOrderByNumber(orderNumber) {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('order_number', orderNumber)
    .single();

  if (error) return null;
  return data;
}

async function getTodayOrders() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .gte('created_at', today.toISOString())
    .order('created_at', { ascending: false });

  if (error) {
    logger.error({ error: error.message }, '❌ getTodayOrders error');
    return [];
  }
  return data;
}

async function getRecentActiveOrders(days = 3) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .gte('created_at', cutoff)
    .not('order_status', 'in', '("cancelled","completed")')
    .order('created_at', { ascending: false });

  if (error) {
    logger.error({ error: error.message }, '❌ getRecentActiveOrders error');
    return [];
  }
  return data;
}

async function getActiveOrdersByPhone(waNumber) {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('wa_number', waNumber)
    .in('order_status', ['new', 'waiting_payment', 'confirmed', 'packing', 'shipping'])
    .order('created_at', { ascending: false });

  if (error) return [];
  return data;
}

async function hasPreviousOrders(waNumber) {
  const { count, error } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('wa_number', waNumber);
  
  if (error) return false;
  return count > 0;
}

// ==================== SESSIONS ====================

async function upsertSession(waNumber, state, data = {}) {
  const { data: session, error } = await supabase
    .from('sessions')
    .upsert(
      { wa_number: waNumber, state, data, updated_at: new Date().toISOString() },
      { onConflict: 'wa_number' }
    )
    .select()
    .single();

  if (error) {
    logger.error({ error: error.message }, '❌ upsertSession error');
    return null;
  }
  return session;
}

async function getSession(waNumber) {
  const { data: session, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('wa_number', waNumber)
    .single();

  if (error || !session) return null;

  // Check TTL (30 minutes)
  const lastUpdate = new Date(session.updated_at).getTime();
  const now = Date.now();
  const TTL = 30 * 60 * 1000;

  if (now - lastUpdate > TTL) {
    await deleteSession(waNumber);
    return null;
  }

  return session;
}

async function deleteSession(waNumber) {
  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('wa_number', waNumber);

  if (error) {
    logger.error({ error: error.message }, '❌ deleteSession error');
    return false;
  }
  return true;
}

async function getOldSessions(hoursAgo) {
  const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('sessions')
    .select('wa_number')
    .lt('updated_at', cutoff);
  
  if (error) return [];
  return data.map(s => s.wa_number);
}

// Global Settings (Stored in sessions table with 'system:' prefix)
async function getGlobalSetting(key) {
  const id = `system:${key}`;
  const { data, error } = await supabase
    .from('sessions')
    .select('data')
    .eq('wa_number', id)
    .single();
  
  if (error || !data) return null;
  return data.data?.value;
}

async function setGlobalSetting(key, value) {
  const id = `system:${key}`;
  const { error } = await supabase
    .from('sessions')
    .upsert({ 
      wa_number: id, 
      state: 'SYSTEM', 
      data: { value }, 
      updated_at: new Date().toISOString() 
    });
  
  return !error;
}

async function updateProductAvailability(id, isAvailable) {
  const { data, error } = await supabase
    .from('products')
    .update({ is_available: isAvailable })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    invalidateProductCache();
    logger.error({ error: error.message }, '❌ updateProductAvailability error');
    return null;
  }
  return data;
}

async function updateProductStockType(id, stockType) {
  const { data, error } = await supabase
    .from('products')
    .update({ stock_type: stockType })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    invalidateProductCache();
    logger.error({ error: error.message }, '❌ updateProductStockType error');
    return null;
  }
  return data;
}

/**
 * Get orders that are unpaid (pending) and older than given hours
 * Used by the payment reminder scheduler
 */
async function getUnpaidOrdersSince(hoursAgo, retryCount = 0) {
  const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('payment_status', 'pending')
      .eq('order_status', 'waiting_payment')
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true });

    if (error) {
      if (error.message?.includes('fetch') && retryCount < 2) {
        logger.warn({ retry: retryCount + 1 }, '⚠️ Jaringan sibuk, mencoba ulang getUnpaidOrdersSince...');
        await new Promise(r => setTimeout(r, 2000));
        return getUnpaidOrdersSince(hoursAgo, retryCount + 1);
      }
      logger.warn({ error: error.message }, '⚠️ getUnpaidOrdersSince skip (DB error)');
      return [];
    }
    return data;
  } catch (err) {
    if (err.message?.includes('fetch') && retryCount < 2) {
      logger.warn({ retry: retryCount + 1 }, '⚠️ Network failed, mencoba ulang getUnpaidOrdersSince...');
      await new Promise(r => setTimeout(r, 2000));
      return getUnpaidOrdersSince(hoursAgo, retryCount + 1);
    }
    logger.error({ error: err.message }, '❌ getUnpaidOrdersSince fatal error');
    return [];
  }
}

/**
 * Get expired unpaid orders (older than X days) for auto-cancellation
 * With simple retry for network issues
 */
async function getExpiredUnpaidOrders(daysOld, retryCount = 0) {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
  
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('payment_status', 'pending')
      .in('order_status', ['new', 'waiting_payment'])
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true });

    if (error) {
      // Jika error karena jaringan (fetch failed) dan masih punya jatah retry
      if (error.message?.includes('fetch') && retryCount < 2) {
        logger.warn({ retry: retryCount + 1 }, '⚠️ Jaringan sibuk, mencoba ulang getExpiredUnpaidOrders...');
        await new Promise(r => setTimeout(r, 2000));
        return getExpiredUnpaidOrders(daysOld, retryCount + 1);
      }
      logger.warn({ error: error.message }, '⚠️ getExpiredUnpaidOrders skip (DB error)');
      return [];
    }
    return data;
  } catch (err) {
    if (err.message?.includes('fetch') && retryCount < 2) {
      logger.warn({ retry: retryCount + 1 }, '⚠️ Network failed, mencoba ulang getExpiredUnpaidOrders...');
      await new Promise(r => setTimeout(r, 2000));
      return getExpiredUnpaidOrders(daysOld, retryCount + 1);
    }
    logger.error({ error: err.message }, '❌ getExpiredUnpaidOrders fatal error');
    return [];
  }
}
// ==================== FAQS ====================

async function getFaqs() {
  if (_faqCache && Date.now() - _faqCacheTime < FAQ_CACHE_TTL) {
    return _faqCache;
  }

  const { data, error } = await supabase
    .from('faqs')
    .select('question, answer')
    .order('created_at', { ascending: true });

  if (error) {
    logger.error({ error: error.message }, '❌ getFaqs error');
    return _faqCache || []; // Fallback to stale cache if available
  }

  _faqCache = data;
  _faqCacheTime = Date.now();
  return data;
}

// ==================== STORAGE ====================

async function uploadPaymentProof(orderNumber, buffer, mimeType = 'image/jpeg') {
  try {
    const ext = mimeType.split('/')[1] || 'jpg';
    const fileName = `order_${orderNumber}_${Date.now()}.${ext}`;
    
    const { data, error } = await supabase.storage
      .from('receipts')
      .upload(fileName, buffer, {
        contentType: mimeType,
        upsert: true
      });

    if (error) {
      logger.error({ error: error.message }, '❌ uploadPaymentProof error');
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from('receipts')
      .getPublicUrl(fileName);

    return publicUrlData.publicUrl;
  } catch (err) {
    logger.error({ error: err.message }, '❌ uploadPaymentProof exception');
    return null;
  }
}

module.exports = {
  supabase,
  upsertCustomer,
  getCustomerByPhone,
  getProducts,
  getProductsByCategory,
  findProductByName,
  updateProductAvailability,
  updateProductStockType,
  createOrder,
  updateOrder,
  getOrderById,
  getOrderByNumber,
  getTodayOrders,
  getRecentActiveOrders,
  getActiveOrdersByPhone,
  getUnpaidOrdersSince,
  getExpiredUnpaidOrders,
  upsertSession,
  getSession,
  deleteSession,
  getOldSessions,
  getGlobalSetting,
  setGlobalSetting,
  hasPreviousOrders,
  uploadPaymentProof,
  getFaqs,
  invalidateFaqCache,
};
