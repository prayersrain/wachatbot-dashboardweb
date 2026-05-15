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
    <div className="flex items-center justify-center min-h-screen bg-bakery-bg p-6">
      <div className="w-full max-w-md bg-white border border-stone-200 rounded-[40px] p-10 md:p-14 shadow-2xl animate-fade">
        <div className="text-center mb-10">
          <div className="inline-block bg-bakery-bg p-4 rounded-3xl mb-6 shadow-inner">
            <img src="/logoyoyobolen.PNG" alt="Yoyo Bakery" className="w-20 h-20 object-contain" />
          </div>
          <h1 className="text-3xl font-black text-secondary tracking-tight">Yoyo Bakery</h1>
          <p className="text-stone-muted font-medium mt-2">Staff Access Portal</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-stone-muted uppercase tracking-widest ml-1">Email</label>
            <div className="relative group">
              <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300 group-focus-within:text-primary transition-colors" />
              <input
                type="email"
                placeholder="staff@yoyobakery.com"
                className="w-full bg-stone-50 border border-stone-200 rounded-2xl py-4 pl-12 pr-4 outline-none focus:border-primary focus:ring-4 focus:ring-primary/5 transition-all text-stone-text font-medium"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-stone-muted uppercase tracking-widest ml-1">Password</label>
            <div className="relative group">
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300 group-focus-within:text-primary transition-colors" />
              <input
                type="password"
                placeholder="••••••••"
                className="w-full bg-stone-50 border border-stone-200 rounded-2xl py-4 pl-12 pr-4 outline-none focus:border-primary focus:ring-4 focus:ring-primary/5 transition-all text-stone-text font-medium"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          {error && (
            <div className="bg-rose-50 text-rose-600 text-sm font-semibold p-4 rounded-2xl border border-rose-100 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse" />
              {error}
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading} 
            className="w-full bg-secondary hover:bg-black text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-secondary/20 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3"
          >
            {loading ? (
              <Loader2 className="animate-spin" />
            ) : (
              'Masuk Sekarang'
            )}
          </button>
        </form>
        
        <p className="text-center text-xs text-stone-muted mt-10 font-medium">
          &copy; 2024 Yoyo Bakery Management
        </p>
      </div>
    </div>
  );
}
