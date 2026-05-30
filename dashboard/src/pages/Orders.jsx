import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
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
  ShoppingBag,
  ChevronLeft,
  ChevronRight,
  Calendar
} from 'lucide-react';
import * as XLSX from 'xlsx';
import ConfirmDialog from '../components/ConfirmDialog';
import { SkeletonCard } from '../components/Skeleton';

const getRealPhone = (order) => {
  if (!order) return '-';
  let phone = order.wa_number?.split('@')[0] || '-';
  if (order.notes) {
    const match = order.notes.match(/\(HP:\s*(\d+)\)/);
    if (match) phone = match[1];
  }
  return phone;
};

const STATUS_CONFIG = {
  waiting_payment: { label: 'Menunggu Bayar', color: '#F59E0B', icon: Clock },
  confirmed: { label: 'Konfirmasi', color: '#8B5CF6', icon: CheckCircle2 },
  packing: { label: 'Diproses', color: '#F59E0B', icon: Package },
  shipping: { label: 'Dikirim', color: '#0EA5E9', icon: Truck },
  completed: { label: 'Selesai', color: '#10B981', icon: CheckCircle2 },
  cancelled: { label: 'Batal', color: '#EF4444', icon: XCircle }
};

const ORDER_STATUSES = ['all', 'waiting_payment', 'confirmed', 'packing', 'shipping', 'completed', 'cancelled'];

const DATE_FILTERS = [
  { key: 'all', label: 'Semua' },
  { key: 'today', label: 'Hari ini' },
  { key: 'week', label: 'Minggu ini' },
  { key: 'month', label: 'Bulan ini' },
];

const PAGE_SIZE = 20;

export default function Orders() {
  const toast = useToast();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all');
  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('yoyo_sound') !== 'off';
  });
  const [dateFilter, setDateFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [viewMode, setViewMode] = useState('orders'); // 'orders' or 'abandoned'
  const [abandonedSessions, setAbandonedSessions] = useState([]);

  // Confirm dialog state
  const [confirmState, setConfirmState] = useState({ open: false, orderId: null, action: null, orderNumber: '' });
  
  const audioRef = useRef(new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3'));

  const getDateRange = useCallback(() => {
    const now = new Date();
    switch (dateFilter) {
      case 'today': {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return start.toISOString();
      }
      case 'week': {
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1);
        const start = new Date(now.getFullYear(), now.getMonth(), diff);
        start.setHours(0, 0, 0, 0);
        return start.toISOString();
      }
      case 'month': {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        return start.toISOString();
      }
      default:
        return null;
    }
  }, [dateFilter]);

  const fetchOrders = useCallback(async () => {
    setLoading(true);

    try {
      // Build query for count
      let countQuery = supabase.from('orders').select('*', { count: 'exact', head: true });
      const dateStart = getDateRange();
      if (dateStart) countQuery = countQuery.gte('created_at', dateStart);
      if (activeFilter !== 'all') countQuery = countQuery.eq('order_status', activeFilter);
      
      const { count } = await countQuery;
      setTotalCount(count || 0);

      // Build query for data
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let dataQuery = supabase.from('orders').select('*').order('created_at', { ascending: false }).range(from, to);
      if (dateStart) dataQuery = dataQuery.gte('created_at', dateStart);
      if (activeFilter !== 'all') dataQuery = dataQuery.eq('order_status', activeFilter);

      const { data, error } = await dataQuery;
      if (error) throw error;
      setOrders(data || []);
    } catch (err) {
      console.error('Gagal ambil data pesanan:', err);
      toast.error('Gagal memuat pesanan');
    }
    setLoading(false);
  }, [page, dateFilter, activeFilter, getDateRange]);

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

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [activeFilter, dateFilter, searchTerm, viewMode]);

  const fetchAbandoned = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .in('state', ['ORDER', 'LOCATION', 'PAYMENT', 'CONFIRM'])
        .not('wa_number', 'like', 'system:%')
        .order('updated_at', { ascending: false });
      
      if (error) throw error;
      setAbandonedSessions(data || []);
    } catch (err) {
      console.error('Error fetching abandoned sessions:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (viewMode === 'abandoned') {
      fetchAbandoned();
    } else {
      fetchOrders();
    }
  }, [viewMode, fetchAbandoned, fetchOrders]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (selectedOrder) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [selectedOrder]);

  const updateStatus = async (orderId, newStatus) => {
    const { error } = await supabase
      .from('orders')
      .update({ order_status: newStatus })
      .eq('id', orderId);
    
    if (error) {
      toast.error('Gagal update status: ' + error.message);
    } else {
      const label = STATUS_CONFIG[newStatus]?.label || newStatus;
      toast.success(`Status berhasil diubah ke "${label}"`);
      // Update selectedOrder if it's the current modal
      if (selectedOrder?.id === orderId) {
        setSelectedOrder(prev => prev ? { ...prev, order_status: newStatus } : null);
      }
      fetchOrders();
    }
  };

  const handleConfirmAction = () => {
    if (confirmState.orderId && confirmState.action) {
      updateStatus(confirmState.orderId, confirmState.action);
    }
    setConfirmState({ open: false, orderId: null, action: null, orderNumber: '' });
  };

  const askConfirm = (orderId, action, orderNumber) => {
    setConfirmState({ open: true, orderId, action, orderNumber });
  };

  const exportToExcel = () => {
    const dataToExport = orders.map(o => ({
      'No. Pesanan': `#${o.order_number}`,
      'Nama': o.customer_name,
      'WA': getRealPhone(o),
      'Status': STATUS_CONFIG[o.order_status]?.label || o.order_status,
      'Total': o.total_price,
      'Tanggal': new Date(o.created_at).toLocaleString('id-ID')
    }));
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pesanan");
    XLSX.writeFile(wb, `Orders-${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success('File Excel berhasil di-download!');
  };

  // Client-side search filtering (on already paginated data)
  const filteredOrders = orders.filter(order => {
    const matchesSearch = 
      String(order.order_number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      String(order.customer_name || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-secondary tracking-tight">Daftar Pesanan</h1>
          <p className="text-stone-muted font-medium mt-1">Kelola pesanan roti dari pelanggan WA.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => {
              const newVal = !soundEnabled;
              setSoundEnabled(newVal);
              localStorage.setItem('yoyo_sound', newVal ? 'on' : 'off');
            }}
            className={`p-3 rounded-2xl border transition-all ${soundEnabled ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-stone-100 border-stone-200 text-stone-400'}`}
            title={soundEnabled ? "Matikan Suara" : "Aktifkan Suara"}
          >
            {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
          <button onClick={exportToExcel} className="flex items-center gap-2.5 bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-3.5 rounded-2xl font-bold shadow-lg shadow-emerald-200 transition-all active:scale-95 text-sm">
            <FileSpreadsheet size={20} />
            <div className="text-left hidden sm:block">
              <span className="block text-xs font-bold leading-tight">Download</span>
              <span className="block text-[10px] opacity-80 leading-tight">Rekap Excel</span>
            </div>
            <span className="sm:hidden">Excel</span>
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-stone-200">
        <button 
          onClick={() => setViewMode('orders')}
          className={`pb-4 font-bold text-sm transition-colors border-b-2 ${viewMode === 'orders' ? 'border-primary text-primary' : 'border-transparent text-stone-400 hover:text-stone-600'}`}
        >
          Semua Pesanan
        </button>
        <button 
          onClick={() => setViewMode('abandoned')}
          className={`pb-4 font-bold text-sm transition-colors border-b-2 ${viewMode === 'abandoned' ? 'border-primary text-primary' : 'border-transparent text-stone-400 hover:text-stone-600'}`}
        >
          Keranjang Terbengkalai
        </button>
      </div>

      {viewMode === 'orders' ? (
        <>
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

        {/* Date Range Filter */}
        <div className="flex flex-wrap gap-2 items-center">
          <Calendar size={16} className="text-stone-300" />
          {DATE_FILTERS.map(df => (
            <button
              key={df.key}
              onClick={() => setDateFilter(df.key)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                dateFilter === df.key 
                  ? 'bg-primary text-white shadow-md shadow-primary/20' 
                  : 'bg-stone-50 text-stone-400 hover:bg-stone-100'
              }`}
            >
              {df.label}
            </button>
          ))}
        </div>

        {/* Status Filter */}
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
            </button>
          ))}
        </div>
      </div>

      {/* Orders Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {loading ? (
          [...Array(6)].map((_, i) => <SkeletonCard key={i} />)
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
                <div className="flex justify-between items-start gap-4 mb-6">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xl font-black text-secondary group-hover:text-primary transition-colors">#{order.order_number}</h3>
                    <p className="text-sm font-bold text-stone-text mt-0.5 truncate" title={order.customer_name}>{order.customer_name}</p>
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="p-3 rounded-xl bg-white border border-stone-200 text-stone-text hover:bg-stone-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-xs font-black text-stone-muted uppercase tracking-widest">
            Halaman {page + 1} dari {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="p-3 rounded-xl bg-white border border-stone-200 text-stone-text hover:bg-stone-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}
      </>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {loading ? (
            [...Array(3)].map((_, i) => <SkeletonCard key={i} />)
          ) : abandonedSessions.length === 0 ? (
            <div className="col-span-full py-20 bg-white border-2 border-dashed border-stone-100 rounded-[40px] text-center">
              <ShoppingBag size={48} className="mx-auto text-stone-200 mb-4" />
              <p className="text-stone-muted font-bold tracking-tight">Tidak ada keranjang terbengkalai.</p>
            </div>
          ) : (
            abandonedSessions.map((session) => (
              <div 
                key={session.wa_number} 
                className="bg-white border border-stone-100 rounded-[32px] p-6 shadow-sm hover:shadow-xl hover:border-stone-200 transition-all cursor-pointer"
              >
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="text-xl font-black text-secondary">{session.data?.customerName || session.wa_number.split('@')[0]}</h3>
                    <p className="text-sm font-bold text-stone-text mt-0.5">{session.wa_number.split('@')[0]}</p>
                    <p className="text-[10px] text-stone-muted font-black uppercase tracking-widest mt-1">
                      Terakhir aktif: {new Date(session.updated_at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="px-3 py-1.5 rounded-xl flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-700">
                    <Clock size={12} strokeWidth={3} />
                    {session.state}
                  </div>
                </div>

                {session.data?.items && session.data.items.length > 0 && (
                  <div className="space-y-2 mb-6">
                    {session.data.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-xs font-bold text-stone-text bg-stone-50 px-3 py-2 rounded-xl">
                        <span>{item.qty}x {item.name}</span>
                        <span className="text-stone-muted">Rp {item.price?.toLocaleString('id-ID')}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-5 border-t border-stone-50 flex items-center justify-between">
                  <a href="/inbox" className="w-full text-center px-4 py-3 bg-stone-100 text-stone-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-stone-200 transition-all">
                    Follow Up via Inbox
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Order Detail Modal */}
      {selectedOrder && createPortal(
        <div 
          className="fixed inset-0 bg-stone-900/60 backdrop-blur-md flex items-center justify-center p-4" 
          style={{ zIndex: 9999 }}
          onClick={() => setSelectedOrder(null)}
        >
          <div 
            className="bg-white w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-[32px] shadow-2xl p-6 md:p-10 relative"
            onClick={e => e.stopPropagation()}
          >
            <button className="absolute right-5 top-5 p-2 text-stone-300 hover:text-stone-900 transition-colors z-10" onClick={() => setSelectedOrder(null)}>
              <X size={24} />
            </button>

            <div className="mb-8 md:mb-10">
              <p className="text-xs font-black text-primary uppercase tracking-[0.2em] mb-2">Detail Pesanan</p>
              <h2 className="text-3xl md:text-4xl font-black text-secondary tracking-tighter">#{selectedOrder.order_number}</h2>
              <div className="flex flex-col sm:flex-row flex-wrap gap-3 mt-5">
                <div className="flex items-center gap-3 bg-stone-50 px-4 py-3 rounded-2xl border border-stone-100">
                  <User size={18} className="text-primary" />
                  <div>
                    <p className="text-[10px] font-black text-stone-muted uppercase tracking-widest">Pelanggan</p>
                    <p className="font-bold text-sm text-secondary">{selectedOrder.customer_name}</p>
                  </div>
                </div>
                <a 
                  href={`https://wa.me/${getRealPhone(selectedOrder)}`} 
                  target="_blank" 
                  rel="noreferrer"
                  className="flex items-center gap-3 bg-stone-50 px-4 py-3 rounded-2xl border border-stone-100 hover:border-emerald-200 transition-all"
                >
                  <MessageSquare size={18} className="text-emerald-500" />
                  <div>
                    <p className="text-[10px] font-black text-stone-muted uppercase tracking-widest">WhatsApp</p>
                    <p className="font-bold text-sm text-secondary">{getRealPhone(selectedOrder)}</p>
                  </div>
                </a>
              </div>
            </div>

            <div className="space-y-6 mb-8 md:mb-10">
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
                      className="inline-flex items-center gap-2 text-xs font-black text-primary uppercase tracking-widest mt-2 border-b-2 border-primary/20 hover:border-primary transition-all"
                    >
                      <ExternalLink size={12} />
                      Buka Maps
                    </a>
                  )}
                </div>
              </div>

              <div className="bg-bakery-bg p-5 md:p-6 rounded-[24px] border border-stone-100">
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
                  {selectedOrder.delivery_fee > 0 && (
                    <div className="flex justify-between items-center text-sm pt-2 border-t border-stone-200/50">
                      <span className="font-bold text-stone-muted">🚚 Ongkir</span>
                      <span className="font-bold text-stone-muted text-xs">Rp {Number(selectedOrder.delivery_fee).toLocaleString('id-ID')}</span>
                    </div>
                  )}
                  <div className="pt-4 mt-2 border-t-2 border-stone-200 flex justify-between items-center">
                    <span className="text-xs font-black text-secondary uppercase tracking-widest">Total Bayar</span>
                    <span className="text-xl md:text-2xl font-black text-primary tracking-tighter">Rp {Number(selectedOrder.total_price).toLocaleString('id-ID')}</span>
                  </div>
                </div>
              </div>

              {selectedOrder.payment_proof_url && (
                <div className="bg-stone-50 p-5 rounded-[24px] border border-stone-100 flex flex-col gap-3">
                  <p className="text-xs font-black text-stone-muted uppercase tracking-widest flex items-center gap-2">
                    📸 Bukti Transfer
                  </p>
                  <a href={selectedOrder.payment_proof_url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-stone-200 hover:opacity-90 transition-opacity">
                    <img 
                      src={selectedOrder.payment_proof_url} 
                      alt="Bukti Transfer" 
                      className="w-full h-auto object-cover max-h-64"
                      loading="lazy"
                    />
                  </a>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
               {selectedOrder.order_status !== 'completed' && (
                 <button 
                  onClick={() => askConfirm(selectedOrder.id, 'completed', selectedOrder.order_number)}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white py-4 rounded-2xl font-black text-base shadow-xl shadow-emerald-200 transition-all flex items-center justify-center gap-3"
                 >
                   <CheckCircle2 size={22} />
                   Selesaikan
                 </button>
               )}
               <button 
                  onClick={() => setSelectedOrder(null)}
                  className="px-8 py-4 bg-stone-100 text-stone-500 rounded-2xl font-black text-base hover:bg-stone-200 transition-all"
                 >
                   Tutup
                 </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmState.open}
        title={confirmState.action === 'completed' ? 'Selesaikan Pesanan?' : 'Batalkan Pesanan?'}
        message={confirmState.action === 'completed' 
          ? `Tandai pesanan #${confirmState.orderNumber} sebagai selesai?`
          : `Yakin ingin membatalkan pesanan #${confirmState.orderNumber}? Aksi ini tidak bisa dibatalkan.`
        }
        confirmLabel={confirmState.action === 'completed' ? 'Ya, Selesai' : 'Ya, Batalkan'}
        variant={confirmState.action === 'completed' ? 'success' : 'danger'}
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmState({ open: false, orderId: null, action: null, orderNumber: '' })}
      />
    </div>
  );
}
