import { useEffect, useState } from 'react';
import { useUserStore } from '@/stores/userStore';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { User, Role } from '@/types';
import { Plus, Edit2, UserX, UserCheck, Search, Filter, Loader2, Link as LinkIcon, Send, Mail, Crown, ShieldCheck, Wrench, Eye, KeyRound, Smartphone, type LucideIcon } from 'lucide-react';
import { ALL_TOOL_KEYS, TOOL_LABELS, ADMIN_ONLY_TOOLS, TOOL_PRESETS, getEffectiveTools, getDefaultToolsForRole, ToolKey } from '@/utils/permissions';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { DeviceManagerModal } from './DeviceManagerModal';
import { VendorAccessModal, VendorAccessData } from './VendorAccessModal';

export const UsersManagementView = () => {
  const { teamMembers, presenceMap, workSessionMap, updateMemberRole, updateMemberStatus, createDraftMember, sendInvitation, createPreparedMember, convertPreparedToDraft, updateAllowedTools, subscribe, isLoading } = useUserStore();
  const { activeMembership } = useAuthStore();
  const { addToast } = useUIStore();

  useEffect(() => {
    if (activeMembership?.tenantId) {
      const unsubscribe = subscribe(activeMembership.tenantId);
      return () => unsubscribe();
    }
  }, [activeMembership?.tenantId, subscribe]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deviceModalUser, setDeviceModalUser] = useState<{ userId: string; name: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<Role | 'All'>('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Control de herramientas: customizeTools=false → usar el fallback por rol
  // (allowedTools:null); true → lista explícita en selectedTools. Se
  // inicializa en handleOpenModal con lo que ESE miembro ya tiene
  // efectivamente, para que el admin vea el estado real antes de tocar nada.
  const [customizeTools, setCustomizeTools] = useState(false);
  const [selectedTools, setSelectedTools] = useState<ToolKey[]>([]);
  const editingMember = editingId ? teamMembers.find(m => m.id === editingId) : null;
  // Un usuario no puede habilitarse herramientas a sí mismo (además de que la
  // regla de Firestore de memberships ya exige isTenantAdmin para escribir,
  // esto evita que un Admin se auto-edite desde esta misma pantalla).
  const isEditingSelf = !!editingMember && !!activeMembership && editingMember.id === activeMembership.id;

  const [formData, setFormData] = useState<Partial<User>>({
    name: '',
    email: '',
    role: 'Asesor Comercial',
    isActive: true,
  });

  const handleOpenModal = (member: any) => {
    setEditingId(member.id);
    setFormData({
      id: member.userId,
      name: member.name,
      email: member.email,
      role: member.role,
      isActive: member.isActive,
    });
    setCustomizeTools(member.allowedTools != null);
    setSelectedTools(getEffectiveTools({ role: member.role, allowedTools: member.allowedTools }));
    setIsModalOpen(true);
  };

  const applyPreset = (preset: keyof typeof TOOL_PRESETS) => {
    setCustomizeTools(true);
    setSelectedTools([...TOOL_PRESETS[preset]]);
  };

  const toggleTool = (tool: ToolKey) => {
    setSelectedTools(prev => prev.includes(tool) ? prev.filter(t => t !== tool) : [...prev, tool]);
  };

  const toggleStatus = async (id: string, currentStatus: boolean, userName: string) => {
    const action = currentStatus ? 'desactivar' : 'reactivar';
    if (window.confirm(`¿Estás seguro de que deseas ${action} el acceso de ${userName}?`)) {
      try {
        await updateMemberStatus(id, !currentStatus);
        addToast(`Acceso ${currentStatus ? 'desactivado' : 'reactivado'} correctamente`, 'info');
      } catch (error) {
        addToast('Error al cambiar el estado del usuario', 'error');
      }
    }
  };

  // Convierte un 'draft' preparado en invitación real (pending + invitedAt) —
  // recién acá el email queda habilitado para registrarse.
  const [sendingInviteId, setSendingInviteId] = useState<string | null>(null);
  const handleSendInvitation = async (id: string, email: string) => {
    setSendingInviteId(id);
    try {
      await sendInvitation(id);
      alert(`¡Invitación enviada!\n\nComparte este enlace con el usuario:\nhttps://hub.smartflow-suite.com\n\nDebe ingresar con el correo: ${email}`);
      addToast('Invitación enviada', 'success');
    } catch {
      addToast('Error al enviar la invitación', 'error');
    } finally {
      setSendingInviteId(null);
    }
  };

  // Acceso por PIN (LOOP dispositivo confiable) — alternativa a email+invitación
  // para vendedores que no necesitan/quieren un Gmail propio. Funciona sobre
  // 'prepared' o 'draft': el backend (setVendorPin) crea la cuenta técnica de
  // Firebase Auth y deja la membership en 'pending' lista para el primer
  // acceso por PIN — mismo destino final ('active') que el flujo por correo,
  // solo cambia cómo llega ahí.
  const [generatingPinId, setGeneratingPinId] = useState<string | null>(null);
  const [vendorAccess, setVendorAccess] = useState<VendorAccessData | null>(null);
  const handleGeneratePin = async (id: string, name: string, tenantId: string) => {
    if (!window.confirm(`¿Generar PIN de acceso para ${name}?\n\nSi ya tiene uno, se reemplaza por uno nuevo.`)) return;
    setGeneratingPinId(id);
    try {
      // Checkpoint de seguridad: el backend devuelve loginHandle (usuario
      // público, ej. "michelle"), nunca el membershipId — es lo único que
      // el link de enrolamiento y el propio vendedor van a conocer.
      const setVendorPin = httpsCallable<{ membershipId: string }, { pin: string; tenantId: string; loginHandle: string }>(getFunctions(), 'setVendorPin');
      const result = await setVendorPin({ membershipId: id });
      const { pin, loginHandle } = result.data;
      const link = `https://hub.smartflow-suite.com/acceso?h=${encodeURIComponent(loginHandle)}&t=${tenantId}&n=${encodeURIComponent(name)}`;
      // FIX UX URGENTE: antes esto era un alert() — texto no seleccionable
      // de forma práctica, sin botones de copiar. VendorAccessModal deja
      // copiar enlace/PIN/mensaje completo para mandarlo por WhatsApp.
      setVendorAccess({ name, loginHandle, pin, link });
      addToast('PIN generado', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al generar el PIN';
      addToast(message, 'error');
    } finally {
      setGeneratingPinId(null);
    }
  };

  // Convierte un 'prepared' (solo nombre/rol, sin correo) en 'draft' cuando
  // el admin por fin tiene el email — UserService valida formato y duplicados.
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const handleAddEmail = async (id: string, name: string) => {
    const email = window.prompt(`Correo de ${name}:`);
    if (!email) return; // cancelado
    if (!activeMembership?.tenantId) return;
    setConvertingId(id);
    try {
      await convertPreparedToDraft(id, activeMembership.tenantId, email);
      addToast('Correo agregado — listo para enviar la invitación', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Error al agregar el correo', 'error');
    } finally {
      setConvertingId(null);
    }
  };

  const filteredUsers = teamMembers.filter((m) => {
    const matchesRole = filterRole === 'All' || m.role === filterRole;
    const matchesSearch = m.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          m.email.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesRole && matchesSearch;
  });

  // Identidad visual por nivel jerárquico — puramente presentacional, no
  // implica ningún permiso: RoleGuard/ToolGuard siguen siendo el enforcement
  // real, independiente de estos colores/íconos.
  const ROLE_META: Record<Role, { badge: string; icon: LucideIcon; chipClass: string; borderClass: string; ringClass?: string }> = {
    Owner: {
      badge: 'OWNER / SOCIO PRINCIPAL',
      icon: Crown,
      chipClass: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
      borderClass: 'border-l-green-500',
      ringClass: 'ring-2 ring-green-400/50 ring-offset-2 ring-offset-white dark:ring-offset-slate-900',
    },
    Admin: {
      badge: 'ADMIN',
      icon: ShieldCheck,
      chipClass: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
      borderClass: 'border-l-orange-500',
    },
    'Asesor Comercial': {
      badge: 'ASESOR COMERCIAL',
      icon: UserCheck,
      chipClass: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
      borderClass: 'border-l-purple-500',
    },
    Técnico: {
      badge: 'TÉCNICO',
      icon: Wrench,
      chipClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
      borderClass: 'border-l-blue-400',
    },
    'Solo lectura': {
      badge: 'SOLO LECTURA',
      icon: Eye,
      chipClass: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
      borderClass: 'border-l-slate-400',
    },
  };

  // Orden de bloques fijo (Socios > Administración > Comercial > Otros);
  // "Otros" solo aparece si hay Técnico/Solo lectura en el tenant.
  const ROLE_GROUPS: { key: string; title: string; roles: Role[] }[] = [
    { key: 'owners', title: 'Socios / Owners', roles: ['Owner'] },
    { key: 'admin', title: 'Administración', roles: ['Admin'] },
    { key: 'comercial', title: 'Equipo Comercial', roles: ['Asesor Comercial'] },
    { key: 'otros', title: 'Otros', roles: ['Técnico', 'Solo lectura'] },
  ];

  type Row = typeof filteredUsers[number];

  // Agrupa por jerarquía y ordena alfabéticamente dentro de cada grupo —
  // solo afecta el orden de despliegue, no los datos ni quién entra en
  // filteredUsers (búsqueda/filtro de rol siguen aplicando antes de esto).
  const groupedSections = ROLE_GROUPS
    .map(group => ({
      ...group,
      members: filteredUsers.filter(m => group.roles.includes(m.role)).slice().sort((a, b) => a.name.localeCompare(b.name, 'es')),
    }))
    .filter(group => group.members.length > 0);

  const avatarStatusClasses = (status: string) =>
    status === 'prepared'
      ? 'bg-violet-50 border-violet-200 text-violet-500 dark:bg-violet-900/20 dark:border-violet-800'
      : status === 'draft'
      ? 'bg-slate-100 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700'
      : status === 'pending'
      ? 'bg-amber-50 border-amber-200 text-amber-600 dark:bg-amber-900/20 dark:border-amber-800'
      : 'bg-primary-50 border-primary-200 text-primary-700 dark:bg-primary-900/50 dark:border-primary-800 dark:text-primary-400';

  const renderLifecycleBadge = (u: Row) => (
    <>
      {u.status === 'prepared' && <span className="ml-2 text-[9px] px-1.5 py-0.5 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 rounded-full font-bold uppercase tracking-tighter">Preparado</span>}
      {u.status === 'draft' && <span className="ml-2 text-[9px] px-1.5 py-0.5 bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300 rounded-full font-bold uppercase tracking-tighter">Borrador</span>}
      {u.status === 'pending' && <span className="ml-2 text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full font-bold uppercase tracking-tighter">Invitado</span>}
    </>
  );

  const renderPresence = (u: Row) => {
    const p = presenceMap[u.userId];
    const isOnline = p?.status === 'online';
    const isIdle = p?.status === 'idle';
    return (
      <>
        <div className="relative">
          <div className={`h-3 w-3 rounded-full border-2 border-white dark:border-slate-800 ${
            isOnline ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
            isIdle ? 'bg-amber-500' : 'bg-slate-400'
          }`} />
          {isOnline && <div className="absolute inset-0 h-3 w-3 rounded-full bg-emerald-500 animate-ping opacity-40" />}
        </div>
        <span className="text-[10px] mt-1 font-bold uppercase tracking-tighter text-slate-500">
          {isOnline ? 'En línea' : isIdle ? 'Ausente' : 'Offline'}
        </span>
      </>
    );
  };

  // LOOP Fase 10 — estado operativo (independiente de online/idle/offline,
  // ver Fase 18: "conectado" no es lo mismo que "disponible para leads").
  const OPERATIONAL_META: Record<string, { label: string; dot: string }> = {
    working: { label: 'Trabajando', dot: 'bg-emerald-500' },
    coffee: { label: 'Café / Pausa', dot: 'bg-amber-400' },
    lunch: { label: 'Almuerzo', dot: 'bg-orange-500' },
    errand: { label: 'Diligencia', dot: 'bg-blue-500' },
    off_shift: { label: 'Fuera de turno', dot: 'bg-red-500' },
  };
  const formatDuration = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    if (h === 0 && m === 0) return '< 1m';
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  const renderOperationalStatus = (u: Row) => {
    const opStatus = presenceMap[u.userId]?.operationalStatus || 'off_shift';
    const meta = OPERATIONAL_META[opStatus];
    const session = workSessionMap[u.userId];
    const connectedSeconds = (session?.activeSeconds || 0) + (session?.idleSeconds || 0);
    return (
      <div className="flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
          <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
        {session && (
          <span className="text-[10px] text-slate-400 font-medium">
            Conectado {formatDuration(connectedSeconds)} · Activo {formatDuration(session.activeSeconds || 0)}
          </span>
        )}
      </div>
    );
  };

  const renderRoleChip = (role: Role) => {
    const meta = ROLE_META[role];
    const Icon = meta.icon;
    return (
      <span className={`px-2.5 py-1 text-[11px] font-bold rounded-lg inline-flex items-center gap-1 w-max uppercase tracking-tight ${meta.chipClass}`}>
        <Icon className="w-3 h-3" />
        {meta.badge}
      </span>
    );
  };

  const renderStatusBadge = (u: Row) => (
    <div className="flex flex-col gap-1">
      <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-tight w-max ${
        u.status === 'active'
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
          : u.status === 'pending'
          ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
          : u.status === 'draft'
          ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
          : u.status === 'prepared'
          ? 'bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400'
          : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
      }`}>
        {u.status === 'active' ? 'Acceso Activo' : u.status === 'pending' ? 'Pendiente' : u.status === 'draft' ? 'Borrador' : u.status === 'prepared' ? 'Preparado' : 'Suspendido'}
      </span>
      {presenceMap[u.userId] && (
        <span className="text-[10px] text-slate-400 font-medium ml-1">
          Vía: {presenceMap[u.userId].authProvider === 'google.com' ? 'Google SSO' : 'Email/Password'}
        </span>
      )}
    </div>
  );

  const renderLastActivity = (u: Row) => {
    const p = presenceMap[u.userId];
    if (!p || u.status === 'pending') {
      return <span className="text-slate-400 text-xs italic">Sin actividad registrada</span>;
    }
    const lastActive = new Date(p.lastActiveAt);
    return (
      <div className="flex flex-col">
        <span className="text-slate-700 dark:text-slate-200 text-xs font-semibold">
          {formatLastSeen(lastActive)}
        </span>
        <span className="text-[10px] text-[#1877F2] dark:text-primary-400 font-bold truncate max-w-[150px]">
          📍 {p.currentRoute}
        </span>
      </div>
    );
  };

  const renderActions = (u: Row) => (
    <div className="flex justify-end gap-1">
      {u.status === 'prepared' ? (
        <button
          onClick={() => handleAddEmail(u.id, u.name)}
          disabled={convertingId === u.id}
          className="text-slate-400 hover:text-violet-600 p-2 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50 disabled:opacity-40"
          title="Agregar email"
        >
          {convertingId === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
        </button>
      ) : u.status === 'draft' ? (
        <button
          onClick={() => handleSendInvitation(u.id, u.email)}
          disabled={sendingInviteId === u.id}
          className="text-slate-400 hover:text-emerald-600 p-2 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50 disabled:opacity-40"
          title="Enviar invitación"
        >
          {sendingInviteId === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      ) : (
        <button
          onClick={() => {
            navigator.clipboard.writeText('https://hub.smartflow-suite.com');
            addToast('Enlace de invitación copiado', 'success');
          }}
          className="text-slate-400 hover:text-[#1877F2] p-2 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50"
          title="Copiar enlace de invitación"
        >
          <LinkIcon className="w-4 h-4" />
        </button>
      )}
      {(u.status === 'prepared' || u.status === 'draft') && activeMembership?.tenantId && (
        <button
          onClick={() => handleGeneratePin(u.id, u.name, activeMembership.tenantId)}
          disabled={generatingPinId === u.id}
          className="text-slate-400 hover:text-amber-600 p-2 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50 disabled:opacity-40"
          title="Generar PIN de acceso (sin email)"
        >
          {generatingPinId === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
        </button>
      )}
      {u.status !== 'draft' && u.status !== 'prepared' && (
        <button onClick={() => toggleStatus(u.id, u.isActive, u.name)} className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 p-2 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50" title={u.isActive ? 'Desactivar / Suspender' : 'Reactivar'}>
          {u.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
        </button>
      )}
      {u.status === 'active' && u.userId && (
        <button
          onClick={() => setDeviceModalUser({ userId: u.userId, name: u.name })}
          className="text-slate-400 hover:text-[#1877F2] p-2 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50"
          title="Ver dispositivos"
        >
          <Smartphone className="w-4 h-4" />
        </button>
      )}
      <button onClick={() => handleOpenModal(u)} className="text-slate-400 hover:text-[#1877F2] p-2 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50" title="Editar">
        <Edit2 className="w-4 h-4" />
      </button>
    </div>
  );

  const renderGroupHeaderLabel = (group: { title: string; members: Row[] }) => (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{group.title}</span>
      <span className="text-[11px] font-bold text-slate-400">· {group.members.length}</span>
      <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Gestión de Usuarios</h1>
        <button
          onClick={() => {
            setEditingId(null);
            setFormData({ name: '', email: '', role: 'Asesor Comercial', isActive: true });
            setCustomizeTools(false);
            setSelectedTools([]);
            setIsModalOpen(true);
          }}
          className="bg-[#1877F2] hover:bg-[#166fe5] text-white px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center shadow-lg shadow-[#1877F2]/20"
        >
          <Plus className="h-4 w-4 mr-2" />
          Nuevo Usuario
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col h-full min-h-[500px]">
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex flex-wrap gap-4 items-center bg-slate-50 dark:bg-slate-900/50">
           <div className="relative flex-1 min-w-[250px]">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
             <input type="text" placeholder="Buscar por nombre o correo..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm bg-white dark:bg-slate-900 focus:ring-2 focus:ring-primary-500" />
           </div>
           <div className="flex items-center space-x-2">
             <Filter className="w-4 h-4 text-slate-400" />
             <select value={filterRole} onChange={(e) => setFilterRole(e.target.value as Role | 'All')} className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-900">
                <option value="All">Todos los roles</option>
                <option value="Owner">Owner</option>
                <option value="Admin">Admin</option>
                <option value="Asesor Comercial">Asesor Comercial</option>
                <option value="Técnico">Técnico</option>
                <option value="Solo lectura">Solo lectura</option>
             </select>
           </div>
        </div>

        {/* Desktop: tabla agrupada por jerarquía */}
        <div className="hidden md:block overflow-x-auto selection:bg-primary-100 dark:selection:bg-primary-900/30">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-100 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 uppercase text-[10px] font-black tracking-widest text-slate-600 dark:text-slate-400">
              <tr>
                <th className="px-6 py-4 font-bold">Usuario</th>
                <th className="px-6 py-4 font-bold text-center">Presencia</th>
                <th className="px-6 py-4 font-bold">Estado / Turno</th>
                <th className="px-6 py-4 font-bold">Rol de Acceso</th>
                <th className="px-6 py-4 font-bold">Seguridad / Acceso</th>
                <th className="px-6 py-4 font-bold">Última Actividad / Ubicación</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center text-slate-500">
                      <Loader2 className="w-8 h-8 animate-spin text-[#1877F2] mb-2" />
                      <p className="animate-pulse font-medium">Sincronizando equipo...</p>
                    </div>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500 italic">No se encontraron usuarios en este tenant.</td>
                </tr>
              ) : (
                groupedSections.flatMap((group, gi) => [
                  <tr key={`head-${group.key}`} className={`bg-slate-50/80 dark:bg-slate-900/40 ${gi > 0 ? 'border-t-4 border-transparent' : ''}`}>
                    <td colSpan={6} className="px-6 pt-5 pb-2">
                      {renderGroupHeaderLabel(group)}
                    </td>
                  </tr>,
                  ...group.members.map((u) => {
                    const meta = ROLE_META[u.role];
                    return (
                      <tr key={u.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-l-[3px] ${meta.borderClass}`}>
                        <td className="px-6 py-4">
                          <div className="flex items-center">
                            <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold mr-3 border ${avatarStatusClasses(u.status)} ${meta.ringClass || ''}`}>
                              {u.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-semibold text-slate-900 dark:text-white flex items-center">
                                {u.name}
                                {renderLifecycleBadge(u)}
                              </div>
                              <div className="text-slate-500 text-xs">{u.email || 'Sin correo aún'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col items-center">
                            {renderPresence(u)}
                          </div>
                        </td>
                        <td className="px-6 py-4">{u.status === 'active' ? renderOperationalStatus(u) : <span className="text-slate-300 text-xs">—</span>}</td>
                        <td className="px-6 py-4">{renderRoleChip(u.role)}</td>
                        <td className="px-6 py-4">{renderStatusBadge(u)}</td>
                        <td className="px-6 py-4">{renderLastActivity(u)}</td>
                        <td className="px-6 py-4 text-right">{renderActions(u)}</td>
                      </tr>
                    );
                  }),
                ])
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile: tarjetas apiladas por grupo, sin scroll horizontal */}
        <div className="md:hidden">
          {isLoading ? (
            <div className="px-6 py-12 text-center">
              <div className="flex flex-col items-center justify-center text-slate-500">
                <Loader2 className="w-8 h-8 animate-spin text-[#1877F2] mb-2" />
                <p className="animate-pulse font-medium">Sincronizando equipo...</p>
              </div>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="px-6 py-12 text-center text-slate-500 italic">No se encontraron usuarios en este tenant.</div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              {groupedSections.map(group => (
                <div key={group.key} className="py-4 bg-slate-50/40 dark:bg-slate-900/20">
                  <div className="px-4 pb-3">{renderGroupHeaderLabel(group)}</div>
                  <div className="px-4 space-y-3">
                    {group.members.map(u => {
                      const meta = ROLE_META[u.role];
                      return (
                        <div key={u.id} className={`rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3 border-l-[3px] ${meta.borderClass}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center font-bold border ${avatarStatusClasses(u.status)} ${meta.ringClass || ''}`}>
                                {u.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-900 dark:text-white flex items-center flex-wrap gap-1">
                                  <span className="truncate">{u.name}</span>
                                  {renderLifecycleBadge(u)}
                                </div>
                                <div className="text-slate-500 text-xs truncate">{u.email || 'Sin correo aún'}</div>
                              </div>
                            </div>
                            <div className="flex flex-col items-center shrink-0">
                              {renderPresence(u)}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {renderRoleChip(u.role)}
                            {renderStatusBadge(u)}
                          </div>
                          {u.status === 'active' && <div>{renderOperationalStatus(u)}</div>}
                          <div>{renderLastActivity(u)}</div>
                          <div className="flex justify-end gap-1 pt-2 border-t border-slate-100 dark:border-slate-800">
                            {renderActions(u)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-800">
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">{editingId ? 'Editar Miembro' : 'Nuevo Usuario'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-bold text-xl">&times;</button>
            </div>
            <div className="p-6 bg-white dark:bg-slate-900">
              <form id="user-form" onSubmit={async (e) => {
                e.preventDefault();
                setIsSaving(true);
                try {
                  const { activeMembership, user: creator } = useAuthStore.getState();
                  if (!activeMembership || !creator) return;

                  if (editingId) {
                    // Un 'draft'/'prepared' no tiene concepto de activo/suspendido todavía —
                    // tocar updateMemberStatus acá lo sacaría de ese estado sin querer (por
                    // ejemplo, al editar solo el nombre antes de tener el correo o de enviar
                    // la invitación).
                    const tasks = [updateMemberRole(editingId, formData.role as Role)];
                    if (editingMember?.status !== 'draft' && editingMember?.status !== 'prepared') {
                      tasks.push(updateMemberStatus(editingId, !!formData.isActive));
                    }
                    // Un usuario no puede habilitarse herramientas a sí mismo — la sección
                    // ni siquiera se muestra en ese caso, pero se guarda igual como última
                    // barrera antes de escribir.
                    if (!isEditingSelf) {
                      tasks.push(updateAllowedTools(editingId, customizeTools ? selectedTools : null));
                    }
                    await Promise.all(tasks);
                    addToast('Miembro actualizado', 'success');
                  } else {
                    const trimmedEmail = (formData.email || '').trim();
                    if (trimmedEmail) {
                      // Guarda como borrador: NO envía invitación, NO muestra enlace,
                      // NO habilita registro (ver AuthService.register / acceptTenantInvite).
                      await createDraftMember(activeMembership.tenantId, trimmedEmail, formData.name || 'Nuevo Asesor', formData.role as Role, creator.id);
                      addToast('Usuario guardado como borrador', 'success');
                    } else {
                      // Sin correo todavía: solo nombre y rol, status 'prepared'. No
                      // habilita registro ni login por ningún método hasta que se le
                      // agregue el correo (ver "Agregar email" / convertPreparedToDraft).
                      await createPreparedMember(activeMembership.tenantId, formData.name || 'Nuevo Asesor', formData.role as Role, creator.id);
                      addToast('Usuario guardado como preparado', 'success');
                    }
                  }
                  setIsModalOpen(false);
                } catch (error: any) {
                  addToast(error.message || 'Error en la operación', 'error');
                } finally {
                  setIsSaving(false);
                }
              }} className="space-y-5">
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase text-[10px] tracking-wider">Correo Electrónico (Vínculo corporativo){editingId ? ' *' : ' (opcional)'}</label>
                  <input
                    disabled={!!editingId}
                    type="email"
                    value={formData.email}
                    onChange={e => setFormData({...formData, email: e.target.value})}
                    placeholder="email@corporativo.com"
                    className={`w-full border rounded-xl px-4 py-3 text-sm focus:ring-4 focus:ring-primary-500/10 transition-all ${
                      editingId ? 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500' : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white'
                    }`}
                  />
                  {!editingId && (
                    <p className="mt-1.5 text-[10px] text-slate-500 italic">
                      {formData.email
                        ? 'El usuario debe crear su cuenta usando este mismo correo para activar el acceso.'
                        : 'Si todavía no tenés el correo, guardalo igual como preparado y agregalo después.'}
                    </p>
                  )}
                </div>
                
                {!editingId ? (
                   <div>
                     <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase text-[10px] tracking-wider">Nombre Sugerido</label>
                     <input 
                       type="text" 
                       value={formData.name} 
                       onChange={e => setFormData({...formData, name: e.target.value})}
                       placeholder="Nombre actual o apodo"
                       className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm focus:ring-4 focus:ring-primary-500/10"
                     />
                   </div>
                ) : (
                  <div>
                    <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase text-[10px] tracking-wider">Perfil Actual</label>
                    <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-sm italic text-slate-600 dark:text-slate-400 flex items-center">
                       {formData.name}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase text-[10px] tracking-wider">Rol de Acceso *</label>
                  <select required value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as Role})} className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm focus:ring-4 focus:ring-primary-500/10">
                    <option value="Owner">Owner / Socio Principal</option>
                    <option value="Admin">Admin</option>
                    <option value="Asesor Comercial">Asesor Comercial</option>
                    <option value="Técnico">Técnico / Instalador</option>
                    <option value="Solo lectura">Solo lectura</option>
                  </select>
                </div>

                {editingId && !['draft', 'prepared'].includes(editingMember?.status || '') && (
                  <div className="flex items-center p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                    <input id="isActiveUser" type="checkbox" checked={formData.isActive} onChange={e => setFormData({...formData, isActive: e.target.checked})} className="w-5 h-5 text-[#1877F2] bg-white border-slate-300 rounded focus:ring-primary-500" />
                    <label htmlFor="isActiveUser" className="ml-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Usuario Activo</label>
                  </div>
                )}

                {editingId && (
                  isEditingSelf ? (
                    <p className="text-[10px] text-slate-400 italic px-1">No podés editar tus propias herramientas asignadas.</p>
                  ) : formData.role === 'Owner' ? (
                    <p className="text-[10px] text-slate-400 italic px-1">Owner siempre tiene acceso a todas las herramientas.</p>
                  ) : (
                    <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase text-[10px] tracking-wider">Herramientas asignadas</label>
                        <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                          <input type="checkbox" checked={customizeTools}
                            onChange={e => { setCustomizeTools(e.target.checked); if (!e.target.checked) setSelectedTools(getDefaultToolsForRole(formData.role as Role)); }}
                            className="w-4 h-4 text-[#1877F2] rounded focus:ring-primary-500" />
                          Personalizar
                        </label>
                      </div>
                      {!customizeTools ? (
                        <p className="text-[10px] text-slate-500 italic">Usando el conjunto por defecto de su rol. Activá "Personalizar" para elegir manualmente.</p>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-1.5">
                            {(Object.keys(TOOL_PRESETS) as (keyof typeof TOOL_PRESETS)[]).map(preset => (
                              <button key={preset} type="button" onClick={() => applyPreset(preset)}
                                className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                                {preset}
                              </button>
                            ))}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {ALL_TOOL_KEYS.map(tool => {
                              const requiresAdmin = ADMIN_ONLY_TOOLS.includes(tool);
                              const targetIsAdminOrOwner = formData.role === 'Admin' || formData.role === 'Owner';
                              const irrelevant = requiresAdmin && !targetIsAdminOrOwner;
                              // Para un rol que no es Admin/Owner, Usuarios/Configuración/
                              // Integraciones son irrelevantes: RoleGuard ya las bloquea de
                              // forma independiente sin importar qué haya en allowedTools.
                              // Se muestra una nota en vez de un checkbox marcado-pero-inerte
                              // (un checkbox nativo checked+disabled con color personalizado
                              // puede pintarse "vacío" en algunos navegadores y confundir,
                              // aunque el estado real y el enforcement sean correctos).
                              if (irrelevant) {
                                return (
                                  <div key={tool}
                                    title="Requiere rol Admin u Owner — RoleGuard ya lo exige de forma independiente, sin importar este selector"
                                    className="flex items-center gap-2 text-xs px-2.5 py-2 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-600">
                                    <span className="flex-1">{TOOL_LABELS[tool]}</span>
                                    <span className="text-[9px] font-bold uppercase tracking-tight">No aplica</span>
                                  </div>
                                );
                              }
                              return (
                                <label key={tool}
                                  className="flex items-center gap-2 text-xs px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
                                  <input type="checkbox" checked={selectedTools.includes(tool)}
                                    onChange={() => toggleTool(tool)}
                                    className="w-4 h-4 text-[#1877F2] rounded focus:ring-primary-500" />
                                  <span className="font-semibold text-slate-700 dark:text-slate-300">{TOOL_LABELS[tool]}</span>
                                </label>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )
                )}
              </form>
            </div>
            <div className="px-6 py-5 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-900/50">
              <button disabled={isSaving} onClick={() => setIsModalOpen(false)} className="px-5 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors uppercase tracking-widest text-[10px]">Cancelar</button>
              <button disabled={isSaving} type="submit" form="user-form" className="px-6 py-2.5 text-sm font-bold text-white bg-[#1877F2] hover:bg-[#166fe5] rounded-xl transition-all shadow-lg shadow-[#1877F2]/30 flex items-center disabled:opacity-50 disabled:cursor-not-allowed">
                 {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                 {editingId ? 'Guardar Cambios' : (formData.email || '').trim() ? 'Guardar como borrador' : 'Guardar como preparado'}
              </button>
            </div>
          </div>
        </div>
      )}
      {deviceModalUser && (
        <DeviceManagerModal
          userId={deviceModalUser.userId}
          userName={deviceModalUser.name}
          onClose={() => setDeviceModalUser(null)}
        />
      )}
      {vendorAccess && (
        <VendorAccessModal
          data={vendorAccess}
          onClose={() => setVendorAccess(null)}
        />
      )}
    </div>
  );
};

/** Helper to format last seen time */
function formatLastSeen(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  
  if (diffMin < 2) return 'Activo ahora';
  if (diffMin < 60) return `Visto hace ${diffMin} min`;
  
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Visto hace ${diffH}h`;
  
  return `Visto el ${date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`;
}
