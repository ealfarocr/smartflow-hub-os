import { useEffect, useState } from 'react';
import { useUserStore } from '@/stores/userStore';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { User, Role } from '@/types';
import { Plus, Edit2, Shield, UserX, UserCheck, Search, Filter, Loader2, Link as LinkIcon } from 'lucide-react';

export const UsersManagementView = () => {
  const { teamMembers, presenceMap, updateMemberRole, updateMemberStatus, subscribe, isLoading } = useUserStore();
  const { activeMembership } = useAuthStore();
  const { addToast } = useUIStore();

  useEffect(() => {
    if (activeMembership?.tenantId) {
      const unsubscribe = subscribe(activeMembership.tenantId);
      return () => unsubscribe();
    }
  }, [activeMembership?.tenantId, subscribe]);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<Role | 'All'>('All');
  const [searchQuery, setSearchQuery] = useState('');

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
    setIsModalOpen(true);
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

  const filteredUsers = teamMembers.filter((m) => {
    const matchesRole = filterRole === 'All' || m.role === filterRole;
    const matchesSearch = m.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          m.email.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesRole && matchesSearch;
  });

  const roleColors: Record<Role, string> = {
    Owner: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
    Admin: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    'Asesor Comercial': 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    Técnico: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    'Solo lectura': 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Gestión de Usuarios</h1>
        <button
          onClick={() => {
            setEditingId(null);
            setFormData({ name: '', email: '', role: 'Asesor Comercial', isActive: true });
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

        {/* User Table */}
        <div className="overflow-x-auto selection:bg-primary-100 dark:selection:bg-primary-900/30">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-100 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 uppercase text-[10px] font-black tracking-widest text-slate-600 dark:text-slate-400">
              <tr>
                <th className="px-6 py-4 font-bold text-center">Presencia</th>
                <th className="px-6 py-4 font-bold">Rol de Acceso</th>
                <th className="px-6 py-4 font-bold">Seguridad / Acceso</th>
                <th className="px-6 py-4 font-bold">Última Actividad / Ubicación</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center text-slate-500">
                      <Loader2 className="w-8 h-8 animate-spin text-[#1877F2] mb-2" />
                      <p className="animate-pulse font-medium">Sincronizando equipo...</p>
                    </div>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500 italic">No se encontraron usuarios en este tenant.</td>
                </tr>
              ) : (
                filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold mr-3 border ${
                          u.status === 'pending' 
                            ? 'bg-amber-50 border-amber-200 text-amber-600 dark:bg-amber-900/20 dark:border-amber-800' 
                            : 'bg-primary-50 border-primary-200 text-primary-700 dark:bg-primary-900/50 dark:border-primary-800 dark:text-primary-400'
                        }`}>
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-white flex items-center">
                            {u.name}
                            {u.status === 'pending' && <span className="ml-2 text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full font-bold uppercase tracking-tighter">Invitado</span>}
                          </div>
                          <div className="text-slate-500 text-xs">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col items-center">
                        {(() => {
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
                        })()}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 text-[11px] font-bold rounded-lg flex items-center w-max uppercase tracking-tight ${roleColors[u.role]}`}>
                         {u.role === 'Admin' || u.role === 'Owner' ? <Shield className="w-3 h-3 mr-1" /> : null}
                         {u.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-tight w-max ${
                          u.status === 'active' 
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' 
                            : u.status === 'pending'
                            ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                            : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                        }`}>
                          {u.status === 'active' ? 'Acceso Activo' : u.status === 'pending' ? 'Pendiente' : 'Suspendido'}
                        </span>
                        {presenceMap[u.userId] && (
                          <span className="text-[10px] text-slate-400 font-medium ml-1">
                            Vía: {presenceMap[u.userId].authProvider === 'google.com' ? 'Google SSO' : 'Email/Password'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {(() => {
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
                      })()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-1">
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
                        <button onClick={() => toggleStatus(u.id, u.isActive, u.name)} className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 p-2 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50" title={u.isActive ? 'Desactivar / Suspender' : 'Reactivar'}>
                          {u.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                        </button>
                        <button onClick={() => handleOpenModal(u)} className="text-slate-400 hover:text-[#1877F2] p-2 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50" title="Editar">
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-800">
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">{editingId ? 'Editar Miembro' : 'Invitar al Equipo'}</h3>
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
                    await Promise.all([
                      updateMemberRole(editingId, formData.role as Role),
                      updateMemberStatus(editingId, !!formData.isActive)
                    ]);
                    addToast('Miembro actualizado', 'success');
                  } else {
                    const { inviteUser } = useUserStore.getState();
                    await inviteUser(activeMembership.tenantId, formData.email!, formData.name || 'Nuevo Asesor', formData.role as Role, creator.id);
                    // Mostrar mensaje con enlace
                    alert(`¡Invitación enviada!\n\nComparte este enlace con el usuario:\nhttps://hub.smartflow-suite.com\n\nDebe ingresar con el correo: ${formData.email}`);
                    addToast('Invitación creada exitosamente', 'success');
                  }
                  setIsModalOpen(false);
                } catch (error: any) {
                  addToast(error.message || 'Error en la operación', 'error');
                } finally {
                  setIsSaving(false);
                }
              }} className="space-y-5">
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase text-[10px] tracking-wider">Correo Electrónico (Vínculo corporativo) *</label>
                  <input 
                    required={!editingId}
                    disabled={!!editingId} 
                    type="email" 
                    value={formData.email} 
                    onChange={e => setFormData({...formData, email: e.target.value})}
                    placeholder="email@corporativo.com"
                    className={`w-full border rounded-xl px-4 py-3 text-sm focus:ring-4 focus:ring-primary-500/10 transition-all ${
                      editingId ? 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500' : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white'
                    }`}
                  />
                  {!editingId && <p className="mt-1.5 text-[10px] text-slate-500 italic">El usuario debe crear su cuenta usando este mismo correo para activar el acceso.</p>}
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

                {editingId && (
                  <div className="flex items-center p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                    <input id="isActiveUser" type="checkbox" checked={formData.isActive} onChange={e => setFormData({...formData, isActive: e.target.checked})} className="w-5 h-5 text-[#1877F2] bg-white border-slate-300 rounded focus:ring-primary-500" />
                    <label htmlFor="isActiveUser" className="ml-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Usuario Activo</label>
                  </div>
                )}
              </form>
            </div>
            <div className="px-6 py-5 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-900/50">
              <button disabled={isSaving} onClick={() => setIsModalOpen(false)} className="px-5 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors uppercase tracking-widest text-[10px]">Cancelar</button>
              <button disabled={isSaving} type="submit" form="user-form" className="px-6 py-2.5 text-sm font-bold text-white bg-[#1877F2] hover:bg-[#166fe5] rounded-xl transition-all shadow-lg shadow-[#1877F2]/30 flex items-center disabled:opacity-50 disabled:cursor-not-allowed">
                 {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                 {editingId ? 'Guardar Cambios' : 'Enviar Invitación'}
              </button>
            </div>
          </div>
        </div>
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
