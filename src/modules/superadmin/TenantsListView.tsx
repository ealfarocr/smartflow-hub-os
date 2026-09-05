import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Users, FileText, Package, Calendar, Blocks,
  CheckCircle2, AlertCircle, Clock, MoreVertical, Building2, Loader2,
  Activity, Zap, Bot, Headset, ShieldCheck, CreditCard, LayoutList,
  Search, Filter, Trash2, Phone, RefreshCw, X, Circle
} from 'lucide-react';
import { TenantRecord, TenantFeatures } from '@/types';
import { SuperAdminService, WhatsappNumberInfo } from '@/services/firebase/SuperAdminService';
import { useAuthStore } from '@/stores/authStore';
import { CreateTenantModal } from './CreateTenantModal';
import { EditTenantModal } from './EditTenantModal';

// ─── Mapeo de features → icono + color ────────────────────
const FEATURE_ICONS: Record<keyof TenantFeatures, { icon: React.ElementType; label: string; color: string }> = {
  hasCrm:          { icon: Users,    label: 'CRM',          color: '#10B981' },
  hasQuotes:       { icon: FileText, label: 'Cotizaciones',  color: '#0EA5E9' },
  hasCatalog:      { icon: Package,  label: 'Catálogo',      color: '#EC4899' },
  hasPackages:     { icon: Package,  label: 'Paquetes',      color: '#F59E0B' },
  hasAgenda:       { icon: Calendar, label: 'Agenda',        color: '#10B981' },
  hasIntegrations: { icon: Blocks,   label: 'Integraciones', color: '#6366F1' },
  hasAiAgent:      { icon: Bot,      label: 'Agente IA',     color: '#8B5CF6' },
  hasMultiAgent:   { icon: Headset,  label: 'WhatsApp API',  color: '#25D366' },
  hasMultiAgentPanel: { icon: Headset, label: 'Multi-Agente', color: '#25D366' },
  hasQualityAuditor: { icon: ShieldCheck, label: 'Auditor IA', color: '#F59E0B' },
  hasPaymentLinks:   { icon: CreditCard, label: 'Pagos',      color: '#1877F2' },
  hasTasks:          { icon: LayoutList, label: 'Tareas',     color: '#1877F2' },
};

const STATUS_CONFIG = {
  active:    { label: 'Activo',    icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  suspended: { label: 'Suspendido', icon: AlertCircle, color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/20' },
  pending:   { label: 'Pendiente', icon: Clock,       color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20' },
};

const PLAN_COLOR: Record<string, string> = {
  starter:    'text-slate-400 bg-slate-500/10 border-slate-500/20',
  pro:        'text-blue-400 bg-blue-500/10 border-blue-500/20',
  enterprise: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
};

export const TenantsListView = () => {
  const { setActiveTenant } = useAuthStore();
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [waNumbers, setWaNumbers] = useState<Record<string, WhatsappNumberInfo>>({});
  const [isLoadingNumbers, setIsLoadingNumbers] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [editingTenant, setEditingTenant] = useState<TenantRecord | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [planFilter, setPlanFilter] = useState<'all' | 'starter' | 'pro' | 'enterprise'>('all');
  const [toolsFilter, setToolsFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'name' | 'plan' | 'date'>('name');
  // Estado mobile-only (presentación, sin lógica de negocio nueva): sheet de filtros y sheet de herramientas por tarjeta
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [toolsSheetTenant, setToolsSheetTenant] = useState<TenantRecord | null>(null);

  const navigate = useNavigate();

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await SuperAdminService.listAllTenants();
      setTenants(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const loadWhatsAppNumbers = async () => {
    setIsLoadingNumbers(true);
    try {
      const numbers = await SuperAdminService.getWhatsAppNumbers();
      setWaNumbers(numbers);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingNumbers(false);
    }
  };

  useEffect(() => {
    load();
    loadWhatsAppNumbers();
  }, []);

  const handleToggleStatus = async (tenantId: string, current: string) => {
    try {
      const next = current === 'active' ? 'suspended' : 'active';
      await SuperAdminService.setTenantStatus(tenantId, next as any);
      await load();
    } finally {
      setActionMenuId(null);
    }
  };

  const handleDelete = async (tenant: TenantRecord) => {
    const confirmed = window.confirm(
      `⚠️ ¿Eliminar "${tenant.name}" (${tenant.ownerEmail})?\n\nEsta acción borra el negocio y su configuración permanentemente. No se pueden recuperar.`
    );
    if (!confirmed) return;
    try {
      await SuperAdminService.deleteTenant(tenant.id);
      setActionMenuId(null);
      await load();
    } catch (e: any) {
      alert('Error al eliminar: ' + e.message);
    }
  };

  const handleSync = async (tenantId: string) => {
    if (!window.confirm('¿Deseas actualizar la configuración de este negocio desde el Machote? Se sobrescribirán Pipeline y Plantillas.')) return;
    setSyncingId(tenantId);
    try {
      await SuperAdminService.syncTenantFromMachote(tenantId);
      alert('Sincronización exitosa.');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSyncingId(null);
      setActionMenuId(null);
    }
  };

  const handleImpersonate = async (tenantId: string) => {
    await setActiveTenant(tenantId);
    // Forzar impersonatedName para que el botón "SALIR DEL NEGOCIO" siempre aparezca
    const tenant = tenants.find(t => t.id === tenantId);
    if (tenant && !useAuthStore.getState().impersonatedName) {
      useAuthStore.setState({ impersonatedName: tenant.name });
    }
    navigate('/dashboard');
  };

  const activeTenantsCount = tenants.filter(t => t.status === 'active').length;

  // Lógica de Filtrado y Ordenamiento
  const filteredTenants = tenants
    .filter(t => {
      const matchesSearch = t.name.toLowerCase().includes(searchTerm.toLowerCase()) || t.ownerEmail.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesPlan = planFilter === 'all' || t.plan === planFilter;
      const matchesTools = toolsFilter === 'all' || (t.features && (t.features as any)[toolsFilter]);
      return matchesSearch && matchesPlan && matchesTools;
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'plan') return a.plan.localeCompare(b.plan);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  return (
    <div className="space-y-4 md:space-y-6 bg-white dark:bg-slate-950 p-3 md:p-6 rounded-2xl md:rounded-[2.5rem] min-h-[calc(100vh-10rem)] shadow-xl shadow-blue-500/5">
      {/* ═══ Header + Filtros DESKTOP (md+) — sin cambios ═══ */}
      <div className="hidden md:flex md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-slate-100 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-black text-[#1877F2] tracking-tight">Gestión de Negocios</h1>
          <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mt-1">
            {filteredTenants.length} Negocios en Red · {activeTenantsCount} Activos
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-[#1877F2] transition-colors" />
            <input
              type="text"
              placeholder="Buscar negocio..."
              className="pl-12 pr-6 py-3 bg-slate-50 dark:bg-slate-900 border-none rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#1877F2]/20 transition-all w-64"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-[#1877F2] hover:bg-[#1877F2]/90 text-white px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-blue-500/20 active:scale-95"
          >
            <Plus className="w-4 h-4" />
            Nuevo Negocio
          </button>
        </div>
      </div>

      <div className="hidden md:flex flex-wrap items-center gap-4 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-[1.5rem] border border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2 px-3 border-r border-slate-200 dark:border-slate-700">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-[10px] font-black text-slate-500 uppercase">Filtros:</span>
        </div>

        <select
          className="bg-transparent text-[11px] font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer"
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value as any)}
        >
          <option value="all">Todos los Planes</option>
          <option value="starter">Plan Gratis / Starter</option>
          <option value="pro">Plan Pro</option>
          <option value="enterprise">Plan Enterprise</option>
        </select>

        <select
          className="bg-transparent text-[11px] font-bold text-slate-600 dark:text-slate-300 outline-none cursor-pointer"
          value={toolsFilter}
          onChange={(e) => setToolsFilter(e.target.value)}
        >
          <option value="all">Cualquier Herramienta</option>
          {Object.entries(FEATURE_ICONS).map(([key, t]) => (
            <option key={key} value={key}>{t.label}</option>
          ))}
        </select>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-slate-400 uppercase">Ordenar por:</span>
          <button
            onClick={() => setSortBy('name')}
            className={`text-[10px] font-black px-3 py-1.5 rounded-lg transition-all ${sortBy === 'name' ? 'bg-white dark:bg-slate-800 text-[#1877F2] shadow-sm shadow-blue-500/10' : 'text-slate-400'}`}
          >
            Nombre
          </button>
          <button
            onClick={() => setSortBy('plan')}
            className={`text-[10px] font-black px-3 py-1.5 rounded-lg transition-all ${sortBy === 'plan' ? 'bg-white dark:bg-slate-800 text-[#1877F2] shadow-sm shadow-blue-500/10' : 'text-slate-400'}`}
          >
            Plan
          </button>
        </div>
      </div>

      {/* ═══ Header MOBILE (< md) — compacto ═══ */}
      <div className="md:hidden pb-3 border-b border-slate-100 dark:border-slate-800">
        <h1 className="text-xl font-black text-[#1877F2] tracking-tight">Gestión de Negocios</h1>
        <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mt-0.5 mb-3">
          {filteredTenants.length} negocios · {activeTenantsCount} activos
        </p>
        <div className="relative mb-2">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar negocio..."
            className="pl-10 pr-4 py-2.5 w-full bg-slate-50 dark:bg-slate-900 border-none rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-[#1877F2]/20"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowMobileFilters(true)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300"
          >
            <Filter className="w-3.5 h-3.5" /> Filtros
            {(planFilter !== 'all' || toolsFilter !== 'all') && <span className="w-1.5 h-1.5 rounded-full bg-[#1877F2]" />}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="shrink-0 flex items-center gap-1.5 bg-[#1877F2] text-white px-3.5 py-2 rounded-xl text-xs font-black"
          >
            <Plus className="w-3.5 h-3.5" /> Nuevo
          </button>
        </div>
      </div>

      {/* ═══ Tabla DESKTOP (md+) — sin cambios ═══ */}
      <div className="hidden md:block overflow-visible">
        {isLoading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 className="w-10 h-10 text-[#1877F2] animate-spin" />
          </div>
        ) : filteredTenants.length === 0 ? (
          <div className="text-center py-32 bg-slate-50 dark:bg-slate-900/20 rounded-[2rem] border border-dashed border-slate-200 dark:border-slate-800">
             <p className="text-slate-400 font-bold">No se encontraron negocios con estos filtros.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Table Header - Mas compacto y extendido */}
            <div className="flex items-center gap-6 px-6 py-2 bg-slate-50 dark:bg-slate-900/80 rounded-xl text-[9px] font-black text-slate-400 uppercase tracking-widest border border-slate-100 dark:border-slate-800">
              <span className="flex-1">Negocio / Industria</span>
              <span className="w-44 flex items-center gap-1.5">
                Número API
                <button
                  onClick={loadWhatsAppNumbers}
                  disabled={isLoadingNumbers}
                  title="Actualizar números desde Meta"
                  className="text-slate-400 hover:text-[#25D366] transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-2.5 h-2.5 ${isLoadingNumbers ? 'animate-spin' : ''}`} />
                </button>
              </span>
              <span className="w-24">Plan</span>
              <span className="w-48 text-center">Herramientas</span>
              <span className="w-28 text-center">Estatus</span>
              <span className="w-24 text-right pr-2">Acceso</span>
            </div>

            {/* Table Rows */}
            {filteredTenants.map(tenant => {
              const status = STATUS_CONFIG[tenant.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.pending;
              const activeTools = (Object.entries(tenant.features || {}) as [keyof TenantFeatures, boolean][])
                .filter(([, v]) => v);

              return (
                <div 
                  key={tenant.id}
                  className="flex items-center gap-6 px-6 py-3 bg-white dark:bg-slate-900 border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-white/5 transition-all group"
                >
                  {/* Negocio */}
                  <div className="flex-1 flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 bg-[#1877F2]/5 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-[#1877F2]/10 transition-colors">
                      <Building2 className="w-4 h-4 text-[#1877F2]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-900 dark:text-white truncate">{tenant.name}</p>
                      <p className="text-[10px] font-bold text-slate-400 truncate uppercase tracking-tighter">{tenant.industry} · {tenant.ownerEmail}</p>
                    </div>
                  </div>

                  {/* Número API (WhatsApp) */}
                  <div className="w-44 min-w-0">
                    {(() => {
                      const wa = waNumbers[tenant.id];
                      const number = wa?.displayPhoneNumber;
                      if (isLoadingNumbers && !wa) {
                        return <span className="text-[10px] font-bold text-slate-300 dark:text-slate-600">Cargando…</span>;
                      }
                      if (number) {
                        return (
                          <div className="flex items-center gap-1.5 min-w-0" title={wa?.verifiedName || undefined}>
                            <Phone className="w-3 h-3 text-[#25D366] flex-shrink-0" />
                            <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate">{number}</span>
                            {!wa?.isActive && (
                              <span className="text-[7px] font-black text-amber-500 uppercase">inactivo</span>
                            )}
                          </div>
                        );
                      }
                      if (wa?.phoneNumberId) {
                        return (
                          <span className="text-[9px] font-bold text-slate-400 truncate" title={wa.error || 'ID interno de Meta — número no disponible'}>
                            ID: {wa.phoneNumberId}
                          </span>
                        );
                      }
                      return <span className="text-[10px] font-bold text-slate-300 dark:text-slate-600">—</span>;
                    })()}
                  </div>

                  {/* Plan */}
                  <div className="w-24">
                    <span className={`px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-wider border ${PLAN_COLOR[tenant.plan as keyof typeof PLAN_COLOR] || PLAN_COLOR.starter}`}>
                      {tenant.plan}
                    </span>
                  </div>

                  {/* Herramientas */}
                  <div className="w-48 flex items-center justify-center gap-1">
                    {activeTools.slice(0, 6).map(([key]) => {
                       const t = FEATURE_ICONS[key];
                       return t ? (
                         <div key={key} className="w-6 h-6 rounded flex items-center justify-center border border-slate-50 dark:border-slate-800 bg-white dark:bg-slate-900" title={t.label}>
                            <t.icon className="w-3 h-3" style={{ color: t.color }} />
                         </div>
                       ) : null;
                    })}
                    {activeTools.length > 6 && (
                      <span className="text-[9px] font-black text-slate-400 pl-1">+{activeTools.length - 6}</span>
                    )}
                  </div>

                  {/* Estatus */}
                  <div className="w-28 flex justify-center">
                    <span className={`inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg border ${status.bg} ${status.color}`}>
                       <div className={`w-1 h-1 rounded-full ${status.color.replace('text-', 'bg-')}`} />
                       {status.label}
                    </span>
                  </div>

                  {/* Acceso y Menú */}
                  <div className="w-24 flex items-center justify-end gap-1">
                    <button
                      onClick={() => window.open(`/enter-tenant/${tenant.id}`, '_blank')}
                      className="h-8 px-3 bg-[#1877F2] text-white hover:bg-blue-600 rounded-lg transition-all flex items-center gap-2 text-[9px] font-black uppercase tracking-widest shadow-sm active:scale-95"
                    >
                      Entrar
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setActionMenuId(actionMenuId === tenant.id ? null : tenant.id)}
                        className="p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg transition-all"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                      {actionMenuId === tenant.id && (
                        <div className="absolute right-0 bottom-full mb-1 w-40 rounded-xl border border-slate-100 dark:border-slate-800 shadow-xl z-50 py-1.5 overflow-hidden bg-white dark:bg-slate-900 animate-in fade-in zoom-in-95 duration-150">
                          <button
                            onClick={() => {
                              setEditingTenant(tenant);
                              setActionMenuId(null);
                            }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-[10px] font-bold text-slate-500 hover:text-[#1877F2] hover:bg-slate-50 transition-all text-left"
                          >
                            <Package className="w-3.5 h-3.5" />
                            Editar
                          </button>
                          <button
                            onClick={() => handleSync(tenant.id)}
                            disabled={syncingId === tenant.id}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-[10px] font-bold text-slate-500 hover:text-[#1877F2] hover:bg-slate-50 transition-all text-left"
                          >
                            <Zap className="w-3.5 h-3.5" />
                            Sincronizar
                          </button>
                          <div className="h-px bg-slate-50 dark:bg-slate-800 mx-2 my-1" />
                          <button
                            onClick={() => handleToggleStatus(tenant.id, tenant.status)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-[10px] font-bold text-rose-500 hover:bg-rose-50 transition-all text-left"
                          >
                            <Activity className="w-3.5 h-3.5" />
                            {tenant.status === 'active' ? 'Suspender' : 'Activar'}
                          </button>
                          <button
                            onClick={() => handleDelete(tenant)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-[10px] font-bold text-red-600 hover:bg-red-50 transition-all text-left"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Eliminar
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══ MOBILE BUSINESS MANAGEMENT VIEW (< md) — tarjetas verticales, mismo dataset/handlers ═══ */}
      <div className="md:hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
          </div>
        ) : filteredTenants.length === 0 ? (
          <div className="text-center py-20 bg-slate-50 dark:bg-slate-900/20 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
            <p className="text-slate-400 font-bold text-sm">No se encontraron negocios con estos filtros.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {filteredTenants.map(tenant => {
              const status = STATUS_CONFIG[tenant.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.pending;
              const activeTools = (Object.entries(tenant.features || {}) as [keyof TenantFeatures, boolean][])
                .filter(([, v]) => v);
              const wa = waNumbers[tenant.id];
              const apiLabel = wa?.displayPhoneNumber || (wa?.phoneNumberId ? `ID: ${wa.phoneNumberId}` : '—');

              return (
                <div key={tenant.id} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-900 dark:text-white uppercase truncate">{tenant.name}</p>
                      <p className="text-[10px] font-bold text-slate-400 truncate uppercase tracking-tighter">{tenant.industry}</p>
                    </div>
                    <span className={`shrink-0 inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg border ${status.bg} ${status.color}`}>
                      <div className={`w-1 h-1 rounded-full ${status.color.replace('text-', 'bg-')}`} />
                      {status.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mt-2">
                    <span className={`px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-wider border ${PLAN_COLOR[tenant.plan as keyof typeof PLAN_COLOR] || PLAN_COLOR.starter}`}>
                      {tenant.plan}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 min-w-0 truncate">
                      <Phone className="w-3 h-3 shrink-0 text-[#25D366]" />
                      {apiLabel}
                    </span>
                  </div>

                  <button
                    onClick={() => setToolsSheetTenant(tenant)}
                    className="mt-2 text-xs font-bold text-[#1877F2] dark:text-primary-400"
                  >
                    {activeTools.length} herramienta{activeTools.length !== 1 ? 's' : ''}
                  </button>

                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => window.open(`/enter-tenant/${tenant.id}`, '_blank')}
                      className="flex-1 h-10 bg-[#1877F2] text-white rounded-xl text-xs font-black uppercase tracking-widest active:scale-95 transition-all"
                    >
                      Entrar
                    </button>
                    <button
                      onClick={() => setActionMenuId(tenant.id)}
                      className="shrink-0 w-10 h-10 flex items-center justify-center text-slate-400 bg-slate-50 dark:bg-slate-800 rounded-xl"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sheet de Herramientas (mobile) — lista de solo lectura, reutiliza FEATURE_ICONS existente */}
      {toolsSheetTenant && (
        <div className="md:hidden fixed inset-0 z-[110] flex items-end" onClick={() => setToolsSheetTenant(null)}>
          <div className="absolute inset-0 bg-slate-900/50" />
          <div
            className="relative w-full max-h-[70vh] overflow-y-auto bg-white dark:bg-slate-800 rounded-t-3xl p-4 shadow-2xl animate-in slide-in-from-bottom duration-200"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-slate-300 dark:bg-slate-600 rounded-full mx-auto mb-4" />
            <div className="flex items-center justify-between mb-3 px-1">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Herramientas activas</p>
                <p className="font-bold text-sm text-slate-900 dark:text-white">{toolsSheetTenant.name}</p>
              </div>
              <button onClick={() => setToolsSheetTenant(null)} className="p-1.5 text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-0.5">
              {(Object.entries(toolsSheetTenant.features || {}) as [keyof TenantFeatures, boolean][])
                .filter(([, v]) => v)
                .map(([key]) => {
                  const t = FEATURE_ICONS[key];
                  if (!t) return null;
                  return (
                    <div key={key} className="flex items-center gap-3 px-2 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
                      <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: t.color }} />
                      <t.icon className="w-4 h-4 shrink-0" style={{ color: t.color }} />
                      {t.label}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* Sheet de acciones ⋮ (mobile) — mismos handlers que el menú desktop, sin lógica nueva */}
      {actionMenuId && (() => {
        const tenant = filteredTenants.find(t => t.id === actionMenuId);
        if (!tenant) return null;
        return (
          <div className="md:hidden fixed inset-0 z-[110] flex items-end" onClick={() => setActionMenuId(null)}>
            <div className="absolute inset-0 bg-slate-900/50" />
            <div
              className="relative w-full bg-white dark:bg-slate-800 rounded-t-3xl p-4 shadow-2xl animate-in slide-in-from-bottom duration-200"
              style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
              onClick={e => e.stopPropagation()}
            >
              <div className="w-10 h-1 bg-slate-300 dark:bg-slate-600 rounded-full mx-auto mb-4" />
              <p className="font-bold text-sm text-slate-900 dark:text-white mb-3 px-1">{tenant.name}</p>

              <button
                onClick={() => { setEditingTenant(tenant); setActionMenuId(null); }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 text-sm font-semibold text-slate-700 dark:text-slate-200"
              >
                <Package className="w-4 h-4 text-[#1877F2]" /> Editar negocio
              </button>
              <button
                onClick={() => handleSync(tenant.id)}
                disabled={syncingId === tenant.id}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 text-sm font-semibold text-slate-700 dark:text-slate-200"
              >
                <Zap className="w-4 h-4 text-slate-500" /> Sincronizar
              </button>
              <button
                onClick={() => handleToggleStatus(tenant.id, tenant.status)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-900/20 text-sm font-semibold text-rose-500"
              >
                <Activity className="w-4 h-4" /> {tenant.status === 'active' ? 'Suspender' : 'Activar'}
              </button>
              <button
                onClick={() => handleDelete(tenant)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-semibold text-red-600"
              >
                <Trash2 className="w-4 h-4" /> Eliminar
              </button>

              <button onClick={() => setActionMenuId(null)} className="w-full mt-2 py-3 text-sm font-bold text-slate-400">
                Cancelar
              </button>
            </div>
          </div>
        );
      })()}

      {/* Sheet de Filtros (mobile) — mismos setters que los <select> de desktop */}
      {showMobileFilters && (
        <div className="md:hidden fixed inset-0 z-[110] flex items-end" onClick={() => setShowMobileFilters(false)}>
          <div className="absolute inset-0 bg-slate-900/50" />
          <div
            className="relative w-full max-h-[75vh] overflow-y-auto bg-white dark:bg-slate-800 rounded-t-3xl p-4 shadow-2xl animate-in slide-in-from-bottom duration-200"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-slate-300 dark:bg-slate-600 rounded-full mx-auto mb-4" />

            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Plan</p>
            <div className="space-y-0.5 mb-3">
              {([
                ['all', 'Todos'], ['starter', 'Starter'], ['pro', 'Pro'], ['enterprise', 'Enterprise'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setPlanFilter(value)}
                  className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200"
                >
                  {planFilter === value ? <CheckCircle2 className="w-4 h-4 text-[#1877F2]" /> : <Circle className="w-4 h-4 text-slate-300" />}
                  {label}
                </button>
              ))}
            </div>

            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Herramienta</p>
            <div className="space-y-0.5 mb-3">
              <button
                onClick={() => setToolsFilter('all')}
                className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200"
              >
                {toolsFilter === 'all' ? <CheckCircle2 className="w-4 h-4 text-[#1877F2]" /> : <Circle className="w-4 h-4 text-slate-300" />}
                Todas
              </button>
              {Object.entries(FEATURE_ICONS).map(([key, t]) => (
                <button
                  key={key}
                  onClick={() => setToolsFilter(key)}
                  className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200"
                >
                  {toolsFilter === key ? <CheckCircle2 className="w-4 h-4 text-[#1877F2]" /> : <Circle className="w-4 h-4 text-slate-300" />}
                  {t.label}
                </button>
              ))}
            </div>

            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Ordenar</p>
            <div className="space-y-0.5 mb-4">
              {([['name', 'Nombre'], ['plan', 'Plan']] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setSortBy(value)}
                  className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200"
                >
                  {sortBy === value ? <CheckCircle2 className="w-4 h-4 text-[#1877F2]" /> : <Circle className="w-4 h-4 text-slate-300" />}
                  {label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowMobileFilters(false)}
              className="w-full py-3 bg-[#1877F2] text-white rounded-xl text-sm font-black uppercase tracking-widest"
            >
              Listo
            </button>
          </div>
        </div>
      )}

      {showModal && (
        <CreateTenantModal
          onClose={() => setShowModal(false)}
          onCreated={() => {
            setShowModal(false);
            load();
          }}
        />
      )}

      {editingTenant && (
        <EditTenantModal
          tenant={editingTenant}
          onClose={() => setEditingTenant(null)}
          onUpdated={() => {
            setEditingTenant(null);
            load();
          }}
        />
      )}
    </div>
  );
};
