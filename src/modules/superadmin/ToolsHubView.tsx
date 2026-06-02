import { useState, useEffect } from 'react';
import {
  Plus, RefreshCw, Edit3, CheckCircle2,
  AlertCircle, Loader2, Save, X, Settings2, Globe, Trash2
} from 'lucide-react';
import { ToolLibraryRecord } from '@/types';
import { SuperAdminService } from '@/services/firebase/SuperAdminService';
import { useUIStore } from '@/stores/uiStore';

export const ToolsHubView = () => {
  const [tools, setTools] = useState<ToolLibraryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingTool, setEditingTool] = useState<Partial<ToolLibraryRecord> | null>(null);
  const { addToast } = useUIStore();

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await SuperAdminService.listAvailableTools();
      setTools(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!editingTool?.key || !editingTool?.label) return;
    setIsSaving(true);
    try {
      await SuperAdminService.upsertTool(editingTool);
      setEditingTool(null);
      await load();
    } catch (e) {
      console.error(e);
      alert('Error al guardar herramienta');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (tool: ToolLibraryRecord) => {
    try {
      await SuperAdminService.upsertTool({ ...tool, isActive: !tool.isActive });
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  const handleCleanup = async () => {
    if (!window.confirm('¿Eliminar todas las herramientas duplicadas? Solo quedará una versión maestra de cada una.')) return;
    setIsSaving(true);
    try {
      await SuperAdminService.cleanupDuplicates();
      addToast('Limpieza de duplicados completada', 'success');
      await load();
    } catch (e) {
      console.error(e);
      addToast('Error al limpiar duplicados', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (tool: ToolLibraryRecord) => {
    if (!window.confirm(`¿Seguro que quieres eliminar "${tool.label}" permanentemente?`)) return;
    try {
      await SuperAdminService.deleteTool(tool.id);
      addToast('Herramienta eliminada', 'success');
      await load();
    } catch (e) {
      console.error(e);
      addToast('Error al eliminar', 'error');
    }
  };

  const handleEnableGlobally = async (tool: ToolLibraryRecord) => {
    if (!window.confirm(`¿Habilitar "${tool.label}" para TODOS los negocios existentes? Esta acción no se puede deshacer fácilmente.`)) return;
    setIsSaving(true);
    try {
      await SuperAdminService.enableToolGlobally(tool.key);
      addToast(`"${tool.label}" habilitada globalmente`, 'success');
    } catch (e) {
      console.error(e);
      addToast('Error al habilitar globalmente', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col md:flex-row items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">Hub de Herramientas</h1>
          <p className="text-sm text-slate-400 mt-1">Define las herramientas maestras disponibles para los negocios.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleCleanup}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-600 text-xs font-bold rounded-xl transition-colors border border-amber-200/60"
          >
            <Trash2 className="w-3.5 h-3.5" /> Limpiar Duplicados
          </button>
          <button
            onClick={async () => {
              const defaults = [
                { key: 'hasCrm',           label: 'CRM Base',             desc: 'Gestión de leads y ventas. Gratis para siempre.',                   iconName: 'Users',         color: '#10B981', isActive: true, order: 0,   price: 0,  isFree: true  },
                { key: 'hasTasks',          label: 'Gestor de Listas',     desc: 'Organiza tareas y pendientes de tu negocio de forma ágil.',          iconName: 'LayoutList',    color: '#1877F2', isActive: true, order: 0.5, price: 0,  isFree: true  },
                { key: 'hasPackages',       label: 'Paquetes Comerciales', desc: 'Agrupa ofertas para cargarlas en bloque al cotizar. Incluido.',      iconName: 'Package',       color: '#EC4899', isActive: true, order: 1,   price: 0,  isFree: true  },
                { key: 'hasMultiAgent',     label: 'WhatsApp Administrado',desc: 'CRM multi-agente con WhatsApp API oficial y 300 créditos.',          iconName: 'MessageSquare', color: '#25D366', isActive: true, order: 2,   price: 69, isFree: false },
                { key: 'hasAiAgent',        label: 'Agente IA 24/7',       desc: 'IA que responde, califica y agenda citas automáticamente.',          iconName: 'Bot',           color: '#8B5CF6', isActive: true, order: 3,   price: 49, isFree: false },
                { key: 'hasQualityAuditor', label: 'Auditor de Vendedores',desc: 'Analiza chats y detecta cierres perdidos con IA.',                  iconName: 'ShieldCheck',   color: '#F59E0B', isActive: true, order: 4,   price: 25, isFree: false },
                { key: 'hasPaymentLinks',   label: 'Links de Pago',        desc: 'Cobra por WhatsApp con tarjeta o PayPal directo.',                  iconName: 'CreditCard',    color: '#1877F2', isActive: true, order: 5,   price: 12, isFree: false },
                { key: 'hasQuotes',         label: 'Cotizaciones PDF',     desc: 'Genera cotizaciones profesionales en segundos.',                    iconName: 'FileText',      color: '#0EA5E9', isActive: true, order: 6,   price: 15, isFree: false },
                { key: 'hasCatalog',        label: 'Catálogo',             desc: 'Organiza productos, servicios y precios.',                          iconName: 'FolderClosed',  color: '#7C3AED', isActive: true, order: 7,   price: 27, isFree: false },
                { key: 'hasAgenda',         label: 'Agenda Inteligente',   desc: 'Calendario para agendar citas y recordatorios automáticos.',        iconName: 'Calendar',      color: '#10B981', isActive: true, order: 8,   price: 20, isFree: false },
              ];
              for (const t of defaults) {
                await SuperAdminService.upsertTool(t);
              }
              await load();
            }}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-xl transition-colors border border-slate-200 dark:border-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Cargar Herramientas Base
          </button>
          <button
            onClick={() => setEditingTool({ label: '', key: '', desc: '', color: '#1877F2', iconName: 'Zap', isActive: true, order: tools.length, price: 0, isFree: true })}
            className="flex items-center gap-2 px-5 py-2 bg-[#1877F2] hover:bg-blue-600 text-white text-xs font-bold rounded-xl transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Nueva Herramienta
          </button>
        </div>
      </div>

      {/* Tools grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tools.sort((a, b) => (a.order || 0) - (b.order || 0)).map(tool => (
            <div
              key={tool.id}
              className="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 hover:shadow-md transition-all"
            >
              {/* Card header */}
              <div className="flex items-start justify-between mb-4">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: `${tool.color}15`, border: `1.5px solid ${tool.color}30` }}
                >
                  <Settings2 className="w-5 h-5" style={{ color: tool.color }} />
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button
                    onClick={() => setEditingTool(tool)}
                    className="p-1.5 text-slate-400 hover:text-[#1877F2] hover:bg-[#1877F2]/10 rounded-lg transition-all"
                    title="Editar"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleToggleActive(tool)}
                    className={`p-1.5 rounded-lg transition-all ${tool.isActive ? 'text-emerald-500 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                    title={tool.isActive ? 'Desactivar' : 'Activar'}
                  >
                    {tool.isActive ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => handleEnableGlobally(tool)}
                    className="p-1.5 text-[#1877F2] hover:bg-[#1877F2]/10 rounded-lg transition-all"
                    title="Habilitar para todos"
                  >
                    <Globe className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(tool)}
                    className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition-all"
                    title="Eliminar"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Info */}
              <h3 className="text-sm font-black text-slate-900 dark:text-white mb-0.5">{tool.label}</h3>
              <p className="text-[10px] font-black text-[#1877F2] uppercase tracking-widest mb-2">{tool.key}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed mb-4">{tool.desc}</p>

              {/* Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <p className="text-[9px] text-slate-400 uppercase tracking-widest">Orden: {tool.order ?? 0}</p>
                  <p className={`text-[10px] font-black uppercase tracking-widest mt-0.5 ${tool.isFree ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {tool.isFree ? 'Gratuita' : `$${tool.price ?? 0}/mes`}
                  </p>
                </div>
                <span className={`text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest ${
                  tool.isActive
                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-200/60'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                }`}>
                  {tool.isActive ? 'Activa' : 'Inactiva'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit/Create Modal */}
      {editingTool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <h2 className="text-base font-black text-slate-900 dark:text-white">Configurar Herramienta</h2>
              <button
                onClick={() => setEditingTool(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Nombre</label>
                <input
                  type="text"
                  value={editingTool.label}
                  onChange={e => setEditingTool({ ...editingTool, label: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#1877F2]/20 focus:border-[#1877F2]/50 outline-none"
                  placeholder="Ej: CRM & Pipeline"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Identificador (Key)</label>
                  <input
                    type="text"
                    value={editingTool.key}
                    onChange={e => setEditingTool({ ...editingTool, key: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#1877F2]/20 focus:border-[#1877F2]/50 outline-none"
                    placeholder="hasCrm"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Precio (USD/mes)</label>
                  <input
                    type="number"
                    value={editingTool.price}
                    onChange={e => setEditingTool({ ...editingTool, price: Number(e.target.value), isFree: Number(e.target.value) === 0 })}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#1877F2]/20 focus:border-[#1877F2]/50 outline-none"
                    placeholder="0 = gratuita"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Descripción</label>
                <textarea
                  value={editingTool.desc}
                  onChange={e => setEditingTool({ ...editingTool, desc: e.target.value })}
                  rows={3}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#1877F2]/20 focus:border-[#1877F2]/50 outline-none resize-none"
                  placeholder="Explica qué hace esta herramienta..."
                />
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingTool.isFree}
                  onChange={e => setEditingTool({ ...editingTool, isFree: e.target.checked, price: e.target.checked ? 0 : editingTool.price || 0 })}
                  className="rounded text-[#1877F2]"
                />
                <span className="text-sm font-bold text-slate-600 dark:text-slate-300">Es gratuita</span>
              </label>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-2">
              <button
                onClick={() => setEditingTool(null)}
                className="px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-2 px-6 py-2 bg-[#1877F2] hover:bg-blue-600 text-white text-sm font-bold rounded-xl transition-all"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
