import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { 
  Search, 
  Filter,
  FileSpreadsheet,
  X,
  MapPin,
  Phone,
  User,
  Calendar,
  ExternalLink,
  Bell
} from 'lucide-react';
import * as XLSX from 'xlsx';

const STATUS_COLORS = {
  new: '#f59e0b',
  waiting_payment: '#3b82f6',
  confirmed: '#8b5cf6',
  packing: '#fbbf24',
  shipping: '#0ea5e9',
  completed: '#10b981',
  cancelled: '#ef4444'
};

const STATUS_LABELS = {
  waiting_payment: 'Menunggu Bayar',
  confirmed: 'Konfirmasi (Siap)',
  packing: 'Diproses',
  shipping: 'Dikirim',
  completed: 'Selesai',
  cancelled: 'Batal'
};

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [notifPermission, setNotifPermission] = useState(Notification.permission);

  const requestNotif = async () => {
    const permission = await Notification.requestPermission();
    setNotifPermission(permission);
  };

  const fetchOrders = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('❌ Gagal ambil data pesanan:', error);
    } else {
      setOrders(data);
    }
    setLoading(false);
  };

  const exportToExcel = () => {
    const dataToExport = orders.map(o => ({
      'No. Pesanan': `#${o.order_number}`,
      'Nama Pelanggan': o.customer_name,
      'WhatsApp': (o.wa_number || '').split('@')[0], // Bersihkan @lid atau @s.whatsapp.net
      'Status': STATUS_LABELS[o.order_status] || o.order_status,
      'Total Belanja': `Rp ${Number(o.total_price).toLocaleString('id-ID')}`,
      'Tanggal': new Date(o.created_at).toLocaleString('id-ID'),
      'Alamat Pengiriman': o.customer_address || '-'
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    
    // Set column widths for a "prettier" look
    const colWidths = [
      { wch: 15 }, // No Pesanan
      { wch: 20 }, // Nama
      { wch: 15 }, // WA
      { wch: 15 }, // Status
      { wch: 15 }, // Total
      { wch: 20 }, // Tanggal
      { wch: 40 }, // Alamat
    ];
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Laporan Penjualan");
    XLSX.writeFile(wb, `Laporan-YoyoBakery-${new Date().toLocaleDateString('id-ID')}.xlsx`);
  };

  useEffect(() => {
    const init = async () => {
      await fetchOrders();
    };
    init();

    // Real-time subscription
    const channel = supabase
      .channel('orders_channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
        if (Notification.permission === 'granted') {
          new Notification('Pesanan Baru! 🥐', {
            body: `Ada pesanan baru dari ${payload.new.customer_name}`,
            icon: '/logoyoyobolen.PNG'
          });
        }
        fetchOrders();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        fetchOrders();
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  const updateStatus = async (orderId, newStatus) => {
    const { error } = await supabase
      .from('orders')
      .update({ order_status: newStatus })
      .eq('id', orderId);
    
    if (error) {
      alert('Gagal update status: ' + error.message);
    } else {
      await fetchOrders();
    }
  };

  const filteredOrders = orders.filter(order => {
    const term = searchTerm.toLowerCase();
    const orderNum = String(order.order_number || '').toLowerCase();
    const custName = String(order.customer_name || '').toLowerCase();
    const waNum = String(order.wa_number || '');
    
    return orderNum.includes(term) || custName.includes(term) || waNum.includes(term);
  });

  return (
    <div className="orders-page">
      <header className="page-header">
        <h1 className="text-gradient">Manajemen Pesanan</h1>
        <p>Kelola dan pantau pesanan pelanggan secara real-time</p>
      </header>

      <div className="table-controls glass-card animate-fade">
        <div className="search-box">
          <Search size={18} />
          <input 
            type="text" 
            placeholder="Cari Order ID atau Nama Customer..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="action-group">
          {notifPermission !== 'granted' && (
            <button className="notif-btn" onClick={requestNotif} title="Aktifkan Notifikasi">
              <Bell size={18} />
            </button>
          )}
          <button className="export-btn" onClick={exportToExcel} title="Ekspor ke Excel">
            <FileSpreadsheet size={18} />
            <span>Rekap Excel</span>
          </button>
          <button className="filter-btn">
            <Filter size={18} />
          </button>
        </div>
      </div>

      <div className="orders-list animate-fade">
        {loading ? (
          <div className="loading-state">Memuat data pesanan...</div>
        ) : filteredOrders.length === 0 ? (
          <div className="empty-state">Tidak ada pesanan ditemukan.</div>
        ) : (
          filteredOrders.map((order) => {
            let items = [];
            try {
              items = typeof order.items === 'string' ? JSON.parse(order.items) : (Array.isArray(order.items) ? order.items : []);
            } catch (e) {
              console.error('Error parsing items');
            }

            return (
              <div 
                key={order.id} 
                className="order-card glass-card clickable"
                onClick={() => setSelectedOrder(order)}
              >
                <div className="order-info">
                  <div className="order-main">
                    <h3>#{order.order_number}</h3>
                    <p className="customer-name">{order.customer_name}</p>
                    <p className="order-date">{order.created_at ? new Date(order.created_at).toLocaleString('id-ID') : '-'}</p>
                  </div>
                  <div className="order-status-badge" style={{ backgroundColor: `${STATUS_COLORS[order.order_status] || '#94a3b8'}20`, color: STATUS_COLORS[order.order_status] || '#94a3b8' }}>
                    {STATUS_LABELS[order.order_status] || order.order_status}
                  </div>
                </div>

                <div className="order-items">
                  {items.slice(0, 2).map((item, idx) => (
                    <span key={idx} className="item-tag">{item.qty}x {item.name}</span>
                  ))}
                  {items.length > 2 && <span className="item-tag">+{items.length - 2} lagi...</span>}
                </div>

                <div className="order-footer">
                  <div className="order-total">
                    <span>Total Bayar:</span>
                    <strong>Rp {(Number(order.total_price) || 0).toLocaleString('id-ID')}</strong>
                  </div>
                  <div className="order-actions" onClick={e => e.stopPropagation()}>
                    <select 
                      className="status-select"
                      value={order.order_status}
                      onChange={(e) => updateStatus(order.id, e.target.value)}
                    >
                      {Object.entries(STATUS_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div className="modal-overlay animate-fade" onClick={() => setSelectedOrder(null)}>
          <div className="modal-content glass-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Detail Pesanan #{selectedOrder.order_number}</h2>
              <button className="close-btn" onClick={() => setSelectedOrder(null)}><X size={20} /></button>
            </div>
            
            <div className="modal-body">
              <div className="info-section">
                <div className="info-item">
                  <User size={18} />
                  <div>
                    <label>Pelanggan</label>
                    <p>{selectedOrder.customer_name}</p>
                  </div>
                </div>
                <div className="info-item">
                  <Phone size={18} />
                  <div>
                    <label>Nomor WhatsApp</label>
                    <p>{(selectedOrder.wa_number || '').split('@')[0]}</p>
                  </div>
                </div>
                <div className="info-item">
                  <Calendar size={18} />
                  <div>
                    <label>Waktu Pesan</label>
                    <p>{new Date(selectedOrder.created_at).toLocaleString('id-ID')}</p>
                  </div>
                </div>
              </div>

              <div className="address-section">
                <div className="info-item">
                  <MapPin size={18} />
                  <div>
                    <label>Alamat Pengiriman</label>
                    <p>{selectedOrder.customer_address || '-'}</p>
                  </div>
                </div>
              </div>

              <div className="items-section">
                <h3>Rincian Pesanan</h3>
                <div className="items-list">
                  {(typeof selectedOrder.items === 'string' ? JSON.parse(selectedOrder.items) : selectedOrder.items).map((item, idx) => (
                    <div key={idx} className="detail-item">
                      <span>{item.qty}x {item.name}</span>
                      <span>Rp {(item.price * item.qty).toLocaleString('id-ID')}</span>
                    </div>
                  ))}
                  <div className="detail-total">
                    <span>Total Pembayaran</span>
                    <span>Rp {Number(selectedOrder.total_price).toLocaleString('id-ID')}</span>
                  </div>
                </div>
              </div>

              {selectedOrder.customer_address && (
                <a 
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedOrder.customer_address)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="maps-link"
                >
                  <ExternalLink size={18} />
                  <span>Lihat di Google Maps</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .orders-page { max-width: 1200px; margin: 0 auto; }
        .page-header { margin-bottom: 30px; }
        .page-header p { color: var(--text-muted); font-size: 14px; }

        .table-controls {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 15px 25px;
          margin-bottom: 25px;
          gap: 20px;
        }
        .search-box {
          display: flex;
          align-items: center;
          gap: 12px;
          background: rgba(255,255,255,0.05);
          padding: 10px 15px;
          border-radius: 12px;
          flex: 1;
        }
        .search-box input {
          background: transparent;
          border: none;
          color: #fff;
          width: 100%;
        }

        .action-group { display: flex; gap: 10px; }
        .export-btn, .notif-btn, .filter-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 15px;
          border-radius: 12px;
          background: rgba(255,255,255,0.05);
          color: var(--text-main);
          font-weight: 600;
          font-size: 14px;
        }
        .export-btn { background: rgba(16, 185, 129, 0.1); color: var(--accent-green); }
        .notif-btn { background: rgba(245, 158, 11, 0.1); color: var(--primary); }
        .export-btn:hover { background: rgba(16, 185, 129, 0.2); }

        .orders-list {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 20px;
        }

        .order-card {
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 18px;
          transition: var(--transition);
        }
        .order-card.clickable { cursor: pointer; }
        .order-card.clickable:hover { transform: translateY(-5px); background: rgba(255,255,255,0.08); }

        .order-info { display: flex; justify-content: space-between; align-items: flex-start; }
        .order-main h3 { font-size: 18px; margin-bottom: 4px; }
        .customer-name { font-weight: 600; color: var(--text-main); }
        .order-date { font-size: 12px; color: var(--text-muted); }

        .order-status-badge {
          font-size: 11px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 20px;
          text-transform: uppercase;
        }

        .order-items { display: flex; flex-wrap: wrap; gap: 8px; }
        .item-tag {
          font-size: 12px;
          background: rgba(255,255,255,0.05);
          padding: 4px 10px;
          border-radius: 8px;
          color: var(--text-muted);
        }

        .order-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 15px;
          border-top: 1px solid var(--card-border);
        }
        .order-total span { display: block; font-size: 12px; color: var(--text-muted); }
        .order-total strong { font-size: 16px; color: var(--primary); }

        .status-select {
          background: var(--bg);
          border: 1px solid var(--card-border);
          color: #fff;
          padding: 6px 10px;
          border-radius: 8px;
          font-size: 13px;
        }

        /* Modal Styles */
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.8);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 2000;
        }
        .modal-content {
          width: 100%;
          max-width: 600px;
          max-height: 90vh;
          overflow-y: auto;
          padding: 30px;
          position: relative;
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 25px;
        }
        .close-btn { background: transparent; color: var(--text-muted); }

        .modal-body { display: flex; flex-direction: column; gap: 25px; }
        .info-section, .address-section {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
        }
        .info-item { display: flex; gap: 12px; color: var(--text-muted); }
        .info-item p { color: #fff; font-weight: 500; margin-top: 4px; }
        .info-item label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }

        .items-section h3 { font-size: 16px; margin-bottom: 15px; }
        .items-list {
          background: rgba(255,255,255,0.03);
          border-radius: 12px;
          padding: 20px;
        }
        .detail-item {
          display: flex;
          justify-content: space-between;
          padding: 10px 0;
          border-bottom: 1px solid var(--card-border);
        }
        .detail-total {
          display: flex;
          justify-content: space-between;
          margin-top: 15px;
          font-weight: 700;
          color: var(--primary);
          font-size: 18px;
        }

        .maps-link {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 15px;
          background: var(--accent-blue);
          color: #fff;
          text-decoration: none;
          border-radius: 12px;
          font-weight: 600;
          transition: var(--transition);
        }
        .maps-link:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(59, 130, 246, 0.4); }

        .loading-state, .empty-state {
          text-align: center;
          padding: 50px;
          color: var(--text-muted);
        }

        @media (max-width: 768px) {
          .table-controls { flex-direction: column; align-items: stretch; }
          .export-btn span { display: none; }
          .modal-content { padding: 20px; }
          .orders-list { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
