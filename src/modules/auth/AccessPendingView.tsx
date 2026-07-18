import { useEffect, useState } from 'react';
import { LogOut, RefreshCw } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { AuthService } from '@/services/AuthService';

export const AccessPendingView = () => {
  const { logout, user, isAuthenticated } = useAuthStore();
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);

  // Auto-check una vez al montar (cubre el race condition del registro)
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const timer = setTimeout(() => handleRetry(), 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleRetry = async () => {
    if (!user) return;
    setChecking(true);
    try {
      const mems = await AuthService.getUserMemberships(user.id);
      if (mems.length > 0) {
        window.location.href = '/dashboard';
      } else {
        setChecked(true);
      }
    } catch {
      setChecked(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl flex flex-col overflow-hidden text-center p-8">
        <div className="flex justify-center mb-8">
          <img src="/brand/logo-smartflow-blue.png" alt="SmartFlow Hub Logo" className="h-12 w-auto object-contain dark:brightness-200" />
        </div>
        <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-full flex items-center justify-center mx-auto mb-6">
          {checking ? <RefreshCw className="w-6 h-6 animate-spin" /> : <span className="text-2xl font-bold">!</span>}
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
          {checking ? 'Verificando acceso...' : 'Acceso Pendiente'}
        </h1>
        <p className="text-slate-500 dark:text-slate-400 mb-8">
          {checking
            ? 'Estamos comprobando tu membresía, un momento...'
            : `Hola ${user?.name || 'Usuario'}. Tu cuenta se ha creado, pero aún no has sido asignado a ninguna empresa. Contacta a tu Administrador para aprobar tu membresía.`
          }
        </p>
        <div className="flex flex-col gap-3">
          {checked && (
            <button
              onClick={handleRetry}
              disabled={checking}
              className="w-full flex justify-center items-center py-3 px-4 rounded-lg bg-[#1877F2] text-white font-medium hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Reintentar
            </button>
          )}
          <button
            onClick={() => logout()}
            className="w-full flex justify-center items-center py-3 px-4 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Cerrar Sesión
          </button>
        </div>
      </div>
    </div>
  );
};
