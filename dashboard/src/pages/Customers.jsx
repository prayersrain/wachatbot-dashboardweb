import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Search, Users, MessageSquare, ChevronLeft, ChevronRight, ShoppingBag } from 'lucide-react';

const PAGE_SIZE = 20;

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    fetchCustomers();
  }, [page]);

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      // Get total count
      const { count } = await supabase
        .from('customers')
        .select('*', { count: 'exact', head: true });
      setTotalCount(count || 0);

      // Get paginated data
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      // For each customer, get their order stats (semua order, bukan hanya completed)
      const enriched = await Promise.all((data || []).map(async (cust) => {
        const { data: orders } = await supabase
          .from('orders')
          .select('total_price, order_status, items')
          .eq('wa_number', cust.wa_number);

        const totalOrders = orders?.length || 0;
        const totalSpent = orders?.reduce((sum, o) => sum + (Number(o.total_price) || 0), 0) || 0;
        return { ...cust, totalOrders, totalSpent, lastOrders: orders || [] };
      }));

      setCustomers(enriched);
    } catch (err) {
      console.error('Error fetching customers:', err);
    }
    setLoading(false);
  };

  const filtered = customers.filter(c =>
    (c.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.wa_number || '').includes(searchTerm)
  );

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-black text-secondary tracking-tight">Pelanggan</h1>
        <p className="text-stone-muted font-medium mt-1">Daftar pelanggan setia Yoyo Bakery.</p>
      </header>

      {/* Search */}
      <div className="bg-white border border-stone-100 p-4 md:p-6 rounded-[32px] shadow-sm">
        <div className="relative group">
          <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300 group-focus-within:text-primary transition-colors" />
          <input
            type="text"
            placeholder="Cari nama atau nomor WA..."
            className="w-full bg-stone-50 border border-stone-100 rounded-2xl py-4 pl-12 pr-4 outline-none focus:border-primary focus:ring-4 focus:ring-primary/5 transition-all font-medium"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Customer List */}
      {loading ? (
        <div className="py-20 text-center animate-pulse">
          <p className="text-stone-muted font-black uppercase tracking-[0.2em] text-xs">Memuat Pelanggan...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 bg-white border-2 border-dashed border-stone-100 rounded-[40px] text-center">
          <Users size={48} className="mx-auto text-stone-200 mb-4" />
          <p className="text-stone-muted font-bold">Belum ada pelanggan.</p>
        </div>
      ) : (
        <div className="bg-white border border-stone-100 rounded-[32px] shadow-sm overflow-hidden">
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-stone-100">
                  <th className="text-left px-6 py-4 text-[10px] font-black text-stone-muted uppercase tracking-widest">Pelanggan</th>
                  <th className="text-left px-6 py-4 text-[10px] font-black text-stone-muted uppercase tracking-widest">No. WA</th>
                  <th className="text-center px-6 py-4 text-[10px] font-black text-stone-muted uppercase tracking-widest">Total Order</th>
                  <th className="text-right px-6 py-4 text-[10px] font-black text-stone-muted uppercase tracking-widest">Total Belanja</th>
                  <th className="text-center px-6 py-4 text-[10px] font-black text-stone-muted uppercase tracking-widest">Sejak</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-b border-stone-50 hover:bg-stone-50/50 transition-colors group">
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                          <span className="text-primary font-black text-sm">{(c.name || '?')[0].toUpperCase()}</span>
                        </div>
                        <span className="font-bold text-secondary text-sm">{c.name || 'Tanpa Nama'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5 text-sm font-medium text-stone-text">{c.wa_number?.split('@')[0]}</td>
                    <td className="px-6 py-5 text-center">
                      <span className="inline-flex items-center gap-1 bg-stone-50 px-3 py-1 rounded-lg text-xs font-bold text-stone-text">
                        <ShoppingBag size={12} /> {c.totalOrders}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-right font-bold text-primary text-sm">Rp {c.totalSpent.toLocaleString('id-ID')}</td>
                    <td className="px-6 py-5 text-center text-xs text-stone-muted font-medium">
                      {c.created_at ? new Date(c.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
                    </td>
                    <td className="px-6 py-5">
                      <a
                        href={`https://wa.me/${c.wa_number?.split('@')[0]}`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 rounded-xl bg-emerald-50 text-emerald-500 hover:bg-emerald-100 transition-all inline-flex"
                      >
                        <MessageSquare size={16} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-stone-50 overflow-hidden max-w-full">
            {filtered.map((c) => (
              <div key={c.id} className="p-4 sm:p-5 flex items-center gap-3 sm:gap-4 overflow-hidden">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-primary font-black text-base sm:text-lg">{(c.name || '?')[0].toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0 overflow-hidden">
                  <p className="font-bold text-secondary text-sm truncate">{c.name || 'Tanpa Nama'}</p>
                  <p className="text-xs text-stone-muted truncate">{c.wa_number?.split('@')[0]}</p>
                  <div className="flex gap-3 mt-1">
                    <span className="text-[10px] font-black text-stone-muted uppercase">{c.totalOrders} order</span>
                    <span className="text-[10px] font-black text-primary">Rp {c.totalSpent.toLocaleString('id-ID')}</span>
                  </div>
                </div>
                <a href={`https://wa.me/${c.wa_number?.split('@')[0]}`} target="_blank" rel="noreferrer" className="p-3 rounded-xl bg-emerald-50 text-emerald-500">
                  <MessageSquare size={18} />
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

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
    </div>
  );
}
