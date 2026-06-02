import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { RouteErrorBoundary } from './RouteErrorBoundary'
import { LayoutDashboard, MessageSquareText, Users, Calendar, Settings, Package, FileText, Menu, X, LogOut, LayoutGrid, Plus, Zap, Sun, Moon, Bot, ShieldCheck, CreditCard, ShoppingBag, LayoutList, Mail, GraduationCap, Handshake, FolderOpen, Sparkles, ChevronDown, ChevronRight, Headset, Blocks } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useThemeStore } from '@/stores/themeStore'
import { usePresenceTracker } from '@/hooks/usePresenceTracker'
import { ToastContainer } from '@/components/ui/Toast'
import { TenantFeatures } from '@/types'
import { CreateTenantModal } from '@/modules/superadmin/CreateTenantModal'
import SupportAgent from '../support/SupportAgent'
import { OnboardingBanner } from '../onboarding/OnboardingBanner'

const allNavItems = [
  // --- CORE SECTION ---
  { name: 'Dashboard',       href: '/dashboard',      icon: LayoutDashboard,    feature: null },
  { name: 'Mis Tareas',      href: '/tareas',          icon: LayoutList,         feature: null },
  { name: 'Inbox Admin',     href: '/admin-mail',      icon: Mail,               feature: null, superAdminOnly: true },
  { name: 'CRM',             href: '/crm',             icon: Users,              feature: null },
  { name: 'Paquetes',        href: '/paquetes',        icon: FolderOpen,         feature: null },
  { name: 'Tienda Hub',      href: '/tienda',          icon: ShoppingBag,        feature: null },
  { name: 'Usuarios',        href: '/usuarios',        icon: Users,              feature: null },
  { name: 'Configuración',   href: '/configuracion',   icon: Settings,           feature: null },
  { name: 'Academia',        href: '/academia',        icon: GraduationCap,      feature: null, superAdminOnly: true },
  { name: 'Partners',        href: '/partners',        icon: Handshake,          feature: null, superAdminOnly: true },

  // --- TOOLS SECTION ---
  { name: 'WhatsApp',        href: '/conversaciones',  icon: MessageSquareText,  feature: 'hasMultiAgent' as keyof TenantFeatures },
  { name: 'Multi-Agente',    href: '/multi-agent',     icon: Headset,            feature: 'hasMultiAgent' as keyof TenantFeatures },
  { name: 'Agente IA',       href: '/ai-agent',        icon: Bot,                feature: 'hasAiAgent' as keyof TenantFeatures },
  { name: 'Auditor IA',      href: '/auditoria',       icon: ShieldCheck,        feature: 'hasQualityAuditor' as keyof TenantFeatures },
  { name: 'Links de Pago',   href: '/pagos',           icon: CreditCard,         feature: 'hasPaymentLinks' as keyof TenantFeatures },
  { name: 'Cotizaciones',    href: '/cotizaciones',    icon: FileText,           feature: 'hasQuotes' as keyof TenantFeatures },
  { name: 'Catálogo',        href: '/catalogo',        icon: Package,            feature: 'hasCatalog' as keyof TenantFeatures },
  { name: 'Agenda',          href: '/agenda',          icon: Calendar,           feature: 'hasAgenda' as keyof TenantFeatures },
  { name: 'Integraciones',   href: '/integraciones',   icon: Blocks,             feature: 'hasIntegrations' as keyof TenantFeatures },
]


export const MainLayout = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { isMobileMenuOpen, toggleMobileMenu } = useUIStore();
  const { user, logout, activeMembership, impersonatedName, exitImpersonation } = useAuthStore();
  const { company, features, branding, subscribe: subscribeSettings } = useSettingsStore();
  const { theme, toggleTheme } = useThemeStore();

  // Suscribir settings del tenant activo (cubre impersonación, cambio de tenant, nueva pestaña)
  useEffect(() => {
    if (!activeMembership?.tenantId) return;
    const unsub = subscribeSettings(activeMembership.tenantId);
    return () => unsub();
  }, [activeMembership?.tenantId]);
  
  const isSuperAdmin = !!user?.isSuperAdmin;

  // Filtrar nav según feature flags y rol
  const navigation = allNavItems.filter(item => {
    // Inbox Admin solo visible en el Hub Master (SuperAdmin sin impersonación)
    if ((item as any).superAdminOnly) {
      return isSuperAdmin && !impersonatedName;
    }
    if (!item.feature) return true;
    // Si es SuperAdmin y NO está suplantando, ve todo (Hub Maestro)
    if (isSuperAdmin && !impersonatedName) return true;
    return !!features?.[item.feature];
  });

  const [openGroups, setOpenGroups] = useState<{ [key: string]: boolean }>({
    core: true,       // Abierto por defecto
    tools: true,      // Abierto por defecto
    marketing: true,  // Abierto por defecto
    configs: false    // Cerrado por defecto (para que no esté desordenado)
  });

  const toggleGroup = (group: string) => {
    setOpenGroups(prev => ({
      ...prev,
      [group]: !prev[group]
    }));
  };

  // 1. Herramientas Básicas (Gratuitas)
  const coreItems = navigation.filter(i => !i.feature && i.href !== '/configuracion' && !i.superAdminOnly);

  // 2. Herramientas Premium (Tools)
  const toolItems = navigation.filter(i => i.feature && !i.superAdminOnly);

  // 3. Redes Sociales (RRSS / Marketing)
  const showMarketing = isSuperAdmin && !impersonatedName;
  const marketingItems = showMarketing ? [
    { name: 'Marketing & Redes', href: '/super-admin/marketing', icon: Sparkles }
  ] : [];

  // 4. Configuración y Administración (Cerrado por defecto)
  const configItems: { name: string, href: string, icon: any }[] = [];
  if (navigation.some(i => i.href === '/configuracion')) {
    configItems.push({ name: 'Configuración', href: '/configuracion', icon: Settings });
  }
  if (isSuperAdmin && !impersonatedName) {
    configItems.push({ name: 'Inbox Admin', href: '/admin-mail', icon: Mail });
    configItems.push({ name: 'Academia', href: '/academia', icon: GraduationCap });
    configItems.push({ name: 'Partners', href: '/partners', icon: Handshake });
    configItems.push({ name: 'Gestión de Negocios', href: '/super-admin', icon: LayoutGrid });
    configItems.push({ name: 'Librería Hub', href: '/super-admin/tools', icon: Zap });
  }

  const [showCreateModal, setShowCreateModal] = useState(false);
  
  // Activar rastreo de presencia y actividad
  usePresenceTracker();

  const userInitials = user?.name ? user.name.substring(0, 2).toUpperCase() : 'AD';

  // Inyectar branding dinámico
  useEffect(() => {
    if (branding?.primaryColor) {
      document.documentElement.style.setProperty('--primary', branding.primaryColor);
    } else {
      document.documentElement.style.setProperty('--primary', '#2563eb');
    }
  }, [branding?.primaryColor]);

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
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div className="flex items-center gap-2 overflow-hidden min-w-0 flex-1">
            {user?.isSuperAdmin && !impersonatedName ? (
              <img src="/brand/logo-smartflow-blue.png" alt="SmartFlow Hub OS" className="dark:brightness-200 flex-shrink-0" style={{ width: '200px', height: '44px', objectFit: 'cover', objectPosition: 'center', maxWidth: 'none' }} />
            ) : branding?.logoUrl ? (
              <img src={branding.logoUrl} alt="Logo" className="h-10 w-auto max-w-[170px] object-contain object-left flex-shrink-0" />
            ) : (
              <div className="w-9 h-9 rounded-lg bg-primary-600 flex items-center justify-center text-white font-bold flex-shrink-0 shadow-lg shadow-primary-500/20">
                {impersonatedName?.charAt(0).toUpperCase() || activeMembership?.tenantName?.charAt(0) || company?.tradeName?.charAt(0) || 'S'}
              </div>
            )}
            {!user?.isSuperAdmin && !impersonatedName && (
              <span className="text-sm font-black text-slate-900 dark:text-white truncate tracking-tight">
                {activeMembership?.tenantName || company?.tradeName || 'SmartFlow Hub'}
              </span>
            )}
          </div>
          <button className="md:hidden text-slate-500 hover:text-slate-700 shrink-0" onClick={() => toggleMobileMenu(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <nav className="flex-1 overflow-y-auto py-2 space-y-4 px-3 scrollbar-hide">
          {/* 1. Grupo: Herramientas Gratuitas */}
          <div className="space-y-1">
            <button
              onClick={() => toggleGroup('core')}
              className="w-full flex items-center justify-between px-3 py-2.5 text-[10px] font-black text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300 uppercase tracking-widest transition-all rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40"
            >
              <span className="flex items-center gap-2">
                <LayoutDashboard className="w-4 h-4 text-slate-400" />
                Herramientas Básicas
              </span>
              {openGroups.core ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
            
            <AnimatePresence initial={false}>
              {openGroups.core && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-1 overflow-hidden"
                >
                  {coreItems.map((item) => (
                    <NavLink
                      key={item.name}
                      to={item.href}
                      onClick={() => toggleMobileMenu(false)}
                      className={({ isActive }) =>
                        `flex items-center px-4 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 group ${
                          isActive
                            ? 'bg-[#1877F2] text-white shadow-lg shadow-[#1877F2]/30'
                            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700/50'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <item.icon className={`mr-3 h-4.5 w-4.5 flex-shrink-0 transition-colors ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'}`} />
                          {item.name}
                        </>
                      )}
                    </NavLink>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 2. Grupo: Herramientas Premium (Tools) */}
          {toolItems.length > 0 && (
            <div className="space-y-1">
              <button
                onClick={() => toggleGroup('tools')}
                className="w-full flex items-center justify-between px-3 py-2.5 text-[10px] font-black text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300 uppercase tracking-widest transition-all rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <span className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-slate-400" />
                  Herramientas Premium
                </span>
                {openGroups.tools ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
              
              <AnimatePresence initial={false}>
                {openGroups.tools && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-1 overflow-hidden"
                  >
                    {toolItems.map((item) => (
                      <NavLink
                        key={item.name}
                        to={item.href}
                        onClick={() => toggleMobileMenu(false)}
                        className={({ isActive }) =>
                          `flex items-center px-4 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 group ${
                            isActive
                              ? 'bg-[#1877F2] text-white shadow-lg shadow-[#1877F2]/30'
                              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700/50'
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <item.icon className={`mr-3 h-4.5 w-4.5 flex-shrink-0 transition-colors ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'}`} />
                            {item.name}
                          </>
                        )}
                      </NavLink>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* 3. Grupo: Redes Sociales (RRSS) */}
          {marketingItems.length > 0 && (
            <div className="space-y-1">
              <button
                onClick={() => toggleGroup('marketing')}
                className="w-full flex items-center justify-between px-3 py-2.5 text-[10px] font-black text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300 uppercase tracking-widest transition-all rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-slate-400" />
                  Redes Sociales
                </span>
                {openGroups.marketing ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
              
              <AnimatePresence initial={false}>
                {openGroups.marketing && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-1 overflow-hidden"
                  >
                    {marketingItems.map((item) => (
                      <NavLink
                        key={item.name}
                        to={item.href}
                        onClick={() => toggleMobileMenu(false)}
                        className={({ isActive }) =>
                          `flex items-center px-4 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 group ${
                            isActive
                              ? 'bg-[#1877F2] text-white shadow-lg shadow-[#1877F2]/30'
                              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700/50'
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <item.icon className={`mr-3 h-4.5 w-4.5 flex-shrink-0 transition-colors ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'}`} />
                            {item.name}
                          </>
                        )}
                      </NavLink>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* 4. Grupo: Configuración y Master Hub */}
          {configItems.length > 0 && (
            <div className="space-y-1">
              <button
                onClick={() => toggleGroup('configs')}
                className="w-full flex items-center justify-between px-3 py-2.5 text-[10px] font-black text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300 uppercase tracking-widest transition-all rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <span className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-slate-400" />
                  Configuración & Admin
                </span>
                {openGroups.configs ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
              
              <AnimatePresence initial={false}>
                {openGroups.configs && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-1 overflow-hidden"
                  >
                    {configItems.map((item) => (
                      <NavLink
                        key={item.name}
                        to={item.href}
                        onClick={() => toggleMobileMenu(false)}
                        className={({ isActive }) =>
                          `flex items-center px-4 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 group ${
                            isActive
                              ? 'bg-[#1877F2] text-white shadow-lg shadow-[#1877F2]/30'
                              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700/50'
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <item.icon className={`mr-3 h-4.5 w-4.5 flex-shrink-0 transition-colors ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'}`} />
                            {item.name}
                          </>
                        )}
                      </NavLink>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </nav>

        {/* Master Action Button at the bottom */}
        {user?.isSuperAdmin && (
          <div className="p-4 border-t border-slate-100 dark:border-slate-700/50 bg-slate-50/30 dark:bg-black/10">
            {impersonatedName ? (
              <button
                onClick={async () => {
                  await exitImpersonation();
                  navigate('/super-admin');
                }}
                className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white py-4 rounded-2xl text-xs font-black transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-red-600/20 uppercase tracking-widest"
              >
                <LogOut className="w-4.5 h-4.5" />
                Salir del Negocio
              </button>
            ) : (
              <button
                onClick={() => setShowCreateModal(true)}
                className="w-full flex items-center justify-center gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 py-4 rounded-2xl text-xs font-black transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-slate-900/20 dark:shadow-white/5 uppercase tracking-widest"
              >
                <Plus className="w-4.5 h-4.5" />
                Crear Negocio
              </button>
            )}
          </div>
        )}
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
              onClick={toggleTheme}
              className="p-2 text-slate-400 hover:text-primary-500 dark:hover:text-primary-400 transition-colors"
              title={theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro'}
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
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
        <main className="flex-1 relative z-0 overflow-y-auto focus:outline-none p-0 md:p-6 lg:p-8">
          <RouteErrorBoundary key={pathname}>
            <Outlet />
          </RouteErrorBoundary>
        </main>
      </div>

      {showCreateModal && (
        <CreateTenantModal 
          onClose={() => setShowCreateModal(false)} 
          onCreated={() => {
            setShowCreateModal(false);
            // Si estamos en la lista de negocios, refrescamos los datos
            if (window.location.pathname === '/super-admin') {
              window.location.reload();
            }
          }} 
        />
      )}

      {/* Global AI Support Agent — oculto en conversaciones para no solapar el input */}
      {pathname !== '/conversaciones' && <SupportAgent />}
      
      {/* Onboarding Banner */}
      <OnboardingBanner />
    </div>
  )
}
