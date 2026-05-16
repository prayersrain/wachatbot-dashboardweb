import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-bakery-bg flex items-center justify-center p-6">
          <div className="bg-white border border-stone-200 rounded-[40px] p-12 max-w-lg w-full text-center shadow-xl">
            <div className="w-20 h-20 bg-rose-50 rounded-3xl flex items-center justify-center mx-auto mb-8">
              <AlertTriangle size={36} className="text-rose-500" strokeWidth={2.5} />
            </div>
            <h2 className="text-2xl font-black text-secondary tracking-tight mb-3">Oops, Terjadi Kesalahan</h2>
            <p className="text-stone-muted font-medium leading-relaxed mb-8">Coba muat ulang halaman.</p>
            {this.state.error && (
              <div className="bg-stone-50 border border-stone-100 rounded-2xl p-4 mb-8 text-left">
                <p className="text-[10px] font-black text-stone-muted uppercase tracking-widest mb-2">Detail Error</p>
                <p className="text-xs text-rose-500 font-mono break-all">{this.state.error.message}</p>
              </div>
            )}
            <button onClick={this.handleReload} className="bg-primary hover:bg-secondary text-white px-8 py-4 rounded-2xl font-bold transition-all inline-flex items-center gap-3 shadow-lg shadow-primary/20">
              <RefreshCw size={20} />
              Muat Ulang
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
