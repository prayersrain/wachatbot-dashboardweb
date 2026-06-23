import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, ShoppingBag, Box, LogOut, Users, Settings, MessageCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

const NavItems = [
  { path: '/', label: 'Beranda', icon: LayoutDashboard },
  { path: '/inbox', label: 'Inbox', icon: MessageCircle },
  { path: '/orders', label: 'Pesanan', icon: ShoppingBag },
  { path: '/products', label: 'Produk', icon: Box },
  { path: '/customers', label: 'Klien', icon: Users },
];

export default function Layout({ children }) {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen bg-cream">
      {/* ── Mobile Top Bar ── */}
      <header className="lg:hidden fixed top-0 inset-x-0 h-14 bg-cream/90 backdrop-blur-md border-b border-wheat/30 z-[100] flex items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <img src="/logoyoyobolen.PNG" alt="Yoyo" className="w-7 h-7 object-contain rounded-lg" />
          <span className="font-display font-bold text-base text-crust tracking-tight">Yoyo</span>
        </div>
        <div className="flex items-center gap-1">
          <NavLink to="/settings"
            className={({ isActive }) => `w-9 h-9 flex items-center justify-center rounded-xl transition-all ${isActive ? 'bg-amber text-white' : 'text-charcoal hover:bg-flour'}`}
          >
            <Settings size={17} />
          </NavLink>
          <button onClick={handleLogout}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-rose-600 hover:bg-rose-50 transition-all">
            <LogOut size={17} />
          </button>
        </div>
      </header>

      {/* ── Desktop Sidebar ── */}
      <aside className="hidden lg:flex w-64 h-screen fixed left-0 top-0 bg-paper border-r border-wheat/30 flex-col p-6 z-50">
        <div className="flex items-center gap-3 pb-6 mb-6 border-b border-wheat/30">
          <img src="/logoyoyobolen.PNG" alt="Logo" className="w-10 h-10 object-contain rounded-xl" />
          <div>
            <h2 className="font-display font-bold text-lg text-crust leading-tight">Yoyo Bakery</h2>
            <p className="text-[10px] font-semibold text-charcoal/50 uppercase tracking-widest">Dashboard</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          {NavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-semibold
                ${isActive
                  ? 'bg-amber text-white shadow-md shadow-amber/20'
                  : 'text-charcoal hover:bg-flour'
                }`
              }
            >
              <item.icon size={18} strokeWidth={2} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <NavLink to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-semibold mt-1
            ${isActive ? 'bg-amber text-white' : 'text-charcoal hover:bg-flour'}`
          }
        >
          <Settings size={18} strokeWidth={2} />
          Settings
        </NavLink>

        <button onClick={handleLogout}
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-rose-600 hover:bg-rose-50 transition-all duration-200 text-sm font-semibold mt-2">
          <LogOut size={18} strokeWidth={2} />
          Keluar
        </button>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 pt-16 pb-24 lg:pt-6 lg:pb-6 lg:ml-64 px-4 md:px-8">
        <div className="max-w-6xl mx-auto animate-rise">
          {children}
        </div>
      </main>

      {/* ── Bottom Nav (Mobile) ── */}
      <nav className="lg:hidden fixed bottom-3 inset-x-3 h-16 bg-paper/95 backdrop-blur-xl
        border border-wheat/30 rounded-2xl flex justify-around items-center px-2 z-[100]
        shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
        {NavItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `relative flex flex-col items-center justify-center gap-0.5 px-3 py-2 rounded-xl
               transition-all duration-200 min-w-0
              ${isActive ? 'text-amber' : 'text-charcoal/40 hover:text-charcoal/70'}`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute -top-0.5 w-1 h-1 bg-amber rounded-full" />}
                <item.icon size={21} strokeWidth={isActive ? 2.5 : 1.8} />
                <span className={`text-[10px] font-semibold leading-none ${isActive ? 'text-amber' : ''}`}>
                  {item.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
