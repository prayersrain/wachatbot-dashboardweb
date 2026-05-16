import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
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
  Loader2,
  Search,
  Tag
} from 'lucide-react';
import { SkeletonProduct } from '../components/Skeleton';

// Lazy image component with blur placeholder + intersection observer
function LazyImage({ src, alt, className = '' }) {
  const [loaded, setLoaded] = useState(false);
  const [inView, setInView] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    if (!imgRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' }
    );
    observer.observe(imgRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={imgRef} className={`relative ${className}`}>
      {/* Blur placeholder */}
      {!loaded && (
        <div className="absolute inset-0 bg-stone-100 animate-pulse" />
      )}
      {inView && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={`w-full h-full object-cover transition-all duration-500 ${loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-105'}`}
        />
      )}
    </div>
  );
}

export default function Products() {
  const toast = useToast();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
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
    
    if (!error) setProducts(data || []);
    setLoading(false);
  };

  const handleImageUpload = async (productId, file) => {
    if (!file) return;
    
    try {
      setUploadingId(productId);
      
      const fileExt = file.name.split('.').pop();
      const fileName = `${productId}-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('products')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('products')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('products')
        .update({ image_url: publicUrl })
        .eq('id', productId);

      if (updateError) throw updateError;

      toast.success('Foto produk berhasil diperbarui!');
      await fetchProducts();
    } catch (error) {
      console.error('Error uploading image:', error);
      toast.error('Gagal upload gambar. Pastikan Policy Storage di Supabase sudah diatur.');
    } finally {
      setUploadingId(null);
    }
  };

  const startEdit = (product) => {
    setEditingId(product.id);
    setEditForm({ ...product });
  };

  const saveEdit = async () => {
    if (!editForm.name || Number(editForm.price) <= 0) {
      toast.warning('Nama tidak boleh kosong dan harga harus lebih dari 0.');
      return;
    }

    const { error } = await supabase
      .from('products')
      .update({
        name: editForm.name,
        price: Number(editForm.price),
        stock_status: editForm.stock_status,
        description: editForm.description
      })
      .eq('id', editingId);

    if (error) {
      toast.error('Gagal simpan: ' + error.message);
    } else {
      toast.success(`"${editForm.name}" berhasil diperbarui!`);
      setEditingId(null);
      fetchProducts();
    }
  };

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-secondary tracking-tight">Inventaris Produk</h1>
          <p className="text-stone-muted font-medium mt-1">Kelola menu roti, harga, dan ketersediaan stok.</p>
        </div>
        <div className="relative w-full md:w-72">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300" />
          <input 
            type="text" 
            placeholder="Cari roti..." 
            className="w-full bg-white border border-stone-100 rounded-2xl py-3 pl-11 pr-4 outline-none focus:border-primary focus:ring-4 focus:ring-primary/5 transition-all text-sm font-medium"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
        {loading ? (
          [...Array(10)].map((_, i) => <SkeletonProduct key={i} />)
        ) : filteredProducts.length === 0 ? (
          <div className="col-span-full py-20 bg-white border-2 border-dashed border-stone-100 rounded-[40px] text-center">
            <Package size={48} className="mx-auto text-stone-200 mb-4" />
            <p className="text-stone-muted font-bold tracking-tight">Tidak ada produk ditemukan.</p>
          </div>
        ) : (
          filteredProducts.map((product) => (
            <div key={product.id} className={`bg-white border transition-all duration-300 rounded-[32px] overflow-hidden group ${editingId === product.id ? 'border-primary ring-4 ring-primary/5' : 'border-stone-100 hover:border-stone-200 hover:shadow-xl'}`}>
              <div className="relative aspect-square bg-stone-50 overflow-hidden">
                {product.image_url ? (
                  <LazyImage src={product.image_url} alt={product.name} className="w-full h-full" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-stone-200">
                    <Package size={40} strokeWidth={1.5} />
                    <span className="text-[10px] font-black uppercase tracking-widest mt-2">No Photo</span>
                  </div>
                )}
                
                <label className="absolute inset-0 bg-secondary/60 backdrop-blur-[2px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                  <input 
                    type="file" 
                    accept="image/*" 
                    hidden 
                    onChange={(e) => handleImageUpload(product.id, e.target.files[0])}
                    disabled={uploadingId === product.id}
                  />
                  {uploadingId === product.id ? (
                    <Loader2 className="animate-spin text-white w-8 h-8" />
                  ) : (
                    <div className="text-white flex flex-col items-center gap-2">
                      <Camera size={24} strokeWidth={2.5} />
                      <span className="text-[10px] font-black uppercase tracking-widest">Ganti Foto</span>
                    </div>
                  )}
                </label>

                <div className="absolute top-3 left-3">
                  <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest shadow-sm border ${
                    product.stock_status === 'ready' ? 'bg-emerald-500 text-white border-emerald-400' : 
                    product.stock_status === 'po' ? 'bg-primary text-white border-primary/50' : 
                    'bg-rose-500 text-white border-rose-400'
                  }`}>
                    {product.stock_status}
                  </span>
                </div>
              </div>
              
              <div className="p-5 space-y-4">
                <div className="space-y-1">
                  {editingId === product.id ? (
                    <input 
                      type="text"
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-primary"
                      value={editForm.name}
                      onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                    />
                  ) : (
                    <h3 className="font-black text-secondary group-hover:text-primary transition-colors truncate">{product.name}</h3>
                  )}
                  
                  {editingId === product.id ? (
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-stone-300">Rp</span>
                        <input 
                          type="number" 
                          className="w-full bg-stone-50 border border-stone-200 rounded-xl py-2 pl-8 pr-2 text-sm font-bold outline-none focus:border-primary"
                          value={editForm.price} 
                          onChange={(e) => setEditForm({...editForm, price: e.target.value})}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-primary font-black text-lg tracking-tighter">Rp {(product.price || 0).toLocaleString('id-ID')}</p>
                  )}
                </div>

                {editingId === product.id && (
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-stone-muted uppercase tracking-widest ml-1">Status Stok</label>
                    <select 
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-primary appearance-none cursor-pointer"
                      value={editForm.stock_status} 
                      onChange={(e) => setEditForm({...editForm, stock_status: e.target.value})}
                    >
                      <option value="ready">Ready Stock</option>
                      <option value="po">Pre-Order (PO)</option>
                      <option value="out_of_stock">Stok Habis</option>
                    </select>
                  </div>
                )}

                <div className="pt-4 border-t border-stone-50">
                  {editingId === product.id ? (
                    <div className="flex gap-2">
                      <button onClick={saveEdit} className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white p-2 rounded-xl flex items-center justify-center transition-all">
                        <Check size={18} strokeWidth={3} />
                      </button>
                      <button onClick={() => setEditingId(null)} className="flex-1 bg-stone-100 hover:bg-stone-200 text-stone-400 p-2 rounded-xl flex items-center justify-center transition-all">
                        <X size={18} strokeWidth={3} />
                      </button>
                    </div>
                  ) : (
                    <button 
                      onClick={() => startEdit(product)} 
                      className="w-full bg-stone-50 hover:bg-primary hover:text-white text-stone-400 p-3 rounded-2xl flex items-center justify-center gap-2 transition-all group/btn"
                    >
                      <Edit3 size={16} className="group-hover/btn:rotate-12 transition-transform" />
                      <span className="text-[10px] font-black uppercase tracking-widest">Edit Produk</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
