import { useState, useEffect } from 'react';
import { Headset, Save, Users as UsersIcon, Shuffle, Plus, X, Mail, UserPlus, Loader2, Zap, GitBranch } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { MultiAgentConfig, Membership } from '@/types';
import { UserService } from '@/services/firebase/UserService';

export const MultiAgentView = () => {
  const { activeMembership, user } = useAuthStore();
  const { multiAgentConfig, updateSettings } = useSettingsStore();
  const { addToast } = useUIStore();

  const [isSaving, setIsSaving] = useState(false);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [config, setConfig] = useState<MultiAgentConfig>({
    isAutoDistributionEnabled: false,
    includedUserIds: [],
  });

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addMethod, setAddMethod] = useState<'invite' | 'existing'>('invite');
  const [isInviting, setIsInviting] = useState(false);
  const [newAsesor, setNewAsesor] = useState({ name: '', email: '' });
  const [selectedMemberId, setSelectedMemberId] = useState('');

  useEffect(() => {
    if (multiAgentConfig) {
      setConfig({
        isAutoDistributionEnabled: multiAgentConfig.isAutoDistributionEnabled || false,
        includedUserIds: multiAgentConfig.includedUserIds || [],
      });
    }
  }, [multiAgentConfig]);

  useEffect(() => {
    if (activeMembership?.tenantId) {
      const unsubscribe = UserService.subscribeToTenantMemberships(activeMembership.tenantId, setMemberships);
      return () => unsubscribe();
    }
  }, [activeMembership?.tenantId]);

  const handleSave = async () => {
    if (!activeMembership?.tenantId) return;
    setIsSaving(true);
    try {
      await updateSettings(activeMembership.tenantId, { multiAgentConfig: config }, activeMembership.userId || undefined);
      addToast('Configuración guardada correctamente.', 'success');
    } catch {
      addToast('Error al guardar configuración.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddAsesor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMembership?.tenantId || !user?.id) return;

    if (addMethod === 'invite') {
      if (!newAsesor.name || !newAsesor.email) { addToast('Nombre y correo son obligatorios', 'warning'); return; }
      setIsInviting(true);
      try {
        await UserService.inviteUser(activeMembership.tenantId, newAsesor.email, newAsesor.name, 'Asesor Comercial', user.id);
        addToast('Asesor invitado correctamente.', 'success');
        setIsAddModalOpen(false);
        setNewAsesor({ name: '', email: '' });
      } catch (error: any) {
        addToast(error.message || 'Error al invitar asesor', 'error');
      } finally {
        setIsInviting(false);
      }
    } else {
      if (!selectedMemberId) { addToast('Selecciona un miembro del equipo', 'warning'); return; }
      if (!config.includedUserIds.includes(selectedMemberId)) {
        await updateConfig({ ...config, includedUserIds: [...config.includedUserIds, selectedMemberId] });
        addToast('Miembro agregado al equipo', 'success');
      } else {
        addToast('Este miembro ya está en el equipo', 'info');
      }
      setIsAddModalOpen(false);
      setSelectedMemberId('');
    }
  };

  const updateConfig = async (newConfig: MultiAgentConfig) => {
    if (!activeMembership?.tenantId) return;
    setConfig(newConfig);
    try {
      await updateSettings(activeMembership.tenantId, { multiAgentConfig: newConfig }, activeMembership.userId || undefined);
    } catch {
      addToast('Error al sincronizar configuración', 'error');
    }
  };

  const toggleUserInclusion = async (userId: string) => {
    const isIncluded = config.includedUserIds.includes(userId);
    await updateConfig({
      ...config,
      includedUserIds: isIncluded
        ? config.includedUserIds.filter(id => id !== userId)
        : [...config.includedUserIds, userId],
    });
  };

  const activeMembers = memberships.filter(m => !m.id.startsWith('impersonated_') && m.status === 'active');
  const activeCount = activeMembers.filter(m => config.includedUserIds.includes(m.userId || m.id)).length;

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-16">

      {/* Header */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 px-6 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1877F2]/10 flex items-center justify-center">
              <Headset className="w-5 h-5 text-[#1877F2]" />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900 dark:text-white">Multi-Agente</h1>
              <p className="text-xs text-slate-400 font-medium">Asignación de conversaciones al equipo</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1877F2]/8 rounded-xl">
              <UsersIcon className="w-3.5 h-3.5 text-[#1877F2]" />
              <span className="text-xs font-black text-[#1877F2]">{activeCount} activos</span>
            </div>
            <button onClick={handleSave} disabled={isSaving}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#1877F2] hover:bg-blue-600 text-white text-xs font-black rounded-xl shadow-sm shadow-[#1877F2]/20 transition-all disabled:opacity-50">
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Guardar
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Modo de Operación */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2.5">
              <Shuffle className="w-4 h-4 text-slate-400" />
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">Modo de Operación</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Reglas de asignación</p>
              </div>
            </div>
            <div className="p-4 space-y-4">

              {/* Toggle visual switch */}
              <div className="relative bg-slate-100 dark:bg-slate-900 rounded-2xl p-1 flex">
                {/* Sliding pill */}
                <div className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-xl transition-all duration-300 shadow-sm ${
                  config.isAutoDistributionEnabled
                    ? 'left-[calc(50%+0px)] bg-emerald-500'
                    : 'left-1 bg-[#1877F2]'
                }`} />
                <button
                  onClick={() => updateConfig({ ...config, isAutoDistributionEnabled: false })}
                  className="relative z-10 flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl transition-colors"
                >
                  <UsersIcon className={`w-3.5 h-3.5 transition-colors ${!config.isAutoDistributionEnabled ? 'text-white' : 'text-slate-400'}`} />
                  <span className={`text-xs font-black transition-colors ${!config.isAutoDistributionEnabled ? 'text-white' : 'text-slate-400'}`}>
                    Libre
                  </span>
                </button>
                <button
                  onClick={() => updateConfig({ ...config, isAutoDistributionEnabled: true })}
                  className="relative z-10 flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl transition-colors"
                >
                  <GitBranch className={`w-3.5 h-3.5 transition-colors ${config.isAutoDistributionEnabled ? 'text-white' : 'text-slate-400'}`} />
                  <span className={`text-xs font-black transition-colors ${config.isAutoDistributionEnabled ? 'text-white' : 'text-slate-400'}`}>
                    Automático
                  </span>
                </button>
              </div>

              {/* Description of selected mode */}
              <div className={`p-4 rounded-2xl border transition-all ${
                config.isAutoDistributionEnabled
                  ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-100 dark:border-emerald-800/20'
                  : 'bg-[#1877F2]/5 border-[#1877F2]/10'
              }`}>
                {config.isAutoDistributionEnabled ? (
                  <div className="flex items-start gap-3">
                    <GitBranch className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-black text-emerald-700 dark:text-emerald-400 mb-1">Distribución Automática</p>
                      <p className="text-[11px] text-emerald-700/70 dark:text-emerald-400/70 leading-relaxed">
                        Cada lead nuevo se asigna automáticamente al siguiente asesor activo en turno (Round-Robin).
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <UsersIcon className="w-5 h-5 text-[#1877F2] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-black text-[#1877F2] mb-1">Contestación Libre</p>
                      <p className="text-[11px] text-[#1877F2]/70 leading-relaxed">
                        Todos los asesores ven los mensajes y deciden manualmente quién atiende cada conversación.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Info card */}
          <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/20 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-black text-amber-700 dark:text-amber-400">¿Cómo funciona?</span>
            </div>
            <ul className="space-y-1.5">
              <li className="text-[11px] text-amber-700/80 dark:text-amber-400/80 flex items-start gap-1.5">
                <span className="font-black mt-0.5">·</span>
                En <strong>Conversaciones</strong>: usá el selector de agente en el encabezado del chat para asignar manualmente.
              </li>
              <li className="text-[11px] text-amber-700/80 dark:text-amber-400/80 flex items-start gap-1.5">
                <span className="font-black mt-0.5">·</span>
                En <strong>CRM</strong>: al crear o editar un lead, seleccioná el asesor responsable.
              </li>
              <li className="text-[11px] text-amber-700/80 dark:text-amber-400/80 flex items-start gap-1.5">
                <span className="font-black mt-0.5">·</span>
                Con <strong>Distribución Automática</strong> activa, cada lead nuevo se asigna solo al siguiente asesor del turno.
              </li>
            </ul>
          </div>
        </div>

        {/* Equipo */}
        <div className="lg:col-span-8">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <UsersIcon className="w-4 h-4 text-slate-400" />
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">Equipo Asignado</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Quién recibe leads de WhatsApp</p>
                </div>
              </div>
              <button onClick={() => setIsAddModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#1877F2]/8 hover:bg-[#1877F2]/15 text-[#1877F2] text-xs font-black rounded-xl transition-colors">
                <Plus className="w-3.5 h-3.5" /> Agregar asesor
              </button>
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-12 px-5 py-2.5 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700">
              <div className="col-span-6 text-[9px] font-black text-slate-400 uppercase tracking-widest">Asesor</div>
              <div className="col-span-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Rol</div>
              <div className="col-span-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Recibe leads</div>
            </div>

            <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
              {activeMembers.length === 0 && (
                <div className="py-12 text-center">
                  <UsersIcon className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm font-bold text-slate-400">Sin miembros aún</p>
                  <p className="text-xs text-slate-300 mt-1">Agregá asesores para comenzar</p>
                </div>
              )}
              {activeMembers.map((m) => {
                const identifier = m.userId || m.id;
                const isIncluded = config.includedUserIds.includes(identifier);
                const initials = m.name ? m.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : (m.email?.charAt(0).toUpperCase() || 'U');

                return (
                  <div key={m.id} className={`grid grid-cols-12 items-center px-5 py-4 transition-colors ${isIncluded ? 'bg-emerald-50/30 dark:bg-emerald-900/5' : 'hover:bg-slate-50 dark:hover:bg-slate-900/30'}`}>
                    <div className="col-span-6 flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black shrink-0 ${
                        isIncluded ? 'bg-[#1877F2] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
                      }`}>
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-900 dark:text-white truncate">{m.name || 'Sin nombre'}</p>
                        <p className="text-[10px] text-slate-400 truncate">{m.email}</p>
                      </div>
                    </div>
                    <div className="col-span-3 flex justify-center">
                      <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                        m.role === 'Admin' || m.role === 'Owner'
                          ? 'bg-purple-50 text-purple-600 dark:bg-purple-900/20'
                          : 'bg-sky-50 text-sky-600 dark:bg-sky-900/20'
                      }`}>
                        {m.role}
                      </span>
                    </div>
                    <div className="col-span-3 flex justify-end items-center gap-2">
                      <span className={`text-[9px] font-black uppercase ${isIncluded ? 'text-emerald-500' : 'text-slate-300'}`}>
                        {isIncluded ? 'Activo' : 'Inactivo'}
                      </span>
                      <button onClick={() => toggleUserInclusion(identifier)}
                        className={`w-10 h-5 rounded-full relative transition-all duration-300 ${isIncluded ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-300 ${isIncluded ? 'left-5' : 'left-0.5'}`} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Modal Agregar Asesor */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#1877F2]/10 flex items-center justify-center">
                  <UserPlus className="w-4 h-4 text-[#1877F2]" />
                </div>
                <h3 className="font-black text-slate-900 dark:text-white">Nuevo Asesor</h3>
              </div>
              <button onClick={() => setIsAddModalOpen(false)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <div className="px-6 pt-4">
              <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl">
                <button onClick={() => setAddMethod('invite')}
                  className={`flex-1 py-2 rounded-lg text-xs font-black transition-all ${addMethod === 'invite' ? 'bg-white dark:bg-slate-800 text-[#1877F2] shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                  Invitar nuevo
                </button>
                <button onClick={() => setAddMethod('existing')}
                  className={`flex-1 py-2 rounded-lg text-xs font-black transition-all ${addMethod === 'existing' ? 'bg-white dark:bg-slate-800 text-[#1877F2] shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                  Del equipo
                </button>
              </div>
            </div>

            <form onSubmit={handleAddAsesor} className="p-6 space-y-4">
              {addMethod === 'invite' ? (
                <>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nombre completo</label>
                    <input type="text" required placeholder="Ej: Juan Pérez" value={newAsesor.name}
                      onChange={e => setNewAsesor({ ...newAsesor, name: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-[#1877F2]/30 rounded-xl outline-none text-sm font-medium transition-colors" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Correo electrónico</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                      <input type="email" required placeholder="correo@ejemplo.com" value={newAsesor.email}
                        onChange={e => setNewAsesor({ ...newAsesor, email: e.target.value })}
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-[#1877F2]/30 rounded-xl outline-none text-sm font-medium transition-colors" />
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Seleccionar miembro</label>
                  <select required value={selectedMemberId} onChange={e => setSelectedMemberId(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-[#1877F2]/30 rounded-xl outline-none text-sm font-medium transition-colors appearance-none">
                    <option value="">Seleccioná un integrante...</option>
                    {memberships
                      .filter(m => !config.includedUserIds.includes(m.userId || m.id))
                      .map(m => (
                        <option key={m.id} value={m.userId || m.id}>{m.name || m.email} ({m.role})</option>
                      ))}
                  </select>
                  <p className="text-[10px] text-slate-400">Solo aparecen miembros que aún no están en el equipo.</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 py-3 rounded-xl font-black text-xs text-slate-500 hover:bg-slate-100 transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={isInviting}
                  className="flex-1 py-3 bg-[#1877F2] hover:bg-blue-600 text-white rounded-xl font-black text-xs shadow-sm shadow-[#1877F2]/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {isInviting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  {isInviting ? 'Procesando...' : (addMethod === 'invite' ? 'Invitar' : 'Asignar')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
