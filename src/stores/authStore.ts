import { create } from 'zustand';
import { User, Membership } from '@/types';
import { auth } from '@/lib/firebase';
import { AuthService } from '@/services/AuthService';

interface AuthState {
  user: User | null;
  memberships: Membership[];
  activeMembership: Membership | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  
  initializeAuthListener: () => void;
  setActiveTenant: (tenantId: string) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  memberships: [],
  activeMembership: null,
  isAuthenticated: false,
  isLoading: true,
  
  initializeAuthListener: () => {
    auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        try {
          // Asegurar vinculación en cada cambio de estado (login/refresh)
          // Usamos la Cloud Function para saltar bloqueos de Firestore
          await AuthService.linkPendingMembership();
          
          const profile = await AuthService.getUserProfile(firebaseUser.uid);
          const userMemberships = await AuthService.getUserMemberships(firebaseUser.uid);
          
          let resolvedMembership = null;
          
          // Resolución Automática de Tenant
          if (userMemberships.length === 1) {
            resolvedMembership = userMemberships[0];
            localStorage.setItem('psmx_active_tenant', resolvedMembership.tenantId);
          } else if (userMemberships.length > 1) {
            const savedTenant = localStorage.getItem('psmx_active_tenant');
            if (savedTenant) {
               resolvedMembership = userMemberships.find(m => m.tenantId === savedTenant) || null;
            }
          }
          
          set({ 
            user: profile, 
            memberships: userMemberships,
            activeMembership: resolvedMembership,
            isAuthenticated: true, 
            isLoading: false 
          });
        } catch (e) {
          console.error("Auth fetch error", e);
          set({ user: null, memberships: [], activeMembership: null, isAuthenticated: false, isLoading: false });
        }
      } else {
        set({ user: null, memberships: [], activeMembership: null, isAuthenticated: false, isLoading: false });
      }
    });
  },

  setActiveTenant: (tenantId: string) => {
    const mems = get().memberships;
    const selected = mems.find(m => m.tenantId === tenantId) || null;
    if (selected) {
      localStorage.setItem('psmx_active_tenant', tenantId);
      set({ activeMembership: selected });
    }
  },

  logout: async () => {
    localStorage.removeItem('psmx_active_tenant');
    await AuthService.logout();
  }
}));
