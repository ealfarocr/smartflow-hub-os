import { useState, useEffect } from 'react';
import { Headset, Save, Users as UsersIcon, Shuffle, Plus, X, Mail, UserPlus, Loader2, Zap, GitBranch, UserMinus } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { MultiAgentConfig, Membership } from '@/types';
import { UserService } from '@/services/firebase/UserService';
import { isEligibleForAutoLeads, getMemberIdentifier } from '@/utils/multiAgentEligibility';

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
      const loaded = {
        isAutoDistributionEnabled: multiAgentConfig.isAutoDistributionEnabled || false,
        includedUserIds: multiAgentConfig.includedUserIds || [],
        leadEnabledUserIds: multiAgentConfig.leadEnabledUserIds ?? null,
        roundRobinCursor: multiAgentConfig.roundRobinCursor ?? null,
      };
      console.log('MULTI_AGENT_CONFIG_LOADED', loaded);
      setConfig(loaded);
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
    console.log('MULTI_AGENT_SAVE_REQUEST', { tenantId: activeMembership.tenantId, config });
    try {
      await updateSettings(activeMembership.tenantId, { multiAgentConfig: config }, activeMembership.userId || undefined);
      console.log('MULTI_AGENT_SAVE_SUCCESS', { config });
      addToast('Configuración guardada correctamente.', 'success');
    } catch (error) {
      console.error('MULTI_AGENT_SAVE_ERROR', error);
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
      const selectedMember = teamMembers.find(m => (m.userId || m.id) === selectedMemberId);
      console.log('MULTI_AGENT_ADVISOR_SELECTED', { selectedMemberId, name: selectedMember?.name, status: selectedMember?.status });
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
    console.log('MULTI_AGENT_LOCAL_STATE', newConfig);
    setConfig(newConfig);
    console.log('MULTI_AGENT_SAVE_REQUEST', { tenantId: activeMembership.tenantId, config: newConfig });
    try {
      await updateSettings(activeMembership.tenantId, { multiAgentConfig: newConfig }, activeMembership.userId || undefined);
      console.log('MULTI_AGENT_SAVE_SUCCESS', { config: newConfig });
    } catch (error) {
      console.error('MULTI_AGENT_SAVE_ERROR', error);
      addToast('Error al sincronizar configuración', 'error');
    }
  };

  // Saca a alguien del equipo configurado por completo (includedUserIds) —
  // deja de aparecer en "Equipo Asignado" y, si tenía leadEnabledUserIds
  // explícito, también se lo quita de ahí para no dejar un ID huérfano.
  const removeFromTeam = async (identifier: string) => {
    await updateConfig({
      ...config,
      includedUserIds: config.includedUserIds.filter(id => id !== identifier),
      leadEnabledUserIds: config.leadEnabledUserIds
        ? config.leadEnabledUserIds.filter(id => id !== identifier)
        : config.leadEnabledUserIds,
    });
  };

  // Prende/apaga la elegibilidad para asignación AUTOMÁTICA de un miembro
  // active — a propósito NO lo saca del equipo (ver sección 8: esto no
  // afecta la cuenta del vendedor ni su lugar en "Equipo Asignado", solo si
  // puede recibir la próxima conversación por round-robin).
  const toggleLeadEnabled = async (identifier: string) => {
    const currentlyEligible = configuredTeam
      .filter(m => isEligibleForAutoLeads(m, config))
      .map(getMemberIdentifier);
    const newSet = currentlyEligible.includes(identifier)
      ? currentlyEligible.filter(id => id !== identifier)
      : [...currentlyEligible, identifier];
    await updateConfig({ ...config, leadEnabledUserIds: newSet });
  };

  // "Equipo Asignado" muestra el equipo CONFIGURADO (includedUserIds), sin
  // importar su status — no solo los ya 'active'. El identificador guardado
  // es userId cuando existe (miembro activo) o membership.id cuando no
  // (prepared/draft/pending, donde userId es null) — así ya lo persiste el
  // código existente y así aparece hoy en producción, confirmado leyendo
  // directo el documento real de settings del tenant.
  // "Configurado en el equipo" ≠ "activo para recibir leads": un prepared
  // puede estar en el equipo (para dejar todo listo antes del lanzamiento)
  // pero solo un membership.status === 'active' cuenta como elegible, y
  // dentro de los active, "Recibe leads" (leadEnabledUserIds) puede
  // desactivar la elegibilidad para asignación AUTOMÁTICA sin tocar su cuenta.
  const teamMembers = memberships.filter(m => !m.id.startsWith('impersonated_'));
  const configuredTeam = teamMembers.filter(m => config.includedUserIds.includes(m.userId || m.id));
  const eligibleForLeads = configuredTeam.filter(m => isEligibleForAutoLeads(m, config));
  const eligibleCount = eligibleForLeads.length;
  // Vista previa del próximo turno — puramente informativa; la decisión real
  // la toma el backend (assignConversationAdvisor) dentro de una transacción,
  // esto solo replica la misma regla de orden para mostrarla en la UI.
  const eligibleIdsSorted = eligibleForLeads.map(getMemberIdentifier).sort();
  const cursorIdx = config.roundRobinCursor ? eligibleIdsSorted.indexOf(config.roundRobinCursor) : -1;
  const nextTurnIdentifier = eligibleIdsSorted.length > 0 ? eligibleIdsSorted[(cursorIdx + 1) % eligibleIdsSorted.length] : null;
  const nextTurnMember = nextTurnIdentifier ? eligibleForLeads.find(m => getMemberIdentifier(m) === nextTurnIdentifier) : null;

  const STATUS_META: Record<string, { label: string; className: string }> = {
    prepared: { label: 'Preparado', className: 'bg-violet-50 text-violet-600 dark:bg-violet-900/20 dark:text-violet-400' },
    draft: { label: 'Borrador', className: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
    pending: { label: 'Invitado', className: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400' },
    active: { label: 'Activo', className: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' },
    suspended: { label: 'Suspendido', className: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400' },
  };

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
              <span className="text-xs font-black text-[#1877F2]">{eligibleCount} elegibles</span>
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
                        Cada conversación nueva se asigna automáticamente al siguiente asesor elegible en turno (Round-Robin), decidido en el backend.
                      </p>
                      {eligibleCount === 0 ? (
                        <p className="text-[10px] font-bold text-red-500 mt-2">⚠ Sin asesores elegibles — las conversaciones nuevas quedarán sin asignar.</p>
                      ) : nextTurnMember ? (
                        <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 mt-2">Próximo turno: {nextTurnMember.name || nextTurnMember.email || 'Sin nombre'}</p>
                      ) : null}
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
                En <strong>Modo Libre</strong>: una conversación nueva sin asesor puede ser tomada por cualquier asesor elegible — el primero que la reclama gana, sin importar si tiene el panel de Multi-Agente visible.
              </li>
              <li className="text-[11px] text-amber-700/80 dark:text-amber-400/80 flex items-start gap-1.5">
                <span className="font-black mt-0.5">·</span>
                En <strong>CRM</strong>: al crear o editar un lead, seleccioná el asesor responsable.
              </li>
              <li className="text-[11px] text-amber-700/80 dark:text-amber-400/80 flex items-start gap-1.5">
                <span className="font-black mt-0.5">·</span>
                Con <strong>Distribución Automática</strong> activa, cada conversación nueva se asigna solo a quien tenga "Recibe leads" activo.
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
              <div className="col-span-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Asesor</div>
              <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Rol</div>
              <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Estado</div>
              <div className="col-span-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Recibe leads</div>
              <div className="col-span-1 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Quitar</div>
            </div>

            <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
              {configuredTeam.length === 0 && (
                <div className="py-12 text-center">
                  <UsersIcon className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm font-bold text-slate-400">Sin miembros aún</p>
                  <p className="text-xs text-slate-300 mt-1">Agregá asesores para comenzar</p>
                </div>
              )}
              {configuredTeam.map((m) => {
                const identifier = m.userId || m.id;
                const isActiveStatus = m.status === 'active';
                const statusMeta = STATUS_META[m.status] || STATUS_META.active;
                const initials = m.name ? m.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : (m.email?.charAt(0).toUpperCase() || 'U');
                const receivesLeads = isEligibleForAutoLeads(m, config);

                return (
                  <div key={m.id} className={`grid grid-cols-12 items-center px-5 py-4 transition-colors ${isActiveStatus ? 'bg-emerald-50/30 dark:bg-emerald-900/5' : 'hover:bg-slate-50 dark:hover:bg-slate-900/30'}`}>
                    <div className="col-span-4 flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black shrink-0 ${
                        isActiveStatus ? 'bg-[#1877F2] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
                      }`}>
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-900 dark:text-white truncate">{m.name || 'Sin nombre'}</p>
                        <p className="text-[10px] text-slate-400 truncate">{m.email || 'Sin correo aún'}</p>
                      </div>
                    </div>
                    <div className="col-span-2 flex justify-center">
                      <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                        m.role === 'Admin' || m.role === 'Owner'
                          ? 'bg-purple-50 text-purple-600 dark:bg-purple-900/20'
                          : 'bg-sky-50 text-sky-600 dark:bg-sky-900/20'
                      }`}>
                        {m.role}
                      </span>
                    </div>
                    <div className="col-span-2 flex justify-center">
                      <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${statusMeta.className}`}>
                        {statusMeta.label}
                      </span>
                    </div>
                    <div className="col-span-3 flex justify-end items-center gap-2">
                      {isActiveStatus ? (
                        <>
                          <span className={`text-[9px] font-black uppercase ${receivesLeads ? 'text-emerald-500' : 'text-slate-300'}`}>
                            {receivesLeads ? 'Activo' : 'Pausado'}
                          </span>
                          <button onClick={() => toggleLeadEnabled(identifier)} title="Activar/pausar elegibilidad para asignación automática"
                            className={`w-10 h-5 rounded-full relative transition-all duration-300 ${receivesLeads ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
                            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-300 ${receivesLeads ? 'left-5' : 'left-0.5'}`} />
                          </button>
                        </>
                      ) : (
                        <span className="text-[9px] font-black uppercase text-slate-300" title="Solo los miembros con acceso activo pueden recibir leads">No elegible</span>
                      )}
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <button onClick={() => removeFromTeam(identifier)} title="Quitar del equipo"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                        <UserMinus className="w-3.5 h-3.5" />
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
                    {teamMembers
                      .filter(m => !config.includedUserIds.includes(m.userId || m.id))
                      .map(m => (
                        <option key={m.id} value={m.userId || m.id}>{m.name || m.email || 'Sin nombre'} ({m.role}{m.status !== 'active' ? ` · ${STATUS_META[m.status]?.label || m.status}` : ''})</option>
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
