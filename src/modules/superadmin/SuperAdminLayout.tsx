import { Outlet, NavLink } from 'react-router-dom';
import { LayoutGrid, LogOut, Zap, Sun, Moon, Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';

export const SuperAdminLayout = () => {
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();

  const handleLogout = () => {
    if (window.confirm('¿Cerrar sesión?')) logout();
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground transition-colors duration-300">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 flex flex-col border-r border-border bg-card transition-colors duration-300">
        {/* Brand */}
        <div className="h-16 flex items-center gap-3 px-5 border-b border-border">
          <img src="/brand/logo-smartflow-blue.png" alt="SmartFlow Hub Logo" className="h-7 w-auto object-contain dark:brightness-200" />
          <div className="leading-tight">
            <p className="text-purple-600 dark:text-purple-400 text-[10px] font-semibold uppercase tracking-widest">Super Admin</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          <NavLink
            to="/super-admin"
            end
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-purple-600/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5'
              }`
            }
          >
            <LayoutGrid className="w-4 h-4" />
            Negocios
          </NavLink>

          <NavLink
            to="/super-admin/tools"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-purple-600/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5'
              }`
            }
          >
            <Zap className="w-4 h-4" />
            Librería de Herramientas
          </NavLink>
        </nav>

        {/* Action Button at the bottom as per user sketch */}
        <div className="p-3 mt-auto">
          <NavLink
            to="/super-admin"
            className="w-full flex items-center justify-center gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 py-4 rounded-2xl text-sm font-black transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl"
          >
            <Plus className="w-5 h-5" />
            Crear Negocio
          </NavLink>
        </div>

        {/* User footer */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/50 border border-purple-200 dark:border-purple-700/50 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-purple-600 dark:text-purple-300">
                {user?.name?.substring(0, 2).toUpperCase() || 'SA'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate text-foreground">{user?.name || 'Super Admin'}</p>
              <p className="text-slate-500 dark:text-slate-500 text-[10px] truncate">{user?.email}</p>
            </div>
            <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        <header className="h-16 flex items-center justify-between px-8 border-b border-border bg-card/50 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 px-3 py-1 rounded-full uppercase tracking-tight">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500 dark:bg-purple-400 animate-pulse" />
              Super Admin Mode
            </span>
          </div>
          <button
            onClick={toggleTheme}
            className="p-2.5 rounded-xl border border-border bg-card hover:bg-slate-50 dark:hover:bg-white/5 text-slate-500 dark:text-slate-400 transition-all shadow-sm"
            title={theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro'}
          >
            {theme === 'dark' ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
          </button>
        </header>
        <main className="flex-1 overflow-y-auto p-8">
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};
