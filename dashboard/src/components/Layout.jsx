import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, ShoppingBag, Box, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';

const NavItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/orders', label: 'Pesanan', icon: ShoppingBag },
  { path: '/products', label: 'Produk', icon: Box },
];

export default function Layout({ children }) {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <div className="layout">
      {/* Sidebar - Desktop */}
      <aside className="sidebar glass-card">
        <div className="sidebar-header">
          <img src="/logoyoyobolen.PNG" alt="Logo" className="brand-logo" />
          <h2 className="text-gradient">Yoyo Backoffice</h2>
        </div>
        
        <nav className="sidebar-nav">
          {NavItems.map((item) => (
            <NavLink 
              key={item.path} 
              to={item.path} 
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <button onClick={handleLogout} className="logout-btn">
          <LogOut size={20} />
          <span>Keluar</span>
        </button>
      </aside>

      {/* Main Content */}
      <main className="main-content page-container">
        {children}
      </main>

      {/* Bottom Navigation - Mobile */}
      <nav className="bottom-nav glass-nav">
        {NavItems.map((item) => (
          <NavLink 
            key={item.path} 
            to={item.path} 
            className={({ isActive }) => `bottom-link ${isActive ? 'active' : ''}`}
          >
            <item.icon size={22} />
            <span>{item.label}</span>
          </NavLink>
        ))}
        <button onClick={handleLogout} className="bottom-link">
          <LogOut size={22} />
          <span>Keluar</span>
        </button>
      </nav>

      <style jsx>{`
        .layout {
          display: flex;
          min-height: 100vh;
        }

        /* Sidebar Desktop */
        .sidebar {
          width: 260px;
          height: calc(100vh - 40px);
          position: fixed;
          left: 20px;
          top: 20px;
          display: flex;
          flex-direction: column;
          padding: 30px 15px;
          z-index: 100;
        }

        .sidebar-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 0 10px 30px;
          border-bottom: 1px solid var(--card-border);
          margin-bottom: 20px;
        }

        .logo-emoji { font-size: 24px; }
        .sidebar-header h2 { font-size: 18px; }

        .sidebar-nav {
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex: 1;
        }

        .nav-link {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 15px;
          border-radius: 12px;
          color: var(--text-muted);
          text-decoration: none;
          transition: var(--transition);
        }

        .nav-link:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #fff;
        }

        .nav-link.active {
          background: rgba(245, 158, 11, 0.15);
          color: var(--primary);
          font-weight: 600;
        }

        .logout-btn {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 15px;
          border-radius: 12px;
          color: var(--accent-red);
          background: transparent;
          margin-top: auto;
        }

        .logout-btn:hover {
          background: rgba(239, 68, 68, 0.1);
        }

        /* Main Content Area */
        .main-content {
          flex: 1;
          margin-left: 300px;
          padding: 40px 40px 40px 20px;
        }

        /* Bottom Nav Mobile */
        .bottom-nav {
          display: none;
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          height: 75px;
          justify-content: space-around;
          align-items: center;
          padding: 0 10px;
          z-index: 1000;
        }

        .bottom-link {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          color: var(--text-muted);
          text-decoration: none;
          font-size: 11px;
          background: transparent;
        }

        .bottom-link.active {
          color: var(--primary);
        }

        @media (max-width: 1024px) {
          .sidebar { display: none; }
          .main-content { margin-left: 0; padding: 20px; }
          .bottom-nav { display: flex; }
        }
      `}</style>
    </div>
  );
}
