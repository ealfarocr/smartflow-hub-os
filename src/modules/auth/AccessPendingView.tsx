import { LogOut } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';

export const AccessPendingView = () => {
  const { logout, user } = useAuthStore();

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
       <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl flex flex-col overflow-hidden text-center p-8">
          <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-full flex items-center justify-center mx-auto mb-6">
             <span className="text-2xl font-bold">!</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Acceso Pendiente</h1>
          <p className="text-slate-500 dark:text-slate-400 mb-8">
            Hola {user?.name || 'Usuario'}. Tu cuenta se ha creado, pero aún no has sido asignado a ninguna empresa (Tenant). 
            Por favor, contacta a tu Administrador para que apruebe tu membresía.
          </p>
          <button 
             onClick={() => logout()}
             className="w-full flex justify-center items-center py-3 px-4 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
             <LogOut className="w-4 h-4 mr-2" />
             Cerrar Sesión
          </button>
       </div>
    </div>
  );
};
