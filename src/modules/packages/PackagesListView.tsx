import { useEffect, useState } from 'react';
import { usePackageStore } from '@/stores/packageStore';
import { useAuthStore } from '@/stores/authStore';
import { Package } from '@/types';
import { Plus, Edit2, Archive, CheckCircle2, X, FolderOpen, Loader2, AlertCircle, Zap, Sun } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useSettingsStore } from '@/stores/settingsStore';

const CLIENT_TYPE_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  Residencial: { bg: 'bg-sky-50 dark:bg-sky-900/20',   text: 'text-sky-600',    dot: 'bg-sky-400' },
  Comercial:   { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-600', dot: 'bg-amber-400' },
  Industrial:  { bg: 'bg-violet-50 dark:bg-violet-900/20', text: 'text-violet-600', dot: 'bg-violet-400' },
};

const field = 'w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-[#1877F2]/30 rounded-xl outline-none text-sm font-medium transition-colors dark:text-white';
const label = 'text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block';

export const PackagesListView = () => {
  const { packages, addPackage, updatePackage, subscribe, isLoading, error } = usePackageStore();
  const { activeMembership } = useAuthStore();
  const { addToast } = useUIStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { commercial, subscribe: subscribeSettings } = useSettingsStore();
  const currency = commercial?.currency || 'MX';

  useEffect(() => {
    if (activeMembership?.tenantId) {
      const u1 = subscribe(activeMembership.tenantId);
      const u2 = subscribeSettings(activeMembership.tenantId);
      return () => { u1(); u2(); };
    }
  }, [activeMembership?.tenantId, subscribe, subscribeSettings]);

  const emptyForm: Partial<Package> = {
    name: '', clientType: 'Residencial', powerKw: 0,
    panelsCount: 0, inverter: '', savingsEstimado: 0,
    price: 0, description: '', isActive: true,
  };
  const [formData, setFormData] = useState<Partial<Package>>(emptyForm);

  const handleOpenModal = (pkg?: Package) => {
    setEditingId(pkg?.id ?? null);
    setFormData(pkg ?? emptyForm);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) { addToast('El nombre no puede estar vacío', 'error'); return; }
    try {
      if (editingId) {
        await updatePackage(editingId, { ...formData, name: formData.name.trim() });
        addToast('Paquete actualizado', 'success');
      } else {
        if (!activeMembership?.tenantId) { addToast('Sin tenant activo', 'error'); return; }
        await addPackage({ ...(formData as Omit<Package, 'id'>), name: formData.name.trim(), tenantId: activeMembership.tenantId });
        addToast('Paquete creado', 'success');
      }
      setIsModalOpen(false);
    } catch (err: any) {
      addToast(err.message || 'Error al guardar', 'error');
    }
  };

  const handleToggleActive = (id: string, current: boolean) => {
    if (window.confirm(`¿${current ? 'Archivar' : 'Reactivar'} este paquete?`)) {
      updatePackage(id, { isActive: !current });
      addToast(`Paquete ${current ? 'archivado' : 'reactivado'}`, 'info');
    }
  };

  const activeCount = packages.filter(p => p.isActive).length;

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16">

      {/* Header */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 px-6 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1877F2]/10 flex items-center justify-center">
              <FolderOpen className="w-5 h-5 text-[#1877F2]" />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900 dark:text-white">Paquetes Comerciales</h1>
              <p className="text-xs text-slate-400 font-medium">Combos listos para cargar en cotizaciones</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {packages.length > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/10 rounded-xl">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-xs font-black text-emerald-600">{activeCount} activos</span>
              </div>
            )}
            <button onClick={() => handleOpenModal()}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#1877F2] hover:bg-blue-600 text-white text-xs font-black rounded-xl shadow-sm shadow-[#1877F2]/20 transition-all">
              <Plus className="w-3.5 h-3.5" /> Nuevo paquete
            </button>
          </div>
        </div>
      </div>

      {/* Info strip */}
      <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/20 rounded-2xl px-5 py-3 flex items-center gap-3">
        <Zap className="w-4 h-4 text-amber-500 shrink-0" />
        <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
          Los paquetes se cargan automáticamente al crear cotizaciones. Al seleccionar uno, se pre-llenan todos los campos de la propuesta.
        </p>
      </div>

      {/* Cards grid */}
      {isLoading ? (
        <div className="py-20 flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin mb-3" />
          <p className="text-sm text-slate-400 font-medium">Cargando paquetes...</p>
        </div>
      ) : error ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-red-100 dark:border-red-900/30 py-16 text-center">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
          <p className="text-sm font-black text-slate-700 dark:text-slate-300 mb-1">Error al cargar</p>
          <p className="text-xs text-slate-400 mb-5">{error.includes('index') ? 'Falta un índice en la base de datos.' : error}</p>
          <button onClick={() => window.location.reload()}
            className="px-5 py-2 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-xl text-xs font-black">
            Reintentar
          </button>
        </div>
      ) : packages.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border-2 border-dashed border-slate-200 dark:border-slate-700 py-20 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-50 dark:bg-slate-900 flex items-center justify-center mb-4">
            <FolderOpen className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-base font-black text-slate-700 dark:text-slate-300 mb-1">Sin paquetes aún</h3>
          <p className="text-sm text-slate-400 max-w-xs mb-6">Creá tu primer paquete y aparecerá disponible al generar cotizaciones.</p>
          <button onClick={() => handleOpenModal()}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#1877F2] hover:bg-blue-600 text-white text-xs font-black rounded-xl transition-colors">
            <Plus className="w-3.5 h-3.5" /> Crear primer paquete
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {packages.map((pkg) => {
            const typeStyle = CLIENT_TYPE_STYLES[pkg.clientType] || CLIENT_TYPE_STYLES.Residencial;
            return (
              <div key={pkg.id} className={`bg-white dark:bg-slate-800 rounded-2xl shadow-sm border dark:border-slate-700 overflow-hidden flex flex-col transition-all hover:shadow-md ${
                pkg.isActive ? 'border-slate-100' : 'border-slate-100 opacity-60'
              }`}>

                {/* Card top accent */}
                <div className={`h-1 w-full ${typeStyle.dot}`} />

                <div className="p-5 flex-1 flex flex-col">
                  {/* Header row */}
                  <div className="flex items-start justify-between mb-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest ${typeStyle.bg} ${typeStyle.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${typeStyle.dot}`} />
                      {pkg.clientType}
                    </span>
                    <span className={`flex items-center gap-1 text-[10px] font-black ${pkg.isActive ? 'text-emerald-500' : 'text-slate-400'}`}>
                      {pkg.isActive ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                      {pkg.isActive ? 'Activo' : 'Archivado'}
                    </span>
                  </div>

                  {/* Name + desc */}
                  <h3 className="text-base font-black text-slate-900 dark:text-white mb-1">{pkg.name}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed mb-4 line-clamp-2">{pkg.description}</p>

                  {/* Specs */}
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-2.5 text-center">
                      <Sun className="w-3.5 h-3.5 text-amber-400 mx-auto mb-1" />
                      <p className="text-[10px] text-slate-400 font-bold">Potencia</p>
                      <p className="text-xs font-black text-slate-700 dark:text-slate-300">{pkg.powerKw} kW</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-2.5 text-center">
                      <div className="w-3.5 h-3.5 bg-[#1877F2]/20 rounded mx-auto mb-1 flex items-center justify-center">
                        <span className="text-[7px] font-black text-[#1877F2]">⬛</span>
                      </div>
                      <p className="text-[10px] text-slate-400 font-bold">Paneles</p>
                      <p className="text-xs font-black text-slate-700 dark:text-slate-300">{pkg.panelsCount} uds</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-2.5 text-center">
                      <Zap className="w-3.5 h-3.5 text-violet-400 mx-auto mb-1" />
                      <p className="text-[10px] text-slate-400 font-bold">Inversor</p>
                      <p className="text-[9px] font-black text-slate-700 dark:text-slate-300 truncate">{pkg.inverter || '—'}</p>
                    </div>
                  </div>

                  {/* Price + savings */}
                  <div className="mt-auto pt-4 border-t border-slate-100 dark:border-slate-700 flex items-end justify-between">
                    <div>
                      <p className="text-xl font-black text-[#1877F2] dark:text-blue-400">
                        ${pkg.price.toLocaleString('es-MX')} <span className="text-xs font-bold text-slate-400">{currency}</span>
                      </p>
                      <p className="text-[10px] text-emerald-600 font-bold mt-0.5">
                        Ahorro ~${pkg.savingsEstimado.toLocaleString('es-MX')} {currency}/bim
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleToggleActive(pkg.id, pkg.isActive)}
                        className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 transition-colors" title={pkg.isActive ? 'Archivar' : 'Reactivar'}>
                        <Archive className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleOpenModal(pkg)}
                        className="p-2 rounded-xl hover:bg-[#1877F2]/10 text-[#1877F2] transition-colors" title="Editar">
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col max-h-[90vh] overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#1877F2]/10 flex items-center justify-center">
                  <FolderOpen className="w-4 h-4 text-[#1877F2]" />
                </div>
                <h3 className="font-black text-slate-900 dark:text-white">{editingId ? 'Editar Paquete' : 'Nuevo Paquete'}</h3>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <form id="pkg-form" onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className={label}>Nombre del paquete</label>
                  <input required type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className={field} placeholder="Ej: Paquete Solar 5kW Residencial" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={label}>Tipo de cliente</label>
                    <select value={formData.clientType} onChange={e => setFormData({ ...formData, clientType: e.target.value as any })} className={field}>
                      <option>Residencial</option>
                      <option>Comercial</option>
                      <option>Industrial</option>
                    </select>
                  </div>
                  <div>
                    <label className={label}>Precio ({currency})</label>
                    <input required type="number" min="0" value={formData.price} onChange={e => setFormData({ ...formData, price: Number(e.target.value) })} className={field} />
                  </div>
                  <div>
                    <label className={label}>Potencia (kW)</label>
                    <input required step="0.1" type="number" min="0" value={formData.powerKw} onChange={e => setFormData({ ...formData, powerKw: Number(e.target.value) })} className={field} />
                  </div>
                  <div>
                    <label className={label}>Cantidad de paneles</label>
                    <input required type="number" min="0" value={formData.panelsCount} onChange={e => setFormData({ ...formData, panelsCount: Number(e.target.value) })} className={field} />
                  </div>
                  <div className="col-span-2">
                    <label className={label}>Modelo inversor / microinversor</label>
                    <input required type="text" value={formData.inverter} onChange={e => setFormData({ ...formData, inverter: e.target.value })} className={field} placeholder="Ej: SolarEdge SE5000H" />
                  </div>
                  <div className="col-span-2">
                    <label className={label}>Ahorro bimestral estimado ({currency})</label>
                    <input required type="number" min="0" value={formData.savingsEstimado} onChange={e => setFormData({ ...formData, savingsEstimado: Number(e.target.value) })} className={field} />
                  </div>
                  <div className="col-span-2">
                    <label className={label}>Descripción corta</label>
                    <textarea required value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} className={`${field} h-20 resize-none`} placeholder="Descripción breve del paquete..." />
                  </div>
                  <div className="col-span-2">
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <div
                        onClick={() => setFormData({ ...formData, isActive: !formData.isActive })}
                        className={`w-10 h-5 rounded-full relative transition-all duration-300 ${formData.isActive ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-300 ${formData.isActive ? 'left-5' : 'left-0.5'}`} />
                      </div>
                      <span className="text-xs font-black text-slate-600 dark:text-slate-400">
                        Paquete activo {formData.isActive ? '(visible en cotizaciones)' : '(archivado)'}
                      </span>
                    </label>
                  </div>
                </div>
              </form>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex gap-3 shrink-0">
              <button type="button" onClick={() => setIsModalOpen(false)}
                className="flex-1 py-3 rounded-xl text-xs font-black text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                Cancelar
              </button>
              <button type="submit" form="pkg-form"
                className="flex-1 py-3 bg-[#1877F2] hover:bg-blue-600 text-white rounded-xl text-xs font-black shadow-sm shadow-[#1877F2]/20 transition-all">
                {editingId ? 'Guardar cambios' : 'Crear paquete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
