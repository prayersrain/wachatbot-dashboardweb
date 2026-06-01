import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

export default function ConfirmDialog({ 
  isOpen, 
  title = 'Konfirmasi', 
  message = 'Apakah Anda yakin?', 
  confirmLabel = 'Ya, Lanjutkan',
  cancelLabel = 'Batal',
  variant = 'danger', // 'danger' | 'success'
  onConfirm, 
  onCancel 
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCancel = () => {
    setVisible(false);
    setTimeout(onCancel, 200);
  };

  const handleConfirm = () => {
    setVisible(false);
    setTimeout(onConfirm, 200);
  };

  const isSuccess = variant === 'success';

  return createPortal(
    <div 
      className={`fixed inset-0 z-[10000] flex items-center justify-center p-4 transition-all duration-200 ${visible ? 'bg-stone-900/50 backdrop-blur-sm' : 'bg-transparent'}`}
      onClick={handleCancel}
    >
      <div 
        className={`bg-white rounded-[32px] p-8 max-w-md w-full shadow-2xl transition-all duration-300 ${visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 ${isSuccess ? 'bg-emerald-50' : 'bg-rose-50'}`}>
          <AlertTriangle size={28} className={isSuccess ? 'text-emerald-500' : 'text-rose-500'} strokeWidth={2.5} />
        </div>
        
        <h3 className="text-xl font-black text-secondary text-center tracking-tight mb-2">{title}</h3>
        <p className="text-sm text-stone-muted text-center font-medium leading-relaxed mb-8">{message}</p>
        
        <div className="flex gap-3">
          <button 
            onClick={handleCancel}
            className="flex-1 py-4 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-2xl font-bold transition-all text-sm"
          >
            {cancelLabel}
          </button>
          <button 
            onClick={handleConfirm}
            className={`flex-1 py-4 text-white rounded-2xl font-bold shadow-lg transition-all text-sm ${
              isSuccess 
                ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-200' 
                : 'bg-rose-500 hover:bg-rose-600 shadow-rose-200'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
