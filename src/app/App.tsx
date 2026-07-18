import { Component, ReactNode } from 'react'
import { AppRouter } from '@/routes/AppRouter'
import { RefreshCw, AlertTriangle } from 'lucide-react'

class RootErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  state = { hasError: false, error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[RootErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="fixed inset-0 bg-slate-50 flex flex-col items-center justify-center gap-6 p-8">
        <div className="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-rose-500" />
        </div>
        <div className="text-center max-w-sm">
          <h2 className="text-lg font-black text-slate-900 mb-2">Error al cargar</h2>
          <p className="text-sm text-slate-500 mb-3">
            Limpia el caché del navegador y recarga la página.
          </p>
          {this.state.error?.message && (
            <p className="text-[11px] font-mono text-slate-400 bg-slate-100 rounded-lg px-3 py-2 break-all">
              {this.state.error.message}
            </p>
          )}
        </div>
        <button
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 px-6 py-3 bg-[#1877F2] text-white text-sm font-bold rounded-xl"
        >
          <RefreshCw className="w-4 h-4" />
          Recargar
        </button>
      </div>
    )
  }
}

function App() {
  return (
    <RootErrorBoundary>
      <AppRouter />
    </RootErrorBoundary>
  )
}

export default App
