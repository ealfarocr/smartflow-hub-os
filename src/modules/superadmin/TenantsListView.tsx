import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Users, FileText, Package, Calendar, Blocks,
  CheckCircle2, AlertCircle, Clock, MoreVertical, Building2, Loader2,
  Activity, Zap, Bot, Headset, ShieldCheck, CreditCard, LayoutList,
  Search, Filter, Trash2
} from 'lucide-react';
import { TenantRecord, TenantFeatures } from '@/types';
import { SuperAdminService } from '@/services/firebase/SuperAdminService';
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
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [editingTenant, setEditingTenant] = useState<TenantRecord | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [planFilter, setPlanFilter] = useState<'all' | 'starter' | 'pro' | 'enterprise'>('all');
  const [toolsFilter, setToolsFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'name' | 'plan' | 'date'>('name');

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

  useEffect(() => { load(); }, []);

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
    <div className="space-y-6 bg-white dark:bg-slate-950 p-6 rounded-[2.5rem] min-h-[calc(100vh-10rem)] shadow-xl shadow-blue-500/5">
      {/* Header Compacto */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-slate-100 dark:border-slate-800">
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

      {/* Barra de Filtros Inteligentes */}
      <div className="flex flex-wrap items-center gap-4 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-[1.5rem] border border-slate-100 dark:border-slate-800">
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

      {/* Lista de Negocios (Row Layout) */}
      <div className="overflow-visible">
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
