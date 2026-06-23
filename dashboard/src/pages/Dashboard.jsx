import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { TrendingUp, Users, ShoppingBag, DollarSign, ArrowUpRight, ArrowDownRight, Clock, ChevronRight } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { SkeletonStat, SkeletonChart } from '../components/Skeleton';

/* ── Pipeline: Baking Tracker ── */
const PIPELINE = [
  { key: 'waiting_payment', label: 'Bayar', icon: '💳' },
  { key: 'confirmed',       label: 'Konfirm', icon: '✅' },
  { key: 'packing',         label: 'Proses', icon: '📦' },
  { key: 'shipping',        label: 'Kirim', icon: '🛵' },
];

function BakePipeline({ counts }) {
  const steps = PIPELINE.map((p, i) => ({
    ...p,
    count: counts[p.key] || 0,
    active: i <= Math.max(...PIPELINE.map((_, j) => counts[PIPELINE[j].key] > 0 ? j : -1)),
  }));

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg font-bold text-crust">Pipeline Hari Ini</h3>
        <span className="text-[10px] font-semibold text-charcoal/50 uppercase tracking-wider">Live</span>
      </div>
      <div className="flex items-stretch gap-1.5">
        {steps.map((step, i) => (
          <div key={step.key} className="flex-1 flex flex-col items-center gap-2">
            <span className="text-xl">{step.icon}</span>
            <span className="stat-number text-xl">{step.count}</span>
            <span className="stat-label text-center">{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Stat Card ── */
function StatCard({ title, value, icon: Icon, trend, trendLabel, color }) {
  return (
    <div className="card p-5 group transition-all duration-300 hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="stat-label">{title}</p>
          <p className="stat-number" style={{ color }}>{value}</p>
          {trend != null && (
            <div className={`flex items-center gap-1 text-xs font-semibold mt-1.5 ${trend >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {trend >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
              {Math.abs(trend)}% {trendLabel}
            </div>
          )}
        </div>
        <div className="w-11 h-11 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 duration-300"
          style={{ backgroundColor: `${color}15`, color }}>
          <Icon size={22} strokeWidth={2} />
        </div>
      </div>
    </div>
  );
}

/* ── Dashboard ── */
export default function Dashboard() {
  const [stats, setStats] = useState({ todayRevenue: 0, monthRevenue: 0, totalOrders: 0, activeCustomers: 0, todayTrend: null, monthTrend: null });
  const [pipeline, setPipeline] = useState({ waiting_payment: 0, confirmed: 0, packing: 0, shipping: 0 });
  const [chartData, setChartData] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
      const firstDayMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const firstDayLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastDayLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
      const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Revenue today
      const { data: todayOrders } = await supabase.from('orders').select('total_price').gte('created_at', today.toISOString()).eq('order_status', 'completed');
      const todayRev = todayOrders?.reduce((acc, c) => acc + (Number(c.total_price) || 0), 0) || 0;

      const { data: yesterdayOrders } = await supabase.from('orders').select('total_price').gte('created_at', yesterday.toISOString()).lt('created_at', today.toISOString()).eq('order_status', 'completed');
      const yesterdayRev = yesterdayOrders?.reduce((acc, c) => acc + (Number(c.total_price) || 0), 0) || 0;
      const todayTrend = yesterdayRev > 0 ? Math.round(((todayRev - yesterdayRev) / yesterdayRev) * 100) : null;

      // Revenue month
      const { data: monthOrders } = await supabase.from('orders').select('total_price').gte('created_at', firstDayMonth.toISOString()).eq('order_status', 'completed');
      const monthRev = monthOrders?.reduce((acc, c) => acc + (Number(c.total_price) || 0), 0) || 0;

      const { data: lastMonthOrders } = await supabase.from('orders').select('total_price').gte('created_at', firstDayLastMonth.toISOString()).lte('created_at', lastDayLastMonth.toISOString()).eq('order_status', 'completed');
      const lastMonthRev = lastMonthOrders?.reduce((acc, c) => acc + (Number(c.total_price) || 0), 0) || 0;
      const monthTrend = lastMonthRev > 0 ? Math.round(((monthRev - lastMonthRev) / lastMonthRev) * 100) : null;

      // Active orders (not cancelled/completed)
      const { data: activeOrders } = await supabase.from('orders').select('order_status').not('order_status', 'in', '("cancelled","completed")');
      const pipes = { waiting_payment: 0, confirmed: 0, packing: 0, shipping: 0 };
      activeOrders?.forEach(o => { if (pipes[o.order_status] !== undefined) pipes[o.order_status]++; });
      setPipeline(pipes);

      // Total customers
      const { count: customerCount } = await supabase.from('customers').select('*', { count: 'exact', head: true });

      setStats({ todayRevenue: todayRev, monthRevenue: monthRev, totalOrders: activeOrders?.length || 0, activeCustomers: customerCount || 0, todayTrend, monthTrend });

      // Chart: last 7 days
      const { data: salesData } = await supabase.from('orders').select('total_price, created_at').gte('created_at', sevenDaysAgo.toISOString()).eq('order_status', 'completed').order('created_at', { ascending: true });
      const dayMap = {};
      salesData?.forEach(o => {
        const key = new Date(o.created_at).toLocaleDateString('id-ID', { weekday: 'short' });
        dayMap[key] = (dayMap[key] || 0) + (Number(o.total_price) || 0);
      });
      setChartData([...Array(7)].map((_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i));
        return { name: d.toLocaleDateString('id-ID', { weekday: 'short' }), sales: dayMap[d.toLocaleDateString('id-ID', { weekday: 'short' })] || 0 };
      }));

      // Recent orders
      const { data: latest } = await supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(5);
      setRecentOrders(latest || []);
      setLoading(false);
    } catch (err) { console.error('Dashboard error:', err); setLoading(false); }
  };

  useEffect(() => {
    let mounted = true;
    const load = async () => { if (mounted) await fetchStats(); };
    load();
    const interval = setInterval(fetchStats, 60000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  if (loading) return (
    <div className="space-y-6 pb-10">
      <header><h1 className="text-2xl font-display font-black text-crust">Halo, Admin! 👋</h1><p className="text-sm text-charcoal mt-0.5">Cek performa hari ini.</p></header>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[...Array(4)].map((_, i) => <SkeletonStat key={i} />)}</div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6"><div className="lg:col-span-2"><SkeletonChart /></div><div className="card p-6 animate-pulse" /></div>
    </div>
  );

  return (
    <div className="space-y-5 pb-10">
      {/* ── Header ── */}
      <header>
        <h1 className="text-2xl font-display font-black text-crust">Halo, Admin! 👋</h1>
        <p className="text-sm text-charcoal mt-0.5">Cek performa Yoyo Bakery hari ini.</p>
      </header>

      {/* ── Pipeline ── */}
      <BakePipeline counts={pipeline} />

      {/* ── Stats Grid ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Pendapatan Hari Ini" value={`Rp ${stats.todayRevenue.toLocaleString('id-ID')}`} icon={DollarSign} color="#D97706" trend={stats.todayTrend} trendLabel="vs kemarin" />
        <StatCard title="Bulan Ini" value={`Rp ${stats.monthRevenue.toLocaleString('id-ID')}`} icon={TrendingUp} color="#0EA5E9" trend={stats.monthTrend} trendLabel="vs bulan lalu" />
        <StatCard title="Pesanan Aktif" value={stats.totalOrders} icon={ShoppingBag} color="#10B981" />
        <StatCard title="Pelanggan" value={stats.activeCustomers} icon={Users} color="#8B5CF6" />
      </div>

      {/* ── Chart + Recent ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card p-5 md:p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-display text-lg font-bold text-crust">Tren Penjualan</h3>
            <span className="text-[10px] font-semibold text-charcoal/50 uppercase tracking-wider bg-flour px-3 py-1 rounded-full">7 Hari</span>
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%" debounce={100}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="cSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#D97706" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#D97706" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#D6D3D1" vertical={false} opacity={0.5} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#57534E', fontSize: 11, fontWeight: 600 }} dy={10} />
                <YAxis hide />
                <Tooltip cursor={{ stroke: '#D97706', strokeWidth: 2 }}
                  contentStyle={{ backgroundColor: '#FFF', border: 'none', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', padding: '12px 16px' }}
                  itemStyle={{ color: '#D97706', fontWeight: 700, fontSize: 13 }} />
                <Area type="monotone" dataKey="sales" stroke="#D97706" strokeWidth={3} fillOpacity={1} fill="url(#cSales)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-5 md:p-6 flex flex-col">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-display text-lg font-bold text-crust">Pesanan Baru</h3>
            <Clock size={16} className="text-wheat" />
          </div>
          <div className="flex-1 space-y-3">
            {recentOrders.map(order => (
              <div key={order.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-flour transition-colors cursor-pointer group">
                <div className="w-9 h-9 rounded-lg bg-cream flex items-center justify-center font-bold text-xs text-crust">
                  #{String(order.order_number || '').slice(-2)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-ink truncate">{order.customer_name}</p>
                  <p className="text-xs font-semibold text-charcoal">Rp {Number(order.total_price).toLocaleString('id-ID')}</p>
                </div>
                <ChevronRight size={14} className="text-wheat group-hover:text-amber transition-colors shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
