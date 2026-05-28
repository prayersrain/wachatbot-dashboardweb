import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { 
  TrendingUp, 
  Users, 
  ShoppingBag, 
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  ChevronRight
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { SkeletonStat, SkeletonChart } from '../components/Skeleton';

const StatCard = ({ title, value, icon: Icon, color, trend, trendLabel }) => (
  <div className="relative group overflow-hidden bg-white/60 backdrop-blur-xl border border-white/40 p-6 rounded-[32px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] transition-all duration-500 flex items-center justify-between">
    <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
    <div className="relative z-10 space-y-1">
      <p className="text-stone-500 text-[11px] font-black uppercase tracking-widest">{title}</p>
      <h2 className="text-3xl font-black text-secondary tracking-tight group-hover:scale-105 origin-left transition-transform duration-300" style={{ color: color }}>{value}</h2>
      {trend !== null && trend !== undefined && (
        <div className={`flex items-center gap-1 text-[11px] font-bold mt-2 ${trend >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
          {trend >= 0 ? <ArrowUpRight size={14} strokeWidth={3} /> : <ArrowDownRight size={14} strokeWidth={3} />}
          <span>{Math.abs(trend)}% {trendLabel || 'vs kemarin'}</span>
        </div>
      )}
    </div>
    <div className="relative z-10 w-16 h-16 rounded-[20px] flex items-center justify-center transition-all duration-500 group-hover:scale-110 group-hover:-rotate-6 shadow-inner" style={{ backgroundColor: `${color}15`, color: color, border: `1px solid ${color}30` }}>
      <Icon size={28} strokeWidth={2.5} />
    </div>
  </div>
);

export default function Dashboard() {
  const [stats, setStats] = useState({
    todayRevenue: 0,
    monthRevenue: 0,
    totalOrders: 0,
    activeCustomers: 0,
    todayTrend: null,
    monthTrend: null,
  });
  const [chartData, setChartData] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const firstDayMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const firstDayLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastDayLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // 1. Today Revenue (Completed Only)
      const { data: todayOrders } = await supabase
        .from('orders')
        .select('total_price')
        .gte('created_at', today.toISOString())
        .eq('order_status', 'completed');
      
      const todayRev = todayOrders?.reduce((acc, curr) => acc + (Number(curr.total_price) || 0), 0) || 0;

      // 1b. Yesterday Revenue for trend comparison
      const { data: yesterdayOrders } = await supabase
        .from('orders')
        .select('total_price')
        .gte('created_at', yesterday.toISOString())
        .lt('created_at', today.toISOString())
        .eq('order_status', 'completed');
      
      const yesterdayRev = yesterdayOrders?.reduce((acc, curr) => acc + (Number(curr.total_price) || 0), 0) || 0;

      // Calculate today trend
      let todayTrend = null;
      if (yesterdayRev > 0) {
        todayTrend = Math.round(((todayRev - yesterdayRev) / yesterdayRev) * 100);
      }

      // 2. Month Revenue
      const { data: monthOrders } = await supabase
        .from('orders')
        .select('total_price')
        .gte('created_at', firstDayMonth.toISOString())
        .eq('order_status', 'completed');
      
      const monthRev = monthOrders?.reduce((acc, curr) => acc + (Number(curr.total_price) || 0), 0) || 0;

      // 2b. Last Month Revenue for trend
      const { data: lastMonthOrders } = await supabase
        .from('orders')
        .select('total_price')
        .gte('created_at', firstDayLastMonth.toISOString())
        .lte('created_at', lastDayLastMonth.toISOString())
        .eq('order_status', 'completed');
      
      const lastMonthRev = lastMonthOrders?.reduce((acc, curr) => acc + (Number(curr.total_price) || 0), 0) || 0;

      let monthTrend = null;
      if (lastMonthRev > 0) {
        monthTrend = Math.round(((monthRev - lastMonthRev) / lastMonthRev) * 100);
      }

      // 3. Active Orders (Not Cancelled/Completed)
      const { count: orderCount } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .not('order_status', 'in', '("cancelled", "completed")');

      // 4. Total Customers
      const { count: customerCount } = await supabase
        .from('customers')
        .select('*', { count: 'exact', head: true });

      setStats({
        todayRevenue: todayRev,
        monthRevenue: monthRev,
        totalOrders: orderCount || 0,
        activeCustomers: customerCount || 0,
        todayTrend,
        monthTrend,
      });

      // 5. Real Sales Chart Data (Last 7 Days)
      const { data: salesData } = await supabase
        .from('orders')
        .select('total_price, created_at')
        .gte('created_at', sevenDaysAgo.toISOString())
        .eq('order_status', 'completed')
        .order('created_at', { ascending: true });

      // Group sales by day
      const dayMap = {};
      salesData?.forEach(order => {
        const dateKey = new Date(order.created_at).toLocaleDateString('id-ID', { weekday: 'short' });
        dayMap[dateKey] = (dayMap[dateKey] || 0) + (Number(order.total_price) || 0);
      });

      const formattedChartData = [...Array(7)].map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        const key = d.toLocaleDateString('id-ID', { weekday: 'short' });
        return {
          name: key,
          sales: dayMap[key] || 0
        };
      });
      setChartData(formattedChartData);

      // 6. Recent Orders
      const { data: latestOrders } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);
      
      setRecentOrders(latestOrders || []);

      setLoading(false);
    } catch (err) {
      console.error('❌ Dashboard Error:', err);
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    
    const loadData = async () => {
      if (mounted) await fetchStats();
    };
    loadData();
    
    // Auto refresh every minute
    const interval = setInterval(fetchStats, 60000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (loading) return (
    <div className="space-y-8 pb-10">
      <header>
        <h1 className="text-3xl font-black text-secondary tracking-tight">Halo, Admin! 👋</h1>
        <p className="text-stone-muted font-medium mt-1">Cek performa Yoyo Bakery hari ini.</p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <SkeletonStat key={i} />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2"><SkeletonChart /></div>
        <div className="bg-bakery-sidebar border border-stone-200 p-8 rounded-[40px] shadow-sm animate-pulse" />
      </div>
    </div>
  );

  return (
    <div className="space-y-8 pb-10">
      <header>
        <h1 className="text-3xl font-black text-secondary tracking-tight">Halo, Admin! 👋</h1>
        <p className="text-stone-muted font-medium mt-1">Cek performa Yoyo Bakery hari ini.</p>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="Hari Ini" 
          value={`Rp ${stats.todayRevenue.toLocaleString('id-ID')}`} 
          icon={DollarSign}
          color="#D97706"
          trend={stats.todayTrend}
          trendLabel="vs kemarin"
        />
        <StatCard 
          title="Bulan Ini" 
          value={`Rp ${stats.monthRevenue.toLocaleString('id-ID')}`} 
          icon={TrendingUp}
          color="#0EA5E9"
          trend={stats.monthTrend}
          trendLabel="vs bulan lalu"
        />
        <StatCard 
          title="Pesanan Aktif" 
          value={stats.totalOrders} 
          icon={ShoppingBag}
          color="#10B981"
        />
        <StatCard 
          title="Pelanggan" 
          value={stats.activeCustomers} 
          icon={Users}
          color="#8B5CF6"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Chart Section */}
        <div className="lg:col-span-2 bg-white border border-stone-100 p-8 rounded-[40px] shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-lg font-black text-secondary tracking-tight">Tren Penjualan</h3>
            <div className="bg-stone-50 px-3 py-1.5 rounded-full text-[10px] font-black text-stone-muted uppercase tracking-widest">7 Hari Terakhir</div>
          </div>
          <div className="h-[300px] min-w-0">
            <ResponsiveContainer width="100%" height="100%" debounce={100}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#D97706" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#D97706" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F5F5F4" vertical={false} />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{fill: '#A8A29E', fontSize: 11, fontWeight: 700}} 
                  dy={15}
                />
                <YAxis hide />
                <Tooltip 
                  cursor={{stroke: '#D97706', strokeWidth: 1}}
                  contentStyle={{ 
                    backgroundColor: '#FFF', 
                    border: 'none',
                    borderRadius: '20px',
                    boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
                    padding: '12px'
                  }}
                  itemStyle={{ color: '#D97706', fontWeight: 800, fontSize: '14px' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="sales" 
                  stroke="#D97706" 
                  strokeWidth={4}
                  fillOpacity={1} 
                  fill="url(#colorSales)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Orders List */}
        <div className="bg-bakery-sidebar border border-stone-200 p-8 rounded-[40px] shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-black text-secondary tracking-tight">Pesanan Baru</h3>
            <Clock size={18} className="text-stone-300" />
          </div>
          <div className="flex-1 space-y-4">
            {recentOrders.map(order => (
              <div key={order.id} className="bg-white p-4 rounded-2xl border border-stone-100 flex items-center gap-3 group cursor-pointer hover:border-primary transition-all">
                <div className="w-10 h-10 rounded-xl bg-bakery-bg flex items-center justify-center font-black text-primary text-xs">
                  #{String(order.order_number || '').slice(-2)}
                </div>
                <div className="flex-1">
                  <p className="font-bold text-sm text-secondary truncate">{order.customer_name}</p>
                  <p className="text-[10px] font-black text-stone-muted uppercase tracking-widest">Rp {Number(order.total_price).toLocaleString('id-ID')}</p>
                </div>
                <ChevronRight size={14} className="text-stone-200 group-hover:text-primary transition-colors" />
              </div>
            ))}
          </div>
          <button className="mt-6 w-full py-3 bg-white border border-stone-200 rounded-2xl text-xs font-black uppercase tracking-widest text-stone-text hover:bg-stone-50 transition-colors">
            Lihat Semua
          </button>
        </div>
      </div>
    </div>
  );
}
