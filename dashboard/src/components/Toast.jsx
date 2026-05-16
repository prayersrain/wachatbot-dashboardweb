import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

const VARIANTS = {
  success: { icon: CheckCircle2, bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', iconColor: 'text-emerald-500' },
  error:   { icon: XCircle, bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', iconColor: 'text-rose-500' },
  warning: { icon: AlertTriangle, bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', iconColor: 'text-amber-500' },
  info:    { icon: Info, bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700', iconColor: 'text-sky-500' },
};

export default function Toast({ id, message, type = 'info', onClose }) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const v = VARIANTS[type] || VARIANTS.info;
  const Icon = v.icon;

  useEffect(() => {
    // Trigger enter animation
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

  const handleClose = () => {
    setIsLeaving(true);
    setTimeout(() => onClose(id), 300);
  };

  return (
    <div
      className={`
        pointer-events-auto flex items-center gap-3 px-5 py-4 rounded-2xl border shadow-lg backdrop-blur-sm
        ${v.bg} ${v.border}
        transition-all duration-300 ease-out min-w-[300px] max-w-[420px]
        ${isVisible && !isLeaving ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'}
      `}
    >
      <Icon size={20} className={`${v.iconColor} shrink-0`} strokeWidth={2.5} />
      <p className={`text-sm font-semibold flex-1 ${v.text}`}>{message}</p>
      <button onClick={handleClose} className={`${v.iconColor} hover:opacity-70 transition-opacity shrink-0`}>
        <X size={16} strokeWidth={2.5} />
      </button>
    </div>
  );
}
