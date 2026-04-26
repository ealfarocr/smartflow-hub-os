import { Outlet, NavLink } from 'react-router-dom'
import { LayoutDashboard, MessageSquareText, Users, Calendar, Settings, Package, FileText, Blocks, Menu, X, LogOut } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { usePresenceTracker } from '@/hooks/usePresenceTracker'
import { ToastContainer } from '@/components/ui/Toast'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Conversaciones', href: '/conversaciones', icon: MessageSquareText },
  { name: 'CRM', href: '/crm', icon: Users },
  { name: 'Cotizaciones', href: '/cotizaciones', icon: FileText },
  { name: 'Paquetes', href: '/paquetes', icon: Package },
  { name: 'Agenda', href: '/agenda', icon: Calendar },
  { name: 'Usuarios', href: '/usuarios', icon: Users },
  { name: 'Configuración', href: '/configuracion', icon: Settings },
  { name: 'Integraciones', href: '/integraciones', icon: Blocks },
]

export const MainLayout = () => {
  const { isMobileMenuOpen, toggleMobileMenu } = useUIStore();
  const { user, logout } = useAuthStore();
  
  // Activar rastreo de presencia y actividad
  usePresenceTracker();

  const userInitials = user?.name ? user.name.substring(0, 2).toUpperCase() : 'AD';

  const handleLogout = () => {
    if (window.confirm('¿Cerrar sesión?')) {
      logout();
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-900 overflow-hidden relative">
      <ToastContainer />
      
      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 md:hidden"
          onClick={() => toggleMobileMenu(false)}
        />
      )}

      {/* Sidebar Desktop & Mobile */}
      <aside className={`fixed md:relative flex-shrink-0 w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col h-full z-50 transition-transform duration-300 ease-in-out ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <span className="text-xl font-bold text-primary-600 dark:text-primary-500">Paneles Solares MX</span>
          <button className="md:hidden text-slate-500 hover:text-slate-700" onClick={() => toggleMobileMenu(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto py-4 space-y-1 px-3 scrollbar-hide">
          {navigation.map((item) => (
            <NavLink
              key={item.name}
              to={item.href}
              onClick={() => toggleMobileMenu(false)}
              className={({ isActive }: { isActive: boolean }) =>
                `flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                  isActive
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700/50'
                }`
              }
            >
              <item.icon className="mr-3 h-5 w-5 flex-shrink-0" />
              {item.name}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col w-0 overflow-hidden">
        {/* Topbar */}
        <header className="h-16 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-4 sm:px-6 lg:px-8">
          <button className="md:hidden p-2 text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 flex items-center" onClick={() => toggleMobileMenu(true)}>
            <Menu className="h-6 w-6" />
          </button>
          <div className="flex-1 flex justify-end items-center space-x-4">
            <div className="hidden sm:flex items-center text-sm font-medium text-slate-600 dark:text-slate-400 mr-2">
               {user?.name || 'Cargando...'}
            </div>
            <div className="h-8 w-8 rounded-full bg-primary-100 dark:bg-primary-900/50 flex items-center justify-center border border-primary-200 dark:border-primary-800 cursor-pointer">
              <span className="text-sm font-medium text-primary-700 dark:text-primary-400">
                {userInitials}
              </span>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-red-500 transition-colors"
              title="Cerrar Sesión"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 relative z-0 overflow-y-auto focus:outline-none p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
