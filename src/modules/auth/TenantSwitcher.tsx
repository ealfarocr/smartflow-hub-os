import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Building2, LogOut, ArrowRight } from 'lucide-react';

export const TenantSwitcher = () => {
  const { memberships, setActiveTenant, logout, user } = useAuthStore();
  const navigate = useNavigate();

  const handleSelect = (tenantId: string) => {
    setActiveTenant(tenantId);
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
       <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-xl flex flex-col overflow-hidden p-8">
          <div className="flex justify-center mb-8">
             <img src="/brand/logo-smartflow-blue.png" alt="SmartFlow Hub Logo" className="h-10 w-auto object-contain dark:brightness-200" />
          </div>
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Selecciona tu Entorno</h1>
            <p className="text-slate-500 dark:text-slate-400">
               Hola {user?.name}. Tienes acceso a múltiples empresas. Selecciona en cuál deseas operar en esta sesión.
            </p>
          </div>
          
          <div className="space-y-3 mb-8 max-h-[50vh] overflow-y-auto">
             {memberships.map(mem => (
                <button 
                  key={mem.tenantId}
                  onClick={() => handleSelect(mem.tenantId)}
                  className="w-full flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-primary-500 hover:shadow-md transition-all group text-left bg-slate-50 dark:bg-slate-800/50"
                >
                  <div className="flex items-center">
                    <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/30 text-[#1877F2] dark:text-primary-400 rounded-full flex items-center justify-center mr-4">
                       <Building2 className="w-5 h-5" />
                    </div>
                    <div>
                       <h3 className="font-bold text-slate-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                         {mem.tenantName || `Empresa ${mem.tenantId}`}
                       </h3>
                       <p className="text-xs text-slate-500 font-medium">Rol: {mem.role}</p>
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-purple-500 transition-colors" />
                </button>
             ))}
          </div>

          <button 
             onClick={() => logout()}
             className="w-full flex justify-center items-center py-3 px-4 rounded-lg text-slate-600 dark:text-slate-400 font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
             <LogOut className="w-4 h-4 mr-2" />
             Cerrar Sesión
          </button>
       </div>
    </div>
  );
};
