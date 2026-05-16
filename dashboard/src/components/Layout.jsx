import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, ShoppingBag, Box, LogOut, Users, Settings } from 'lucide-react';
import { supabase } from '../lib/supabase';

const NavItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/orders', label: 'Pesanan', icon: ShoppingBag },
  { path: '/products', label: 'Produk', icon: Box },
  { path: '/customers', label: 'Pelanggan', icon: Users },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export default function Layout({ children }) {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen bg-bakery-bg">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex w-72 h-[calc(100vh-32px)] fixed left-4 top-4 bg-bakery-sidebar border border-stone-200 rounded-[32px] flex-col p-8 z-50 shadow-sm">
        <div className="flex items-center gap-3 pb-8 mb-4 border-b border-stone-100">
          <div className="bg-white p-2 rounded-xl shadow-sm">
            <img src="/logoyoyobolen.PNG" alt="Logo" className="w-10 h-10 object-contain" />
          </div>
          <div>
            <h2 className="font-bold text-secondary text-lg leading-tight">Yoyo Bakery</h2>
            <p className="text-xs text-stone-muted font-medium uppercase tracking-wider">Backoffice</p>
          </div>
        </div>
        
        <nav className="flex-1 space-y-2">
          {NavItems.map((item) => (
            <NavLink 
              key={item.path} 
              to={item.path} 
              className={({ isActive }) => `
                flex items-center gap-4 px-5 py-4 rounded-2xl transition-all duration-200 group
                ${isActive 
                  ? 'bg-primary text-white shadow-lg shadow-primary/20' 
                  : 'text-stone-text hover:bg-stone-100'
                }
              `}
            >
              {({ isActive }) => (
                <>
                  <item.icon size={20} className={isActive ? 'text-white' : 'text-stone-muted group-hover:text-primary'} />
                  <span className="font-semibold">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <button 
          onClick={handleLogout} 
          className="flex items-center gap-4 px-5 py-4 rounded-2xl text-rose-600 hover:bg-rose-50 transition-all duration-200 mt-auto font-semibold"
        >
          <LogOut size={20} />
          <span>Keluar</span>
        </button>
      </aside>

      {/* Main Content */}
      <main className="flex-1 lg:ml-80 p-4 md:p-8 pb-32 lg:pb-8">
        <div className="max-w-6xl mx-auto animate-fade">
          {children}
        </div>
      </main>

      {/* Bottom Navigation - Mobile */}
      <nav className="lg:hidden fixed bottom-6 left-4 right-4 h-20 bg-white/80 backdrop-blur-xl border border-stone-200 rounded-[28px] flex justify-around items-center px-1 z-1000 shadow-2xl">
        {NavItems.map((item) => (
          <NavLink 
            key={item.path} 
            to={item.path} 
            className={({ isActive }) => `
              flex flex-col items-center gap-1 transition-all duration-300 px-2 py-2 rounded-2xl
              ${isActive ? 'text-primary scale-105' : 'text-stone-muted'}
            `}
          >
            {({ isActive }) => (
              <>
                <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-[8px] font-bold uppercase tracking-wider">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
