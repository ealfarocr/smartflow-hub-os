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
}

interface UserState {
  teamMembers: TeamMember[];
  presenceMap: Record<string, UserPresence>;
  isLoading: boolean;
  
  // Actions
  subscribe: (tenantId: string) => () => void;
  inviteUser: (tenantId: string, email: string, role: Role, invitedBy: string) => Promise<void>;
  updateMemberRole: (membershipId: string, role: Role) => Promise<void>;
  updateMemberStatus: (membershipId: string, isActive: boolean) => Promise<void>;
}

export const useUserStore = create<UserState>((set) => ({
  teamMembers: [],
  presenceMap: {},
  isLoading: true,

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
          name: profile?.name || 'Pendiente de acceso',
          email: profile?.email || m.email,
          isActive: m.status !== 'suspended'
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

  inviteUser: async (tenantId, email, role, invitedBy) => {
    await UserService.inviteUser(tenantId, email, role, invitedBy);
  },

  updateMemberRole: async (membershipId, role) => {
    await UserService.updateMembershipRole(membershipId, role);
  },

  updateMemberStatus: async (membershipId, isActive) => {
    await UserService.updateMembershipStatus(membershipId, isActive);
  }
}));
