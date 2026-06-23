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
    <div className="flex items-center justify-center min-h-screen bg-cream p-4">
      <div className="w-full max-w-sm bg-paper border border-wheat/30 rounded-3xl p-8 md:p-10 shadow-xl animate-rise">
        <div className="text-center mb-8">
          <div className="inline-block bg-cream p-4 rounded-2xl mb-5">
            <img src="/logoyoyobolen.PNG" alt="Yoyo Bakery" className="w-16 h-16 object-contain" />
          </div>
          <h1 className="font-display text-2xl font-black text-crust tracking-tight">Yoyo Bakery</h1>
          <p className="text-sm text-charcoal/60 mt-1">Staff Access</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-charcoal uppercase tracking-wider ml-1">Email</label>
            <div className="relative group">
              <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-wheat group-focus-within:text-amber transition-colors" />
              <input type="email" placeholder="staff@yoyobakery.com" className="input pl-10" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-charcoal uppercase tracking-wider ml-1">Password</label>
            <div className="relative group">
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-wheat group-focus-within:text-amber transition-colors" />
              <input type="password" placeholder="••••••••" className="input pl-10" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
          </div>

          {error && (
            <div className="bg-rose-50 text-rose-600 text-sm font-medium p-3 rounded-xl border border-rose-100">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn w-full font-display text-base">
            {loading ? <Loader2 className="animate-spin" size={18} /> : 'Masuk'}
          </button>
        </form>

        <p className="text-center text-[10px] text-charcoal/40 mt-8">&copy; 2024 Yoyo Bakery</p>
      </div>
    </div>
  );
}
