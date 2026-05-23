import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { Settings as SettingsIcon, User, Bell, Info, Lock, Volume2, VolumeX, ExternalLink, Mail, LogOut, MessageCircleQuestion, Plus, Trash2, Edit2, Save, X, AlertCircle } from 'lucide-react';

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

  const [faqs, setFaqs] = useState([]);
  const [loadingFaqs, setLoadingFaqs] = useState(true);
  const [editingFaq, setEditingFaq] = useState(null);
  const [newFaq, setNewFaq] = useState({ question: '', answer: '' });
  const [showAddFaq, setShowAddFaq] = useState(false);

  const [bolenSoldOut, setBolenSoldOut] = useState(false);

  useEffect(() => {
    fetchFaqs();
    fetchGlobalSettings();
  }, []);

  const fetchGlobalSettings = async () => {
    try {
      const { data, error } = await supabase.from('global_settings').select('*').eq('key', 'bolen_sold_out_today').single();
      if (data) {
        setBolenSoldOut(data.value === 'true');
      }
    } catch (err) {
      // It's okay if not exists yet
    }
  };

  const toggleBolenSoldOut = async () => {
    const newVal = !bolenSoldOut;
    setBolenSoldOut(newVal);
    try {
      await supabase.from('global_settings').upsert({ key: 'bolen_sold_out_today', value: String(newVal) }, { onConflict: 'key' });
      toast.success(newVal ? 'Bolen Instan diset HABIS hari ini' : 'Bolen Instan diset TERSEDIA hari ini');
    } catch (err) {
      toast.error('Gagal update status Bolen');
    }
  };

  const fetchFaqs = async () => {
    try {
      const { data, error } = await supabase.from('faqs').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      setFaqs(data || []);
    } catch (err) {
      toast.error('Gagal memuat FAQ');
    } finally {
      setLoadingFaqs(false);
    }
  };

  const handleAddFaq = async (e) => {
    e.preventDefault();
    if (!newFaq.question || !newFaq.answer) return;
    try {
      const { error } = await supabase.from('faqs').insert([newFaq]);
      if (error) throw error;
      toast.success('FAQ berhasil ditambahkan');
      setNewFaq({ question: '', answer: '' });
      setShowAddFaq(false);
      fetchFaqs();
    } catch (err) {
      toast.error('Gagal menambah FAQ');
    }
  };

  const handleUpdateFaq = async (id, question, answer) => {
    try {
      const { error } = await supabase.from('faqs').update({ question, answer }).eq('id', id);
      if (error) throw error;
      toast.success('FAQ berhasil diupdate');
      setEditingFaq(null);
      fetchFaqs();
    } catch (err) {
      toast.error('Gagal mengupdate FAQ');
    }
  };

  const handleDeleteFaq = async (id) => {
    if (!window.confirm('Yakin ingin menghapus FAQ ini?')) return;
    try {
      const { error } = await supabase.from('faqs').delete().eq('id', id);
      if (error) throw error;
      toast.success('FAQ berhasil dihapus');
      fetchFaqs();
    } catch (err) {
      toast.error('Gagal menghapus FAQ');
    }
  };

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

        <div className="flex items-center justify-between bg-stone-50 border border-stone-100 rounded-2xl p-4 mt-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${bolenSoldOut ? 'bg-rose-100' : 'bg-emerald-100'}`}>
              <AlertCircle size={20} className={bolenSoldOut ? 'text-rose-600' : 'text-emerald-600'} />
            </div>
            <div>
              <p className="font-bold text-secondary text-sm">Bolen Instan Habis Hari Ini</p>
              <p className="text-xs text-stone-muted">Jika aktif, Bot AI akan memberitahu pelanggan bahwa pesanan bolen dikirim BESOK.</p>
            </div>
          </div>
          <button
            onClick={toggleBolenSoldOut}
            className={`w-14 h-8 rounded-full transition-all duration-300 relative ${bolenSoldOut ? 'bg-rose-500' : 'bg-stone-200'}`}
          >
            <div className={`w-6 h-6 bg-white rounded-full shadow absolute top-1 transition-all duration-300 ${bolenSoldOut ? 'left-7' : 'left-1'}`} />
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

      {/* FAQ Management */}
      <SectionCard icon={MessageCircleQuestion} title="Pengetahuan AI (FAQ)">
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-xs text-stone-muted font-medium">Pengetahuan tambahan untuk bot AI.</p>
            <button 
              onClick={() => setShowAddFaq(!showAddFaq)}
              className="flex items-center gap-1 bg-primary text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-secondary transition-colors"
            >
              <Plus size={14} /> Tambah FAQ
            </button>
          </div>

          {showAddFaq && (
            <form onSubmit={handleAddFaq} className="bg-stone-50 p-4 rounded-2xl border border-stone-200 space-y-3">
              <input 
                type="text" 
                placeholder="Pertanyaan (Contoh: Apa bisa bayar COD?)" 
                className="w-full bg-white border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary"
                value={newFaq.question}
                onChange={e => setNewFaq({ ...newFaq, question: e.target.value })}
                required
              />
              <textarea 
                placeholder="Jawaban (Contoh: Maaf Kak, saat ini kami hanya menerima transfer bank.)" 
                className="w-full bg-white border border-stone-200 rounded-xl px-3 py-2 text-sm h-20 focus:outline-none focus:border-primary resize-none"
                value={newFaq.answer}
                onChange={e => setNewFaq({ ...newFaq, answer: e.target.value })}
                required
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowAddFaq(false)} className="px-3 py-1.5 text-xs font-bold text-stone-500 hover:text-stone-700">Batal</button>
                <button type="submit" className="bg-primary text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-secondary">Simpan</button>
              </div>
            </form>
          )}

          {loadingFaqs ? (
            <p className="text-sm text-stone-400">Memuat FAQ...</p>
          ) : faqs.length === 0 ? (
            <p className="text-sm text-stone-400">Belum ada data FAQ.</p>
          ) : (
            <div className="space-y-3 mt-4">
              {faqs.map(faq => (
                <div key={faq.id} className="bg-stone-50 border border-stone-100 rounded-2xl p-4">
                  {editingFaq?.id === faq.id ? (
                    <div className="space-y-3">
                      <input 
                        type="text" 
                        className="w-full bg-white border border-stone-200 rounded-xl px-3 py-2 text-sm"
                        value={editingFaq.question}
                        onChange={e => setEditingFaq({ ...editingFaq, question: e.target.value })}
                      />
                      <textarea 
                        className="w-full bg-white border border-stone-200 rounded-xl px-3 py-2 text-sm h-20 resize-none"
                        value={editingFaq.answer}
                        onChange={e => setEditingFaq({ ...editingFaq, answer: e.target.value })}
                      />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditingFaq(null)} className="flex items-center gap-1 text-xs font-bold text-stone-500 hover:text-stone-700">
                          <X size={14} /> Batal
                        </button>
                        <button onClick={() => handleUpdateFaq(faq.id, editingFaq.question, editingFaq.answer)} className="flex items-center gap-1 text-xs font-bold text-primary hover:text-secondary">
                          <Save size={14} /> Simpan
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <p className="font-bold text-sm text-secondary">Q: {faq.question}</p>
                        <div className="flex gap-2">
                          <button onClick={() => setEditingFaq(faq)} className="text-stone-400 hover:text-primary"><Edit2 size={14} /></button>
                          <button onClick={() => handleDeleteFaq(faq.id)} className="text-stone-400 hover:text-rose-500"><Trash2 size={14} /></button>
                        </div>
                      </div>
                      <p className="text-sm text-stone-600 whitespace-pre-wrap">A: {faq.answer}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
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
