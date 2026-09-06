import { create } from 'zustand';
import { Role, UserPresence } from '@/types';
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
  isLoading: true,

  reset: () => set({ teamMembers: [], presenceMap: {}, isLoading: false }),

  subscribe: (tenantId) => {
    set({ isLoading: true });
    
    // 1. Suscribirse a membresías
    const unsubMembers = UserService.subscribeToTenantMemberships(tenantId, async (memberships) => {
      const membersPromises = memberships.map(async (m) => {
        const profile = m.userId ? await UserService.getUserProfile(m.userId) : null;
        return {
          id: m.id,
          userId: m.userId || '',
          tenantId: m.tenantId,
          role: m.role,
          status: m.status, // active, pending, suspended
          name: profile?.name || m.name || 'Pendiente de acceso',
          email: profile?.email || m.email || '', // 'prepared' aún no tiene correo
          isActive: m.status !== 'suspended',
          allowedTools: m.allowedTools,
        } as TeamMember;
      });

      const members = await Promise.all(membersPromises);
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

    return () => {
      unsubMembers();
      unsubPresence();
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
