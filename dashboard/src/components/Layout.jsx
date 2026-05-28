import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, ShoppingBag, Box, LogOut, Users, Settings, MessageCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

const NavItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/inbox', label: 'Inbox', icon: MessageCircle },
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
      {/* Mobile Top Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white/70 backdrop-blur-md border-b border-stone-200 z-[100] flex items-center justify-between px-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-white p-1.5 rounded-lg shadow-sm border border-stone-100">
            <img src="/logoyoyobolen.PNG" alt="Logo" className="w-8 h-8 object-contain" />
          </div>
          <h2 className="font-bold text-secondary text-base">Yoyo Bakery</h2>
        </div>
        <button 
          onClick={handleLogout}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-rose-50 text-rose-600 border border-rose-100 hover:bg-rose-100 transition-colors"
        >
          <LogOut size={16} />
        </button>
      </header>

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
      <main className="flex-1 pt-20 lg:pt-4 lg:ml-80 p-4 md:p-8 pb-28 lg:pb-8">
        <div className="max-w-6xl mx-auto animate-fade">
          {children}
        </div>
      </main>

      {/* Bottom Navigation - Mobile */}
      <nav className="lg:hidden fixed bottom-4 left-4 right-4 h-16 bg-white/90 backdrop-blur-xl border border-stone-200/50 rounded-[24px] flex justify-around items-center px-2 z-[100] shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
        {NavItems.map((item) => (
          <NavLink 
            key={item.path} 
            to={item.path} 
            className={({ isActive }) => `
              relative flex flex-col items-center justify-center w-12 h-12 transition-all duration-300 rounded-xl
              ${isActive ? 'text-primary' : 'text-stone-400 hover:text-stone-600'}
            `}
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute -top-1 w-1 h-1 bg-primary rounded-full shadow-[0_0_8px_rgba(217,119,6,0.6)]"></span>
                )}
                <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} className={isActive ? 'drop-shadow-sm scale-110' : ''} />
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
