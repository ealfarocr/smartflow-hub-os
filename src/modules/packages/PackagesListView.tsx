import { useEffect, useState } from 'react';
import { usePackageStore } from '@/stores/packageStore';
import { useAuthStore } from '@/stores/authStore';
import { Package } from '@/types';
import { Plus, Edit2, Archive, CheckCircle2, X, FolderOpen, Loader2, AlertCircle } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useSettingsStore } from '@/stores/settingsStore';

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
      const unsubscribePackages = subscribe(activeMembership.tenantId);
      const unsubscribeSettings = subscribeSettings(activeMembership.tenantId);
      return () => {
        unsubscribePackages();
        unsubscribeSettings();
      };
    }
  }, [activeMembership?.tenantId, subscribe, subscribeSettings]);

  // Form State
  const [formData, setFormData] = useState<Partial<Package>>({
    name: '',
    clientType: 'Residencial',
    powerKw: 0,
    panelsCount: 0,
    inverter: '',
    savingsEstimado: 0,
    price: 0,
    description: '',
    isActive: true,
  });

  const handleOpenModal = (pkg?: Package) => {
    if (pkg) {
      setEditingId(pkg.id);
      setFormData(pkg);
    } else {
      setEditingId(null);
      setFormData({
        name: '',
        clientType: 'Residencial',
        powerKw: 0,
        panelsCount: 0,
        inverter: '',
        savingsEstimado: 0,
        price: 0,
        description: '',
        isActive: true,
      });
    }
    setIsModalOpen(true);
  };

    const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof formData.name === 'string' && formData.name.trim() === '') {
       addToast('El nombre del paquete no puede estar vacío', 'error');
       return;
    }
    
    try {
      if (editingId) {
        await updatePackage(editingId, { ...formData, name: formData.name?.trim() || '' });
        addToast('Paquete actualizado', 'success');
      } else {
        if (!activeMembership?.tenantId) {
          addToast('No se detectó un Tenant activo', 'error');
          return;
        }

        await addPackage({
          ...(formData as Omit<Package, 'id'>),
          name: formData.name?.trim() || '',
          tenantId: activeMembership.tenantId,
        });
        addToast('Paquete creado exitosamente', 'success');
      }
      setIsModalOpen(false);
    } catch (error: any) {
      console.error('Error saving package:', error);
      addToast(error.message || 'Error al guardar el paquete. Revisa tus permisos.', 'error');
    }
  };

  const handleToggleActive = (id: string, currentStatus: boolean) => {
    const action = currentStatus ? 'archivar' : 'reactivar';
    if (window.confirm(`¿Estás seguro de que deseas ${action} este paquete comercial?`)) {
      updatePackage(id, { isActive: !currentStatus });
      addToast(`Paquete ${currentStatus ? 'archivado' : 'reactivado'} correctamente`, 'info');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Paquetes Comerciales</h1>
        <button
          onClick={() => handleOpenModal()}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center"
        >
          <Plus className="h-4 w-4 mr-2" />
          Nuevo Paquete
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="col-span-full py-20 flex flex-col items-center justify-center text-slate-500">
             <Loader2 className="w-10 h-10 animate-spin text-primary-500 mb-4" />
             <p className="font-medium animate-pulse">Sincronizando con la nube...</p>
          </div>
        ) : error ? (
          <div className="col-span-full py-20 text-center bg-white dark:bg-slate-800 rounded-xl border border-red-100 dark:border-red-900/30">
            <div className="flex flex-col items-center justify-center p-6">
              <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-full mb-4">
                <AlertCircle className="w-10 h-10 text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Error de Catálogo</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-6">
                {error.includes('index') 
                  ? 'Falta un índice para organizar los paquetes comerciales.' 
                  : error}
              </p>
              <button 
                onClick={() => window.location.reload()}
                className="bg-slate-900 dark:bg-white dark:text-slate-900 text-white px-6 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity"
              >
                Reintentar
              </button>
            </div>
          </div>
        ) : packages.length === 0 ? (
          <div className="col-span-full py-20 text-center bg-white dark:bg-slate-800 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
             <div className="flex flex-col items-center justify-center text-slate-500 dark:text-slate-400">
               <div className="bg-slate-100 dark:bg-slate-900/50 p-4 rounded-full mb-4">
                 <FolderOpen className="w-8 h-8 text-slate-400" />
               </div>
               <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-1">Sin Paquetes</h3>
               <p className="text-sm max-w-sm mb-4">Aún no se han configurado paquetes comerciales base. Crea el primero para poder generar cotizaciones rápidas.</p>
               <button onClick={() => handleOpenModal()} className="text-primary-600 font-medium hover:text-primary-700 flex items-center">
                 <Plus className="w-4 h-4 mr-1" /> Crear nuevo paquete
               </button>
             </div>
          </div>
        ) : (
        packages.map((pkg) => (
          <div key={pkg.id} className="glass rounded-xl p-6 relative flex flex-col justify-between transition-all hover:shadow-lg dark:hover:shadow-primary-900/10">
            <div>
              <div className="flex justify-between items-start mb-4">
                <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${pkg.clientType === 'Residencial' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'}`}>
                  {pkg.clientType}
                </span>
                <span className={`flex items-center text-xs font-medium ${pkg.isActive ? 'text-emerald-600' : 'text-slate-500'}`}>
                  {pkg.isActive ? <CheckCircle2 className="w-4 h-4 mr-1" /> : <Archive className="w-4 h-4 mr-1" />}
                  {pkg.isActive ? 'Activo' : 'Archivado'}
                </span>
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{pkg.name}</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm mb-6 line-clamp-2">{pkg.description}</p>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <p className="text-xs text-slate-400 font-medium">Potencia</p>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{pkg.powerKw} kW</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium">Paneles</p>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{pkg.panelsCount} uds</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-slate-400 font-medium">Inversor</p>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{pkg.inverter}</p>
                </div>
              </div>
            </div>
            
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-primary-600 dark:text-primary-400">
                  ${pkg.price.toLocaleString('es-MX')} {currency}
                </p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1">
                  Ahorro est: ${pkg.savingsEstimado.toLocaleString('es-MX')} {currency}/bim
                </p>
              </div>
              <div className="flex space-x-2">
                <button onClick={() => handleToggleActive(pkg.id, pkg.isActive)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                  <Archive className="h-5 w-5" />
                </button>
                <button onClick={() => handleOpenModal(pkg)} className="p-2 text-primary-500 hover:text-primary-700 transition-colors">
                  <Edit2 className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        ))
        )}
      </div>

      {/* Modal Form */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {editingId ? 'Editar Paquete' : 'Nuevo Paquete'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X className="h-6 w-6" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto">
              <form id="package-form" onSubmit={handleSave} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nombre del Paquete</label>
                    <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo de Cliente</label>
                    <select value={formData.clientType} onChange={e => setFormData({...formData, clientType: e.target.value as any})} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-primary-500">
                      <option>Residencial</option>
                      <option>Comercial</option>
                      <option>Industrial</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Precio ({currency})</label>
                    <input required type="number" value={formData.price} onChange={e => setFormData({...formData, price: Number(e.target.value)})} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Potencia (kW)</label>
                    <input required step="0.1" type="number" value={formData.powerKw} onChange={e => setFormData({...formData, powerKw: Number(e.target.value)})} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cantidad de Paneles</label>
                    <input required type="number" value={formData.panelsCount} onChange={e => setFormData({...formData, panelsCount: Number(e.target.value)})} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Modelo Inversor/Microinversor</label>
                    <input required type="text" value={formData.inverter} onChange={e => setFormData({...formData, inverter: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Ahorro Bimestral Estimado ({currency})</label>
                    <input required type="number" value={formData.savingsEstimado} onChange={e => setFormData({...formData, savingsEstimado: Number(e.target.value)})} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descripción corta</label>
                    <textarea required value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-primary-500 h-24 resize-none" />
                  </div>
                  <div className="col-span-2 flex items-center">
                    <input id="isActive" type="checkbox" checked={formData.isActive} onChange={e => setFormData({...formData, isActive: e.target.checked})} className="w-4 h-4 text-primary-600 bg-slate-100 border-slate-300 rounded focus:ring-primary-500" />
                    <label htmlFor="isActive" className="ml-2 text-sm font-medium text-slate-700 dark:text-slate-300">Paquete Activo Plegable</label>
                  </div>
                </div>
              </form>
            </div>
            
            <div className="p-6 border-t border-slate-100 dark:border-slate-800 shrink-0 flex justify-end gap-3 bg-slate-50 dark:bg-slate-900/50">
              <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                Cancelar
              </button>
              <button type="submit" form="package-form" className="px-5 py-2.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors shadow-lg shadow-primary-500/30">
                Guardar Paquete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
