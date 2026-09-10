import { create } from 'zustand';
import { Role, UserPresence, WorkSession } from '@/types';
import { UserService } from '@/services/firebase/UserService';
import { PresenceService } from '@/services/firebase/PresenceService';

export interface TeamMember {
  id: string; // membershipId
  userId: string;
  tenantId: string;
  role: Role;
  status: string;
  // Perfil del usuario
  name: string;
  email: string;
  isActive: boolean;
  // undefined/null = sin configurar, cae al fallback por rol (ver
  // src/utils/permissions.ts getEffectiveTools).
  allowedTools?: string[] | null;
}

interface UserState {
  teamMembers: TeamMember[];
  presenceMap: Record<string, UserPresence>;
  // Turno más reciente de cada userId (abierto o recién cerrado) — ver
  // PresenceService.subscribeToTenantWorkSessions (Fase 10, panel Owner/Admin).
  workSessionMap: Record<string, WorkSession>;
  isLoading: boolean;
  
  // Actions
  reset: () => void;
  subscribe: (tenantId: string) => () => void;
  inviteUser: (tenantId: string, email: string, name: string, role: Role, invitedBy: string) => Promise<void>;
  createDraftMember: (tenantId: string, email: string, name: string, role: Role, createdBy: string) => Promise<void>;
  sendInvitation: (membershipId: string) => Promise<void>;
  createPreparedMember: (tenantId: string, name: string, role: Role, createdBy: string) => Promise<void>;
  convertPreparedToDraft: (membershipId: string, tenantId: string, email: string) => Promise<void>;
  updateMemberRole: (membershipId: string, role: Role) => Promise<void>;
  updateMemberStatus: (membershipId: string, isActive: boolean) => Promise<void>;
  updateAllowedTools: (membershipId: string, tools: string[] | null) => Promise<void>;
}

export const useUserStore = create<UserState>((set) => ({
  teamMembers: [],
  presenceMap: {},
  workSessionMap: {},
  isLoading: true,

  reset: () => set({ teamMembers: [], presenceMap: {}, workSessionMap: {}, isLoading: false }),

  subscribe: (tenantId) => {
    set({ isLoading: true });
    
    // 1. Suscribirse a membresías
    // FIX URGENTE — Owner local solo veía su propio usuario: esto llamaba
    // getUserProfile(m.userId) (lee users/{uid}) para CADA compañero de
    // equipo con userId seteado — pero las Rules de esa colección SOLO
    // permiten leer el propio perfil o SuperAdmin (endurecido a propósito
    // para no exponer PII de otros usuarios, ver firestore.rules). Apenas
    // el tenant tenía más de una persona con userId real (es decir, más de
    // una ya logueada al menos una vez), la lectura del perfil ajeno tiraba
    // permission-denied DENTRO de un Promise.all — una sola promesa
    // rechazada tira TODO el lote, así que teamMembers nunca se volvía a
    // actualizar después del primer snapshot que sí incluía solo al Owner.
    // La propia membership YA trae name/email (se escriben al crearla/
    // migrarla) — no hace falta ni conviene leer users/{uid} de nadie más.
    const unsubMembers = UserService.subscribeToTenantMemberships(tenantId, (memberships) => {
      const members = memberships.map((m) => ({
        id: m.id,
        userId: m.userId || '',
        tenantId: m.tenantId,
        role: m.role,
        status: m.status, // active, pending, suspended
        name: m.name || 'Pendiente de acceso',
        email: m.email || '', // 'prepared' aún no tiene correo
        isActive: m.status !== 'suspended',
        allowedTools: m.allowedTools,
      } as TeamMember));
      set({ teamMembers: members, isLoading: false });
    });

    // 2. Suscribirse a presencia
    const unsubPresence = PresenceService.subscribeToTenantPresence(tenantId, (presenceList) => {
      const map: Record<string, UserPresence> = {};
      presenceList.forEach(p => {
        map[p.uid] = p;
      });
      set({ presenceMap: map });
    });

    // 3. Suscribirse a la sesión de turno más reciente de cada vendedor
    const unsubSessions = PresenceService.subscribeToTenantWorkSessions(tenantId, (sessions) => {
      const map: Record<string, WorkSession> = {};
      sessions.forEach(s => { map[s.userId] = s; });
      set({ workSessionMap: map });
    });

    return () => {
      unsubMembers();
      unsubPresence();
      unsubSessions();
    };
  },

  inviteUser: async (tenantId, email, name, role, invitedBy) => {
    await UserService.inviteUser(tenantId, email, name, role, invitedBy);
  },

  createDraftMember: async (tenantId, email, name, role, createdBy) => {
    await UserService.createDraftMember(tenantId, email, name, role, createdBy);
  },

  sendInvitation: async (membershipId) => {
    await UserService.sendInvitation(membershipId);
  },

  createPreparedMember: async (tenantId, name, role, createdBy) => {
    await UserService.createPreparedMember(tenantId, name, role, createdBy);
  },

  convertPreparedToDraft: async (membershipId, tenantId, email) => {
    await UserService.convertPreparedToDraft(membershipId, tenantId, email);
  },

  updateMemberRole: async (membershipId, role) => {
    await UserService.updateMembershipRole(membershipId, role);
  },

  updateMemberStatus: async (membershipId, isActive) => {
    await UserService.updateMembershipStatus(membershipId, isActive);
  },

  updateAllowedTools: async (membershipId, tools) => {
    await UserService.updateAllowedTools(membershipId, tools);
  }
}));
