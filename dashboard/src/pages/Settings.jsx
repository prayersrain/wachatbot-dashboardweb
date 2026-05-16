import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { Settings as SettingsIcon, User, Bell, Info, Lock, Volume2, VolumeX, ExternalLink, Mail, LogOut } from 'lucide-react';

// Defined OUTSIDE the component to avoid re-creation on every render
const SectionCard = ({ icon: Icon, title, children }) => (
  <div className="bg-white border border-stone-100 rounded-[32px] p-6 md:p-8 shadow-sm">
    <div className="flex items-center gap-3 mb-6">
      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
        <Icon size={20} className="text-primary" />
      </div>
      <h3 className="text-lg font-black text-secondary tracking-tight">{title}</h3>
    </div>
    {children}
  </div>
);

export default function Settings() {
  const toast = useToast();
  const navigate = useNavigate();
  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('yoyo_sound') !== 'off';
  });
  const [passwordForm, setPasswordForm] = useState({ current: '', new: '', confirm: '' });
  const [changingPassword, setChangingPassword] = useState(false);

  const toggleSound = () => {
    const newVal = !soundEnabled;
    setSoundEnabled(newVal);
    localStorage.setItem('yoyo_sound', newVal ? 'on' : 'off');
    toast.success(newVal ? 'Notifikasi suara diaktifkan' : 'Notifikasi suara dimatikan');
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (passwordForm.new.length < 6) {
      toast.error('Password minimal 6 karakter');
      return;
    }
    if (passwordForm.new !== passwordForm.confirm) {
      toast.error('Password baru tidak cocok');
      return;
    }

    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: passwordForm.new });
      if (error) throw error;
      toast.success('Password berhasil diubah!');
      setPasswordForm({ current: '', new: '', confirm: '' });
    } catch (err) {
      toast.error('Gagal ubah password: ' + err.message);
    }
    setChangingPassword(false);
  };


  return (
    <div className="space-y-6 max-w-2xl">
      <header>
        <h1 className="text-3xl font-black text-secondary tracking-tight">Pengaturan</h1>
        <p className="text-stone-muted font-medium mt-1">Konfigurasi dashboard Yoyo Bakery.</p>
      </header>

      {/* Store Profile */}
      <SectionCard icon={User} title="Profil Toko">
        <div className="space-y-4">
          <div className="bg-stone-50 border border-stone-100 rounded-2xl p-4">
            <p className="text-[10px] font-black text-stone-muted uppercase tracking-widest mb-1">Nama Toko</p>
            <p className="font-bold text-secondary">Yoyo Bakery (Yoyobolen)</p>
          </div>
          <div className="bg-stone-50 border border-stone-100 rounded-2xl p-4">
            <p className="text-[10px] font-black text-stone-muted uppercase tracking-widest mb-1">Deskripsi</p>
            <p className="text-sm text-stone-text font-medium">Toko roti artisan khas Bandung. Melayani pesanan via WhatsApp.</p>
          </div>
        </div>
      </SectionCard>

      {/* Notification */}
      <SectionCard icon={Bell} title="Notifikasi">
        <div className="flex items-center justify-between bg-stone-50 border border-stone-100 rounded-2xl p-4">
          <div className="flex items-center gap-3">
            {soundEnabled ? <Volume2 size={20} className="text-primary" /> : <VolumeX size={20} className="text-stone-300" />}
            <div>
              <p className="font-bold text-secondary text-sm">Suara Notifikasi</p>
              <p className="text-xs text-stone-muted">Bunyi saat ada pesanan baru masuk</p>
            </div>
          </div>
          <button
            onClick={toggleSound}
            className={`w-14 h-8 rounded-full transition-all duration-300 relative ${soundEnabled ? 'bg-primary' : 'bg-stone-200'}`}
          >
            <div className={`w-6 h-6 bg-white rounded-full shadow absolute top-1 transition-all duration-300 ${soundEnabled ? 'left-7' : 'left-1'}`} />
          </button>
        </div>
      </SectionCard>

      {/* Change Password */}
      <SectionCard icon={Lock} title="Ganti Password">
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="text-[10px] font-black text-stone-muted uppercase tracking-widest mb-2 block">Password Baru</label>
            <input
              type="password"
              className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-4 py-3 outline-none focus:border-primary focus:ring-4 focus:ring-primary/5 transition-all font-medium text-sm"
              placeholder="Minimal 6 karakter"
              value={passwordForm.new}
              onChange={e => setPasswordForm(p => ({ ...p, new: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-stone-muted uppercase tracking-widest mb-2 block">Konfirmasi Password</label>
            <input
              type="password"
              className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-4 py-3 outline-none focus:border-primary focus:ring-4 focus:ring-primary/5 transition-all font-medium text-sm"
              placeholder="Ulangi password baru"
              value={passwordForm.confirm}
              onChange={e => setPasswordForm(p => ({ ...p, confirm: e.target.value }))}
              required
            />
          </div>
          <button
            type="submit"
            disabled={changingPassword}
            className="w-full bg-primary hover:bg-secondary text-white py-4 rounded-2xl font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {changingPassword ? 'Mengubah...' : 'Simpan Password Baru'}
          </button>
        </form>
      </SectionCard>

      {/* About */}
      <SectionCard icon={Info} title="Tentang">
        <div className="space-y-3">
          <div className="flex justify-between items-center bg-stone-50 border border-stone-100 rounded-2xl p-4">
            <span className="text-sm font-bold text-secondary">Versi Aplikasi</span>
            <span className="text-xs font-black text-stone-muted bg-white px-3 py-1 rounded-lg border border-stone-100">v2.0.0</span>
          </div>
          <div className="flex justify-between items-center bg-stone-50 border border-stone-100 rounded-2xl p-4">
            <span className="text-sm font-bold text-secondary">Platform</span>
            <span className="text-xs font-black text-stone-muted">Vite + React 19</span>
          </div>
        </div>
      </SectionCard>

      {/* Logout */}
      <button
        onClick={async () => {
          await supabase.auth.signOut();
          navigate('/login');
        }}
        className="w-full flex items-center justify-center gap-3 py-5 bg-rose-50 border border-rose-100 text-rose-600 rounded-[32px] font-bold text-lg hover:bg-rose-100 transition-all"
      >
        <LogOut size={22} />
        Keluar dari Akun
      </button>
    </div>
  );
}
