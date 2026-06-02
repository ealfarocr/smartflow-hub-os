import { Component, ReactNode } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[RouteErrorBoundary]', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-6 p-8">
        <div className="w-16 h-16 bg-rose-50 dark:bg-rose-900/20 rounded-2xl flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-rose-500" />
        </div>
        <div className="text-center max-w-sm">
          <h2 className="text-lg font-black text-slate-900 dark:text-white mb-2">
            Algo salió mal
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">
            Hubo un error al cargar esta sección.
          </p>
          {this.state.error?.message && (
            <p className="text-[11px] font-mono text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2 mt-2 break-all">
              {this.state.error.message}
            </p>
          )}
        </div>
        <button
          onClick={this.handleRetry}
          className="flex items-center gap-2 px-6 py-3 bg-[#1877F2] text-white text-sm font-bold rounded-xl hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/20"
        >
          <RefreshCw className="w-4 h-4" />
          Reintentar
        </button>
      </div>
    );
  }
}
