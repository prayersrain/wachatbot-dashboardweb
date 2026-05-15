-- ============================================
-- Yoyo Bolen Bot - Seed Data (Products)
-- Run this AFTER schema.sql
-- ============================================

-- Kue Kering (600ml containers)
INSERT INTO products (name, price, category, description, stock_type) VALUES
  ('Nastar Classic', 75000, 'kue_kering', 'Nastar lembut dengan isian nanas manis segar', 'ready'),
  ('Nastar Keju', 75000, 'kue_kering', 'Nastar lembut dengan topping keju gurih', 'ready'),
  ('Nutella Butter Cookies', 75000, 'kue_kering', 'Butter cookies renyah dengan topping Nutella', 'po'),
  ('Stick Choco', 70000, 'kue_kering', 'Stik renyah dengan lapisan cokelat', 'ready'),
  ('Thumbprint Choco', 70000, 'kue_kering', 'Crunchy dengan isi cokelat', 'po'),
  ('Sagu Keju', 70000, 'kue_kering', 'Renyah, ringan, dan lumer dengan rasa keju', 'ready'),
  ('Choco Almond', 70000, 'kue_kering', 'Cookies cokelat dengan taburan almond', 'po'),
  ('Kastengel', 70000, 'kue_kering', 'Renyah dan gurih dengan keju melimpah', 'ready'),
  ('Lidah Kucing', 65000, 'kue_kering', 'Tipis, renyah, dan buttery', 'ready'),
  ('Redvelvet Cookies', 65000, 'kue_kering', 'Lembut dengan rasa khas red velvet', 'po'),
  ('Putri Salju', 65000, 'kue_kering', 'Lembut dan manis dengan balutan gula halus', 'ready'),
  ('Semprit Susu', 65000, 'kue_kering', 'Lembut dengan rasa susu yang creamy', 'po'),
  ('Skippy Cookies', 65000, 'kue_kering', 'Cookies kacang dengan rasa peanut butter', 'po')
ON CONFLICT DO NOTHING;

-- Roti & Pastry
INSERT INTO products (name, price, category, description, stock_type) VALUES
  ('Roti Sisir Polos', 28000, 'roti_pastry', 'Roti sisir tanpa topping', 'ready'),
  ('Roti Sisir Original', 35000, 'roti_pastry', 'Roti sisir original', 'ready'),
  ('Roti Sisir Full Coklat', 52000, 'roti_pastry', 'Roti sisir dengan coklat penuh', 'ready'),
  ('Roti Sisir Full Moca', 55000, 'roti_pastry', 'Roti sisir rasa moca', 'po'),
  ('Roti Sisir Full Keju', 56000, 'roti_pastry', 'Roti sisir dengan keju penuh', 'ready'),
  ('Roti Abon Ayam', 58000, 'roti_pastry', 'Roti dengan abon ayam', 'po'),
  ('Roti Abon Sapi', 58000, 'roti_pastry', 'Roti dengan abon sapi', 'po'),
  ('Choco Roll', 60000, 'roti_pastry', 'Roll cokelat lembut', 'ready'),
  ('Cheese Roll', 60000, 'roti_pastry', 'Roll keju gurih', 'ready'),
  ('Choco Cheese Roll', 65000, 'roti_pastry', 'Roll kombinasi cokelat dan keju', 'po'),
  ('Bolen Coklat Keju', 65000, 'roti_pastry', 'Bolen isi coklat dan keju', 'ready'),
  ('Bolen Full Coklat', 65000, 'roti_pastry', 'Bolen isi coklat penuh', 'ready'),
  ('Bolen Full Keju', 65000, 'roti_pastry', 'Bolen isi keju penuh', 'ready'),
  ('Roti Cream Cheese', 75000, 'roti_pastry', 'Roti dengan cream cheese premium', 'po')
ON CONFLICT DO NOTHING;

-- Cake & Dessert
INSERT INTO products (name, price, category, description, stock_type) VALUES
  ('Nona Manis', 40000, 'cake_dessert', 'Kue tradisional manis', 'ready'),
  ('Kue Soes', 55000, 'cake_dessert', 'Kue soes lembut dengan isian cream', 'ready'),
  ('Brownies', 70000, 'cake_dessert', 'Brownies cokelat premium', 'ready'),
  ('Bolu Potong', 95000, 'cake_dessert', 'Bolu potong lembut', 'po'),
  ('Marmer Cake', 155000, 'cake_dessert', 'Marmer cake premium ukuran besar', 'po')
ON CONFLICT DO NOTHING;
