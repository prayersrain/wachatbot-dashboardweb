-- ============================================
-- Yoyo Bolen Bot - Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Products Table
CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  price INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'uncategorized',
  description TEXT,
  stock_type TEXT NOT NULL DEFAULT 'ready' CHECK (stock_type IN ('ready', 'po')),
  is_available BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Customers Table
CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  wa_number TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Orders Table
CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  order_number SERIAL,
  wa_number TEXT NOT NULL,
  customer_name TEXT DEFAULT 'Pelanggan',
  items JSONB NOT NULL DEFAULT '[]',
  total_price NUMERIC(12,2) DEFAULT 0,
  delivery_fee NUMERIC(12,2) DEFAULT 0,
  customer_lat DOUBLE PRECISION,
  customer_lng DOUBLE PRECISION,
  customer_address TEXT,
  notes TEXT,
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'reviewing', 'paid', 'refunded')),
  order_status TEXT NOT NULL DEFAULT 'new' CHECK (order_status IN ('new', 'waiting_payment', 'confirmed', 'packing', 'dispatched', 'completed', 'cancelled')),
  lalamove_quotation_id TEXT,
  lalamove_order_id TEXT,
  lalamove_share_link TEXT,
  lalamove_status TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Sessions Table (untuk state management pelanggan)
CREATE TABLE IF NOT EXISTS sessions (
  wa_number TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'IDLE',
  data JSONB DEFAULT '{}',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Indexes untuk performa query
CREATE INDEX IF NOT EXISTS idx_orders_wa_number ON orders(wa_number);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_available ON products(is_available);
