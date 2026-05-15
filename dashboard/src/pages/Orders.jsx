import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { 
  Search, 
  Filter,
  FileSpreadsheet,
  X,
  MapPin,
  User,
  ExternalLink,
  MessageSquare,
  CheckCircle2,
  Clock,
  Package,
  Truck,
  XCircle,
  Volume2,
  VolumeX,
  ShoppingBag
} from 'lucide-react';
import * as XLSX from 'xlsx';

const STATUS_CONFIG = {
  waiting_payment: { label: 'Menunggu Bayar', color: '#F59E0B', icon: Clock },
  confirmed: { label: 'Konfirmasi', color: '#8B5CF6', icon: CheckCircle2 },
  packing: { label: 'Diproses', color: '#F59E0B', icon: Package },
  shipping: { label: 'Dikirim', color: '#0EA5E9', icon: Truck },
  completed: { label: 'Selesai', color: '#10B981', icon: CheckCircle2 },
  cancelled: { label: 'Batal', color: '#EF4444', icon: XCircle }
};

const ORDER_STATUSES = ['all', 'waiting_payment', 'confirmed', 'packing', 'shipping', 'completed', 'cancelled'];

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all');
  const [soundEnabled, setSoundEnabled] = useState(true);
  
  const audioRef = useRef(new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3'));

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (fetchError) console.error('❌ Gagal ambil data pesanan:', fetchError);
    else setOrders(data || []);
    setLoading(false);
  }, []);

  const playNotification = useCallback(() => {
    if (soundEnabled) {
      audioRef.current.play().catch(() => console.log('Audio play blocked'));
    }
    if (Notification.permission === 'granted') {
      new Notification('Pesanan Baru! 🥐', {
        body: 'Ada pelanggan baru nih, cek dashboard ya!',
        icon: '/favicon.png'
      });
    }
  }, [soundEnabled]);

  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel('orders_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => {
        playNotification();
        fetchOrders();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, () => {
        fetchOrders();
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [fetchOrders, playNotification]);

  const updateStatus = async (orderId, newStatus) => {
    const { error } = await supabase
      .from('orders')
      .update({ order_status: newStatus })
      .eq('id', orderId);
    
    if (error) alert('Gagal update: ' + error.message);
    else fetchOrders();
  };

  const exportToExcel = () => {
    const dataToExport = orders.map(o => ({
      'No. Pesanan': `#${o.order_number}`,
      'Nama': o.customer_name,
      'WA': o.wa_number?.split('@')[0],
      'Status': STATUS_CONFIG[o.order_status]?.label || o.order_status,
      'Total': o.total_price,
      'Tanggal': new Date(o.created_at).toLocaleString('id-ID')
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pesanan");
    XLSX.writeFile(wb, `Orders-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const filteredOrders = orders.filter(order => {
    const matchesSearch = 
      String(order.order_number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      String(order.customer_name || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = activeFilter === 'all' || order.order_status === activeFilter;
    return matchesSearch && matchesFilter;
  });

  const getStatusCount = (status) => {
    if (status === 'all') return orders.length;
    return orders.filter(o => o.order_status === status).length;
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-secondary tracking-tight">Daftar Pesanan</h1>
          <p className="text-stone-muted font-medium mt-1">Kelola pesanan roti dari pelanggan WA.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-3 rounded-2xl border transition-all ${soundEnabled ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-stone-100 border-stone-200 text-stone-400'}`}
            title={soundEnabled ? "Matikan Suara" : "Aktifkan Suara"}
          >
            {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
          <button onClick={exportToExcel} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-3 rounded-2xl font-bold shadow-lg shadow-emerald-200 transition-all active:scale-95 text-sm">
            <FileSpreadsheet size={18} />
            <span>Rekap Excel</span>
          </button>
        </div>
      </header>

      {/* Filters & Search */}
      <div className="bg-white border border-stone-100 p-4 md:p-6 rounded-[32px] shadow-sm space-y-6">
        <div className="relative group">
          <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300 group-focus-within:text-primary transition-colors" />
          <input 
            type="text" 
            placeholder="Cari nomor pesanan atau nama pelanggan..." 
            className="w-full bg-stone-50 border border-stone-100 rounded-2xl py-4 pl-12 pr-4 outline-none focus:border-primary focus:ring-4 focus:ring-primary/5 transition-all font-medium"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {ORDER_STATUSES.map(status => (
            <button
              key={status}
              onClick={() => setActiveFilter(status)}
              className={`
                px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2
                ${activeFilter === status 
                  ? 'bg-secondary text-white shadow-lg shadow-secondary/20 scale-105' 
                  : 'bg-stone-50 text-stone-400 hover:bg-stone-100'
                }
              `}
            >
              <span>{status === 'all' ? 'Semua' : STATUS_CONFIG[status]?.label}</span>
              <span className={`px-2 py-0.5 rounded-lg text-[10px] ${activeFilter === status ? 'bg-white/20' : 'bg-stone-200 text-stone-500'}`}>
                {getStatusCount(status)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Orders Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full py-20 text-center animate-pulse">
            <p className="text-stone-muted font-black uppercase tracking-[0.2em] text-xs">Memuat Pesanan...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="col-span-full py-20 bg-white border-2 border-dashed border-stone-100 rounded-[40px] text-center">
            <ShoppingBag size={48} className="mx-auto text-stone-200 mb-4" />
            <p className="text-stone-muted font-bold tracking-tight">Tidak ada pesanan ditemukan.</p>
          </div>
        ) : (
          filteredOrders.map((order) => {
            const config = STATUS_CONFIG[order.order_status] || { label: order.order_status, color: '#A8A29E', icon: Clock };
            const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
            
            return (
              <div 
                key={order.id} 
                className="bg-white border border-stone-100 rounded-[32px] p-6 shadow-sm hover:shadow-xl hover:border-stone-200 transition-all cursor-pointer group"
                onClick={() => setSelectedOrder(order)}
              >
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="text-xl font-black text-secondary group-hover:text-primary transition-colors">#{order.order_number}</h3>
                    <p className="text-sm font-bold text-stone-text mt-0.5">{order.customer_name}</p>
                    <p className="text-[10px] text-stone-muted font-black uppercase tracking-widest mt-1">
                      {new Date(order.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div 
                    className="px-3 py-1.5 rounded-xl flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider"
                    style={{ backgroundColor: `${config.color}15`, color: config.color }}
                  >
                    <config.icon size={12} strokeWidth={3} />
                    {config.label}
                  </div>
                </div>

                <div className="space-y-2 mb-6">
                  {items.slice(0, 2).map((item, idx) => (
                    <div key={idx} className="flex justify-between text-xs font-bold text-stone-text bg-stone-50 px-3 py-2 rounded-xl">
                      <span>{item.qty}x {item.name}</span>
                      <span className="text-stone-muted">Rp {item.price?.toLocaleString('id-ID')}</span>
                    </div>
                  ))}
                  {items.length > 2 && (
                    <p className="text-[10px] font-black text-stone-muted uppercase tracking-widest text-center">+{items.length - 2} Produk Lainnya</p>
                  )}
                </div>

                <div className="pt-5 border-t border-stone-50 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-[10px] font-black text-stone-muted uppercase tracking-widest leading-none">Total Tagihan</p>
                    <p className="text-lg font-black text-primary tracking-tight leading-none">Rp {Number(order.total_price).toLocaleString('id-ID')}</p>
                  </div>
                  
                  <div onClick={e => e.stopPropagation()} className="relative">
                    <select 
                      className="bg-stone-100 hover:bg-stone-200 border-none rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest text-secondary outline-none appearance-none cursor-pointer pr-8"
                      value={order.order_status}
                      onChange={(e) => updateStatus(order.id, e.target.value)}
                    >
                      {ORDER_STATUSES.filter(s => s !== 'all').map(s => (
                        <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                      ))}
                    </select>
                    <Filter size={10} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-stone-400" />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-md z-2000 flex items-center justify-center p-4 md:p-6 animate-fade" onClick={() => setSelectedOrder(null)}>
          <div className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-[40px] shadow-2xl p-8 md:p-12 relative" onClick={e => e.stopPropagation()}>
            <button className="absolute right-8 top-8 p-2 text-stone-300 hover:text-stone-900 transition-colors" onClick={() => setSelectedOrder(null)}>
              <X size={24} />
            </button>

            <div className="mb-10">
              <p className="text-xs font-black text-primary uppercase tracking-[0.2em] mb-2">Detail Pesanan</p>
              <h2 className="text-4xl font-black text-secondary tracking-tighter">#{selectedOrder.order_number}</h2>
              <div className="flex flex-wrap gap-4 mt-6">
                <div className="flex items-center gap-3 bg-stone-50 px-5 py-3 rounded-2xl border border-stone-100">
                  <User size={18} className="text-primary" />
                  <div>
                    <p className="text-[10px] font-black text-stone-muted uppercase tracking-widest">Pelanggan</p>
                    <p className="font-bold text-sm text-secondary">{selectedOrder.customer_name}</p>
                  </div>
                </div>
                <a 
                  href={`https://wa.me/${selectedOrder.wa_number?.split('@')[0]}`} 
                  target="_blank" 
                  rel="noreferrer"
                  className="flex items-center gap-3 bg-stone-50 px-5 py-3 rounded-2xl border border-stone-100 hover:border-emerald-200 transition-all"
                >
                  <MessageSquare size={18} className="text-emerald-500" />
                  <div>
                    <p className="text-[10px] font-black text-stone-muted uppercase tracking-widest">WhatsApp</p>
                    <p className="font-bold text-sm text-secondary">{selectedOrder.wa_number?.split('@')[0]}</p>
                  </div>
                </a>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <MapPin size={20} className="text-primary shrink-0 mt-1" />
                  <div>
                    <p className="text-xs font-black text-stone-muted uppercase tracking-widest mb-1">Alamat Pengiriman</p>
                    <p className="text-sm font-semibold text-secondary leading-relaxed">{selectedOrder.customer_address || '-'}</p>
                    {selectedOrder.customer_address && (
                      <a 
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedOrder.customer_address)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 text-xs font-black text-primary uppercase tracking-widest mt-3 border-b-2 border-primary/20 hover:border-primary transition-all"
                      >
                        <ExternalLink size={12} />
                        Buka Maps
                      </a>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-bakery-bg p-6 rounded-[32px] border border-stone-100">
                <p className="text-xs font-black text-stone-muted uppercase tracking-widest mb-4">Ringkasan Produk</p>
                <div className="space-y-3">
                  {(typeof selectedOrder.items === 'string' ? JSON.parse(selectedOrder.items) : selectedOrder.items).map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-white flex items-center justify-center text-[10px] font-black text-primary border border-stone-100">{item.qty}</span>
                        <span className="font-bold text-secondary">{item.name}</span>
                      </div>
                      <span className="font-bold text-stone-muted text-xs">Rp {(item.price * item.qty).toLocaleString('id-ID')}</span>
                    </div>
                  ))}
                  <div className="pt-4 mt-4 border-t border-stone-200 flex justify-between items-center">
                    <span className="text-xs font-black text-secondary uppercase tracking-widest">Total Bayar</span>
                    <span className="text-2xl font-black text-primary tracking-tighter">Rp {Number(selectedOrder.total_price).toLocaleString('id-ID')}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4">
               {selectedOrder.order_status !== 'completed' && (
                 <button 
                  onClick={() => updateStatus(selectedOrder.id, 'completed')}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-emerald-200 transition-all flex items-center justify-center gap-3"
                 >
                   <CheckCircle2 size={24} />
                   Selesaikan Pesanan
                 </button>
               )}
               {selectedOrder.order_status !== 'cancelled' && (
                 <button 
                  onClick={() => updateStatus(selectedOrder.id, 'cancelled')}
                  className="px-8 py-4 bg-rose-50 text-rose-500 rounded-2xl font-black text-lg hover:bg-rose-100 transition-all"
                 >
                   Batal
                 </button>
               )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
