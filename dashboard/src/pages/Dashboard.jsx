import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { 
  TrendingUp, 
  Users, 
  ShoppingBag, 
  DollarSign,
  ArrowUpRight,
  ArrowDownRight
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

const StatCard = ({ title, value, icon: Icon, color, trend }) => (
  <div className="glass-card stat-card animate-fade">
    <div className="stat-content">
      <p className="stat-title">{title}</p>
      <h2 className="stat-value">{value}</h2>
      {trend && (
        <div className={`stat-trend ${trend > 0 ? 'up' : 'down'}`}>
          {trend > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          <span>{Math.abs(trend)}% vs kemarin</span>
        </div>
      )}
    </div>
    <div className="stat-icon-wrapper" style={{ backgroundColor: `${color}20`, color: color }}>
      <Icon size={24} />
    </div>
  </div>
);

export default function Dashboard() {
  const [stats, setStats] = useState({
    todayRevenue: 0,
    monthRevenue: 0,
    totalOrders: 0,
    activeCustomers: 0
  });
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      // Fetch stats from Supabase
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const firstDayMonth = new Date(today.getFullYear(), today.getMonth(), 1);

      // 1. Today Revenue
      const { data: todayOrders } = await supabase
        .from('orders')
        .select('total_price')
        .gte('created_at', today.toISOString())
        .eq('order_status', 'completed');
      
      const todayRev = todayOrders?.reduce((acc, curr) => acc + (Number(curr.total_price) || 0), 0) || 0;

      // 2. Month Revenue
      const { data: monthOrders } = await supabase
        .from('orders')
        .select('total_price, created_at')
        .gte('created_at', firstDayMonth.toISOString())
        .eq('order_status', 'completed');
      
      const monthRev = monthOrders?.reduce((acc, curr) => acc + (Number(curr.total_price) || 0), 0) || 0;

      // 3. Active Orders
      const { count: orderCount } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .not('order_status', 'in', '("cancelled")');

      // 4. Total Customers
      const { count: customerCount } = await supabase
        .from('customers')
        .select('*', { count: 'exact', head: true });

      setStats({
        todayRevenue: todayRev,
        monthRevenue: monthRev,
        totalOrders: orderCount || 0,
        activeCustomers: customerCount || 0
      });
      console.log('✅ Stats loaded successfully');

      // 5. Prepare Chart Data (Last 7 days)
      const last7Days = [...Array(7)].map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return d.toLocaleDateString('id-ID', { weekday: 'short' });
      });

      // Dummy data for chart if no real data yet
      setChartData(last7Days.map(day => ({
        name: day,
        sales: Math.floor(Math.random() * 500000) + 100000
      })));

      setLoading(false);
    } catch (err) {
      console.error('❌ Dashboard Error:', err);
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      await fetchStats();
    };
    init();
  }, []);

  if (loading) return <div className="loading-state">Memuat dashboard...</div>;

  return (
    <div className="dashboard-page">
      <header className="page-header">
        <h1 className="text-gradient">Ringkasan Penjualan</h1>
        <p>Data terbaru operasional Yoyo Bakery</p>
      </header>

      <div className="stats-grid">
        <StatCard 
          title="Pendapatan Hari Ini" 
          value={`Rp ${stats.todayRevenue.toLocaleString('id-ID')}`} 
          icon={DollarSign}
          color="#f59e0b"
          trend={12}
        />
        <StatCard 
          title="Pendapatan Bulan Ini" 
          value={`Rp ${stats.monthRevenue.toLocaleString('id-ID')}`} 
          icon={TrendingUp}
          color="#3b82f6"
          trend={8}
        />
        <StatCard 
          title="Total Pesanan Aktif" 
          value={stats.totalOrders} 
          icon={ShoppingBag}
          color="#10b981"
        />
        <StatCard 
          title="Total Pelanggan" 
          value={stats.activeCustomers} 
          icon={Users}
          color="#8b5cf6"
        />
      </div>

      <div className="chart-section glass-card animate-fade">
        <div className="chart-header">
          <h3>Tren Penjualan (7 Hari Terakhir)</h3>
        </div>
        <div className="chart-wrapper">
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                tick={{fill: '#94a3b8', fontSize: 12}} 
                dy={10}
              />
              <YAxis 
                hide 
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#1e293b', 
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '12px',
                  color: '#fff'
                }}
                itemStyle={{ color: '#f59e0b' }}
              />
              <Area 
                type="monotone" 
                dataKey="sales" 
                stroke="#f59e0b" 
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#colorSales)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <style jsx>{`
        .dashboard-page {
          max-width: 1200px;
          margin: 0 auto;
        }
        .page-header {
          margin-bottom: 30px;
        }
        .page-header p { color: var(--text-muted); font-size: 14px; }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }

        .stat-card {
          padding: 24px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          transition: var(--transition);
        }
        .stat-card:hover { transform: translateY(-5px); }

        .stat-title {
          color: var(--text-muted);
          font-size: 14px;
          margin-bottom: 8px;
        }
        .stat-value {
          font-size: 22px;
          margin-bottom: 8px;
        }
        .stat-trend {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          font-weight: 600;
        }
        .stat-trend.up { color: var(--accent-green); }
        .stat-trend.down { color: var(--accent-red); }

        .stat-icon-wrapper {
          width: 48px;
          height: 48px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .chart-section {
          padding: 30px;
          margin-bottom: 30px;
        }
        .chart-header { margin-bottom: 25px; }
        .chart-header h3 { font-size: 18px; }
        .chart-wrapper { width: 100%; }

        @media (max-width: 768px) {
          .stats-grid { grid-template-columns: 1fr; }
          .chart-section { padding: 20px; }
        }
      `}</style>
    </div>
  );
}
