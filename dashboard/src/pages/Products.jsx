import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { 
  Package, 
  Edit3, 
  Save, 
  X, 
  Plus, 
  Trash2,
  Check,
  AlertCircle,
  Camera,
  Loader2
} from 'lucide-react';

export default function Products() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [uploadingId, setUploadingId] = useState(null);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('name', { ascending: true });
    
    if (!error) setProducts(data);
    setLoading(false);
  };

  const handleImageUpload = async (productId, file) => {
    if (!file) return;
    
    try {
      setUploadingId(productId);
      
      const fileExt = file.name.split('.').pop();
      const fileName = `${productId}-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      // 1. Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('products')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // 2. Get Public URL
      const { data: { publicUrl } } = supabase.storage
        .from('products')
        .getPublicUrl(filePath);

      // 3. Update Product in Database
      const { error: updateError } = await supabase
        .from('products')
        .update({ image_url: publicUrl })
        .eq('id', productId);

      if (updateError) throw updateError;

      await fetchProducts();
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Gagal upload gambar: ' + error.message);
    } finally {
      setUploadingId(null);
    }
  };

  const startEdit = (product) => {
    setEditingId(product.id);
    setEditForm({ ...product });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async () => {
    const { error } = await supabase
      .from('products')
      .update({
        price: Number(editForm.price),
        stock_status: editForm.stock_status,
        description: editForm.description
      })
      .eq('id', editingId);

    if (error) {
      alert('Gagal simpan: ' + error.message);
    } else {
      setEditingId(null);
      fetchProducts();
    }
  };

  return (
    <div className="products-page">
      <header className="page-header">
        <h1 className="text-gradient">Inventaris Produk</h1>
        <p>Atur harga dan ketersediaan stok roti secara instan</p>
      </header>

      <div className="products-grid animate-fade">
        {loading ? (
          <div className="loading-state">Memuat daftar produk...</div>
        ) : (
          products.map((product) => (
            <div key={product.id} className={`product-card glass-card ${editingId === product.id ? 'editing' : ''}`}>
              <div className="product-image-container">
                {product.image_url ? (
                  <img src={product.image_url} alt={product.name} className="product-image" />
                ) : (
                  <div className="product-image-placeholder">
                    <Package size={32} />
                  </div>
                )}
                
                <label className="image-upload-overlay">
                  <input 
                    type="file" 
                    accept="image/*" 
                    hidden 
                    onChange={(e) => handleImageUpload(product.id, e.target.files[0])}
                    disabled={uploadingId === product.id}
                  />
                  {uploadingId === product.id ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Camera size={24} />
                  )}
                </label>
              </div>
              
              <div className="product-info">
                <h3>{product.name}</h3>
                
                {editingId === product.id ? (
                  <div className="edit-fields">
                    <div className="field">
                      <label>Harga (Rp)</label>
                      <input 
                        type="number" 
                        value={editForm.price} 
                        onChange={(e) => setEditForm({...editForm, price: e.target.value})}
                      />
                    </div>
                    <div className="field">
                      <label>Status Stok</label>
                      <select 
                        value={editForm.stock_status} 
                        onChange={(e) => setEditForm({...editForm, stock_status: e.target.value})}
                      >
                        <option value="ready">Ready Stock</option>
                        <option value="po">Pre-Order</option>
                        <option value="out_of_stock">Habis</option>
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="display-fields">
                    <p className="product-price">Rp {(product.price || 0).toLocaleString('id-ID')}</p>
                    <span className={`stock-badge ${product.stock_status}`}>
                      {product.stock_status === 'ready' ? 'Ready' : product.stock_status === 'po' ? 'PO' : 'Habis'}
                    </span>
                  </div>
                )}
              </div>

              <div className="product-actions">
                {editingId === product.id ? (
                  <>
                    <button onClick={saveEdit} className="action-btn save">
                      <Save size={18} />
                    </button>
                    <button onClick={cancelEdit} className="action-btn cancel">
                      <X size={18} />
                    </button>
                  </>
                ) : (
                  <button onClick={() => startEdit(product)} className="action-btn edit">
                    <Edit3 size={18} />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <style jsx>{`
        .products-page { max-width: 1200px; margin: 0 auto; }
        .page-header { margin-bottom: 30px; }
        .page-header p { color: var(--text-muted); font-size: 14px; }

        .products-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 20px;
        }

        .product-card {
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 15px;
          transition: var(--transition);
        }
        .product-card:hover { transform: translateY(-5px); }
        .product-card.editing { border-color: var(--primary); background: rgba(245, 158, 11, 0.05); }

        .product-image-container {
          position: relative;
          width: 100%;
          height: 160px;
          background: rgba(255,255,255,0.05);
          border-radius: 12px;
          overflow: hidden;
        }

        .product-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .product-image-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
        }

        .image-upload-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0,0,0,0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: var(--transition);
          cursor: pointer;
        }

        .product-image-container:hover .image-upload-overlay {
          opacity: 1;
        }

        .product-info { flex: 1; }
        .product-info h3 { font-size: 18px; margin-bottom: 8px; }

        .display-fields { display: flex; align-items: center; gap: 15px; }
        .product-price { font-size: 16px; font-weight: 600; color: var(--primary); }

        .stock-badge {
          font-size: 11px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 20px;
          text-transform: uppercase;
        }
        .stock-badge.ready { background: rgba(16, 185, 129, 0.2); color: var(--accent-green); }
        .stock-badge.po { background: rgba(59, 130, 246, 0.2); color: var(--accent-blue); }
        .stock-badge.out_of_stock { background: rgba(239, 68, 68, 0.2); color: var(--accent-red); }

        .edit-fields { display: flex; flex-direction: column; gap: 10px; }
        .field { display: flex; flex-direction: column; gap: 4px; }
        .field label { font-size: 11px; color: var(--text-muted); }
        .field input, .field select {
          background: var(--bg);
          border: 1px solid var(--card-border);
          color: #fff;
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 14px;
        }

        .product-actions { display: flex; gap: 10px; }
        .action-btn {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255,255,255,0.05);
          color: var(--text-muted);
        }
        .action-btn:hover { color: #fff; background: rgba(255,255,255,0.1); }
        .action-btn.save { color: var(--accent-green); }
        .action-btn.cancel { color: var(--accent-red); }
        .action-btn.edit { color: var(--primary); }

        .loading-state { grid-column: 1 / -1; text-align: center; padding: 100px; color: var(--text-muted); }

        @media (max-width: 640px) {
          .products-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
          }
          .product-card { padding: 12px; }
          .product-image-container { height: 110px; }
          .product-info h3 { font-size: 14px; }
          .display-fields { flex-direction: column; align-items: flex-start; gap: 5px; }
          .product-price { font-size: 14px; }
          .product-actions { margin-top: 10px; width: 100%; justify-content: space-between; }
        }
      `}</style>
    </div>
  );
}
