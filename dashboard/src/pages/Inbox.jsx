import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { MessageCircle, Send, User, Clock, AlertCircle, CheckCircle2, PlayCircle, ChevronLeft } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { id } from 'date-fns/locale';

const getSessionPhone = (session) => {
  if (!session) return '-';
  if (session.data?.customerPhone) return session.data.customerPhone;
  return session.wa_number?.split('@')[0] || '-';
};

export default function Inbox() {
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [filterState, setFilterState] = useState('ALL');
  const chatEndRef = useRef(null);

  const fetchSessions = async () => {
    try {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .not('wa_number', 'like', 'system:%')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setSessions(data || []);
      setLoading(false);
      
      // Update selected session if it exists
      setSelectedSession(prev => {
        if (prev) {
          const updated = data?.find(s => s.wa_number === prev.wa_number);
          if (updated) return updated;
        }
        return prev;
      });
    } catch (err) {
      console.error('Error fetching sessions:', err);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();

    const channel = supabase.channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sessions' },
        (payload) => {
          fetchSessions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []); // removed dependency to prevent re-subscribing and dropping events

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedSession?.data?.history]);

  const handleTakeover = async (waNumber) => {
    try {
      await supabase
        .from('sessions')
        .update({ state: 'ADMIN_TAKEOVER', updated_at: new Date().toISOString() })
        .eq('wa_number', waNumber);
    } catch (err) {
      console.error('Error takeover:', err);
    }
  };

  const handleEndSession = async (waNumber) => {
    try {
      await supabase
        .from('sessions')
        .update({ state: 'IDLE', updated_at: new Date().toISOString() })
        .eq('wa_number', waNumber);
    } catch (err) {
      console.error('Error end session:', err);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!message.trim() || !selectedSession) return;

    setSending(true);
    try {
      // Mengirim pesan via Supabase Broadcast ke laptop yang menjalankan bot
      const channel = supabase.channel('whatsapp_bot');
      await channel.send({
        type: 'broadcast',
        event: 'send_message',
        payload: {
          wa_number: selectedSession.wa_number,
          message: message.trim()
        }
      });
      
      setMessage('');
      // Optimistic update
      const newHistory = [...(selectedSession.data?.history || []), { role: 'bot', content: message.trim() }];
      setSelectedSession({
        ...selectedSession,
        data: { ...selectedSession.data, history: newHistory }
      });
    } catch (err) {
      console.error('Error sending message:', err);
      alert('Gagal mengirim pesan: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  const getStateColor = (state) => {
    switch(state) {
      case 'ADMIN_TAKEOVER': return 'bg-rose-100 text-rose-700 border-rose-200';
      case 'IDLE': return 'bg-stone-100 text-stone-600 border-stone-200';
      case 'ORDER': case 'REGION_SELECT': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'LOCATION': case 'CONFIRM': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'PAYMENT': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      default: return 'bg-stone-100 text-stone-600 border-stone-200';
    }
  };

  if (loading) return <div>Loading inbox...</div>;

  return (
    <div className="h-[calc(100vh-8rem)] flex gap-6 pb-6 overflow-hidden max-w-full">
      {/* Sidebar: Session List */}
      <div className={`w-full md:w-1/3 bg-white border border-stone-100 rounded-[32px] shadow-sm flex-col overflow-hidden ${selectedSession ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-6 border-b border-stone-100">
          <h2 className="text-xl font-black text-secondary tracking-tight flex items-center gap-2">
            <MessageCircle size={24} className="text-primary" />
            Live Chat
          </h2>
          <p className="text-xs font-bold text-stone-muted uppercase tracking-widest mt-2">
            {sessions.length} Percakapan Aktif
          </p>
          <div className="flex gap-2 overflow-x-auto pb-2 mt-4 scrollbar-hide">
            {['ALL', 'IDLE', 'ORDER', 'LOCATION', 'CONFIRM', 'PAYMENT', 'ADMIN_TAKEOVER'].map(f => (
              <button 
                key={f}
                onClick={() => setFilterState(f)}
                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider shrink-0 transition-colors ${filterState === f ? 'bg-primary text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
              >
                {f === 'ADMIN_TAKEOVER' ? 'TAKEOVER' : f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {sessions.filter(s => filterState === 'ALL' || s.state === filterState).map(s => (
            <div 
              key={s.wa_number}
              onClick={() => setSelectedSession(s)}
              className={`p-4 rounded-2xl cursor-pointer transition-all border ${selectedSession?.wa_number === s.wa_number ? 'bg-orange-50 border-primary' : 'bg-white border-stone-100 hover:border-primary/30'}`}
            >
              <div className="flex justify-between items-start mb-2">
                <p className="font-bold text-sm text-secondary truncate">
                  {s.data?.customerName || getSessionPhone(s)}
                </p>
                <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border shrink-0 whitespace-nowrap ml-2 ${getStateColor(s.state)}`}>
                  {s.state}
                </span>
              </div>
              <div className="flex items-center text-[10px] font-bold text-stone-muted gap-1 uppercase tracking-widest">
                <Clock size={10} />
                {formatDistanceToNow(new Date(s.updated_at), { addSuffix: true, locale: id })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className={`flex-1 bg-white border border-stone-100 rounded-[32px] shadow-sm flex-col overflow-hidden ${selectedSession ? 'flex' : 'hidden md:flex'}`}>
        {selectedSession ? (
          <>
            <div className="p-6 border-b border-stone-100 flex justify-between items-center bg-stone-50/50">
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setSelectedSession(null)} 
                  className="md:hidden p-2 -ml-2 rounded-xl text-stone-400 hover:text-stone-600 hover:bg-stone-200/50 transition-colors"
                >
                  <ChevronLeft size={24} />
                </button>
                <div>
                  <h3 className="font-black text-lg text-secondary">
                    {selectedSession.data?.customerName || getSessionPhone(selectedSession)}
                  </h3>
                  <p className="text-xs font-bold text-stone-muted uppercase tracking-widest">
                    {getSessionPhone(selectedSession)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                {selectedSession.state !== 'ADMIN_TAKEOVER' ? (
                  <button 
                    onClick={() => handleTakeover(selectedSession.wa_number)}
                    className="flex items-center gap-2 px-4 py-2 bg-rose-50 text-rose-600 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-rose-100 transition-colors"
                  >
                    <AlertCircle size={14} />
                    Takeover Chat
                  </button>
                ) : (
                  <button 
                    onClick={() => handleEndSession(selectedSession.wa_number)}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-emerald-100 transition-colors"
                  >
                    <PlayCircle size={14} />
                    End Session (Auto AI)
                  </button>
                )}
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-stone-50/30">
              {(!selectedSession.data?.history || selectedSession.data.history.length === 0) ? (
                <div className="text-center text-stone-muted text-xs font-bold uppercase tracking-widest mt-10">Belum ada riwayat percakapan yang tersimpan</div>
              ) : (
                selectedSession.data.history.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[85%] sm:max-w-[70%] p-4 rounded-2xl break-words min-w-0 ${msg.role === 'user' ? 'bg-white border border-stone-200 rounded-tl-none' : 'bg-primary text-white rounded-tr-none shadow-sm'}`}>
                      <p className="text-sm whitespace-pre-wrap leading-relaxed break-words" style={{ wordBreak: 'break-word' }}>{msg.content}</p>
                    </div>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            {selectedSession.state === 'ADMIN_TAKEOVER' ? (
              <form onSubmit={handleSendMessage} className="p-4 border-t border-stone-100 bg-white">
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="Ketik balasan Anda..." 
                    disabled={sending}
                    className="flex-1 min-w-0 w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-medium text-sm"
                  />
                  <button 
                    type="submit" 
                    disabled={sending || !message.trim()}
                    className="px-4 sm:px-6 shrink-0 bg-primary text-white rounded-2xl hover:bg-primary-hover disabled:opacity-50 transition-colors flex items-center justify-center"
                  >
                    <Send size={18} />
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-4 border-t border-stone-100 bg-stone-50 text-center">
                <p className="text-xs font-bold text-stone-muted uppercase tracking-widest">
                  Klik "Takeover Chat" di atas untuk membalas secara manual.
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-stone-muted">
            <MessageCircle size={48} className="mb-4 opacity-20" />
            <p className="font-bold text-sm uppercase tracking-widest">Pilih percakapan di samping</p>
          </div>
        )}
      </div>
    </div>
  );
}
