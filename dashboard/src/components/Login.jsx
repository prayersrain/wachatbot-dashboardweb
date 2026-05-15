import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Lock, Mail, Loader2 } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="glass-card login-card animate-fade">
        <div className="login-header">
          <img src="/logoyoyobolen.PNG" alt="Yoyo Bakery" className="brand-logo-large" />
          <h1 className="text-gradient">Yoyo Bakery</h1>
          <p>Backoffice Staff Portal</p>
        </div>

        <form onSubmit={handleLogin} className="login-form">
          <div className="input-group">
            <Mail size={18} className="input-icon" />
            <input
              type="email"
              placeholder="Email Staff"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="input-group">
            <Lock size={18} className="input-icon" />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <div className="error-msg">{error}</div>}

          <button type="submit" disabled={loading} className="login-btn">
            {loading ? <Loader2 className="spinner" /> : 'Masuk Dashboard'}
          </button>
        </form>
      </div>

      <style jsx>{`
        .login-container {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 20px;
        }
        .login-card {
          width: 100%;
          max-width: 400px;
          padding: 40px;
          text-align: center;
        }
        .login-header {
          margin-bottom: 30px;
        }
        .logo-icon {
          font-size: 40px;
          margin-bottom: 10px;
        }
        .login-header p {
          color: var(--text-muted);
          font-size: 14px;
          margin-top: 5px;
        }
        .login-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .input-group {
          position: relative;
          display: flex;
          align-items: center;
        }
        .input-icon {
          position: absolute;
          left: 15px;
          color: var(--text-muted);
        }
        .input-group input {
          width: 100%;
          padding: 14px 15px 14px 45px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--card-border);
          border-radius: 12px;
          color: #fff;
          transition: var(--transition);
        }
        .input-group input:focus {
          border-color: var(--primary);
          background: rgba(255, 255, 255, 0.08);
        }
        .login-btn {
          padding: 14px;
          background: linear-gradient(135deg, var(--primary), #fbbf24);
          color: #000;
          font-weight: 700;
          border-radius: 12px;
          margin-top: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .login-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(245, 158, 11, 0.4);
        }
        .login-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none;
        }
        .error-msg {
          color: var(--accent-red);
          font-size: 13px;
          background: rgba(239, 68, 68, 0.1);
          padding: 10px;
          border-radius: 8px;
        }
        .spinner {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
