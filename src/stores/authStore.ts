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
  // Nombre del negocio cliente cuando el SA está impersonando
  impersonatedName: string | null;
  
  initializeAuthListener: () => void;
  setActiveTenant: (tenantId: string) => void;
  exitImpersonation: () => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  memberships: [],
  activeMembership: null,
  isAuthenticated: false,
  isLoading: true,
  impersonatedName: null,
  
  initializeAuthListener: () => {
    auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        try {
          await AuthService.linkPendingMembership();
          
          const profile = await AuthService.getUserProfile(firebaseUser.uid);
          const userMemberships = await AuthService.getUserMemberships(firebaseUser.uid);
          
          let resolvedMembership = null;
          let initImpersonatedName: string | null = null;
          // sessionTenant: impersonación explícita en esta tab (solo sessionStorage)
          // savedTenant: usado para resolver membresías reales (sessionStorage || localStorage)
          const sessionTenant = sessionStorage.getItem('psmx_active_tenant');
          const savedTenant = sessionTenant || localStorage.getItem('psmx_active_tenant');

          if (userMemberships.length === 1) {
            const onlyMembership = userMemberships[0];
            if (!savedTenant || savedTenant === onlyMembership.tenantId) {
              // Sin impersonación pendiente → usar la única membresía
              resolvedMembership = onlyMembership;
              localStorage.setItem('psmx_active_tenant', onlyMembership.tenantId);
            }
            // Si savedTenant apunta a otro tenant → dejar resolvedMembership = null
            // para que caiga en SA impersonation recovery abajo
          } else if (userMemberships.length > 1) {
            if (savedTenant) {
              // SA sin impersonación activa (sessionTenant vacío) → ignorar localStorage
              const isSAWithoutActiveSession = profile?.isSuperAdmin && !sessionTenant;
              if (!isSAWithoutActiveSession) {
                resolvedMembership = userMemberships.find(m => m.tenantId === savedTenant) || null;
                // SA con sessionTenant en un tenant distinto al Hub → marcar impersonación
                if (resolvedMembership && profile?.isSuperAdmin && sessionTenant) {
                  const storedHubId = localStorage.getItem('psmx_active_tenant');
                  if (!storedHubId || savedTenant !== storedHubId) {
                    initImpersonatedName = resolvedMembership.tenantName || savedTenant;
                  }
                }
              }
            }
          }

          // SA impersonation recovery: SOLO si el tenant vino de sessionStorage
          // (impersonación explícita en esta tab). localStorage residual de otra sesión
          // NO debe impersonar automáticamente al Hub.
          if (!resolvedMembership && profile?.isSuperAdmin && sessionTenant) {
            try {
              const { getDoc, doc } = await import('firebase/firestore');
              const { db } = await import('@/lib/firebase');
              const tDoc = await getDoc(doc(db, 'tenants', sessionTenant));
              if (tDoc.exists()) {
                initImpersonatedName = tDoc.data().name || 'Negocio';
                const impersonated = {
                  id: `impersonated_${sessionTenant}`,
                  userId: profile.id,
                  email: profile.email,
                  tenantId: sessionTenant,
                  tenantName: initImpersonatedName,
                  role: 'Admin',
                  status: 'active'
                } as Membership;
                userMemberships.push(impersonated);
                resolvedMembership = impersonated;
              }
            } catch (e) {
              console.error('SA impersonation recovery failed', e);
            }
          }

          // SA sin sessionTenant → buscar cuál membresía pertenece al Hub
          // (el tenant donde ownerEmail === email del SA), reads en paralelo
          if (!resolvedMembership && profile?.isSuperAdmin && !sessionTenant) {
            try {
              const { getDoc, doc } = await import('firebase/firestore');
              const { db } = await import('@/lib/firebase');
              const realMems = userMemberships.filter(m => !m.id.startsWith('impersonated_'));
              const tenantDocs = await Promise.all(
                realMems.map(m => getDoc(doc(db, 'tenants', m.tenantId)))
              );
              const hubIndex = tenantDocs.findIndex(
                tDoc => tDoc.exists() && tDoc.data().ownerEmail === profile.email
              );
              if (hubIndex !== -1) {
                resolvedMembership = realMems[hubIndex];
                localStorage.setItem('psmx_active_tenant', realMems[hubIndex].tenantId);
              }
            } catch (e) {
              console.error('SA Hub resolution failed', e);
            }
          }

          // Fallback final: primera membresía real disponible
          if (!resolvedMembership && userMemberships.length > 0) {
            const realMemberships = userMemberships.filter(m => !m.id.startsWith('impersonated_'));
            if (realMemberships.length > 0) {
              resolvedMembership = realMemberships[0];
              localStorage.setItem('psmx_active_tenant', realMemberships[0].tenantId);
            }
          }

          set({
            user: profile,
            memberships: userMemberships,
            activeMembership: resolvedMembership,
            isAuthenticated: true,
            isLoading: false,
            impersonatedName: initImpersonatedName,
          });

          // Cargar settings del tenant activo (branding, config, etc.)
          if (resolvedMembership) {
            try {
              const { useSettingsStore } = await import('@/stores/settingsStore');
              useSettingsStore.getState().subscribe(resolvedMembership.tenantId);
            } catch (e) {
              console.error('Error al cargar settings iniciales', e);
            }
          }
        } catch (e) {
          console.error("Auth fetch error", e);
          set({ user: null, memberships: [], activeMembership: null, isAuthenticated: false, isLoading: false, impersonatedName: null });
        }
      } else {
        set({ user: null, memberships: [], activeMembership: null, isAuthenticated: false, isLoading: false, impersonatedName: null });
      }
    });
  },

  setActiveTenant: async (tenantId: string) => {
    const { memberships, user } = get();
    
    let selected = memberships.find(m => m.tenantId === tenantId) || null;
    let bizName: string | null = null;

    // Si no existe membresía real y es Super Admin → impersonar
    if (!selected && user?.isSuperAdmin) {
      try {
        const { getDoc, doc } = await import('firebase/firestore');
        const { db } = await import('@/lib/firebase');
        const tDoc = await getDoc(doc(db, 'tenants', tenantId));
        
        if (tDoc.exists()) {
          bizName = tDoc.data().name || 'Negocio';
          selected = {
            id: `impersonated_${tenantId}`,
            userId: user.id,
            email: user.email,
            tenantId,
            tenantName: bizName,
            role: 'Admin',
            status: 'active'
          } as Membership;

          // Agregar al array para que TenantResolvedGuard no bloquee
          const updatedMemberships = [...memberships.filter(m => !m.id.startsWith('impersonated_')), selected];
          set({ memberships: updatedMemberships });
        }
      } catch (e) {
        console.error("Error al crear membresía de impersonación", e);
      }
    }

    if (selected) {
      const hubId = localStorage.getItem('psmx_active_tenant');
      if (user?.isSuperAdmin) {
        // SA: siempre sessionStorage por tab. localStorage se mantiene como Hub (fallback en nuevas tabs).
        sessionStorage.setItem('psmx_active_tenant', tenantId);
        // Si cambia a un tenant que no es su Hub → impersonación visual (botón SALIR visible)
        if (!bizName && tenantId !== hubId) {
          bizName = selected.tenantName || tenantId;
        }
      } else if (bizName) {
        sessionStorage.setItem('psmx_active_tenant', tenantId);
      } else {
        localStorage.setItem('psmx_active_tenant', tenantId);
        sessionStorage.removeItem('psmx_active_tenant');
      }

      // Limpiar datos del tenant anterior ANTES de cambiar la membresía activa
      try {
        const [{ useConversationStore }, { useLeadStore }, { useUserStore }] = await Promise.all([
          import('@/stores/conversationStore'),
          import('@/stores/leadStore'),
          import('@/stores/userStore'),
        ]);
        useConversationStore.getState().reset();
        useLeadStore.getState().reset();
        useUserStore.getState().reset();
      } catch (e) {
        console.error("Error al resetear stores", e);
      }

      set({
        activeMembership: selected,
        impersonatedName: bizName,
      });

      // Recargar settings del nuevo tenant
      try {
        const { useSettingsStore } = await import('@/stores/settingsStore');
        useSettingsStore.getState().subscribe(tenantId);
      } catch (e) {
        console.error("Error al recargar settings", e);
      }
    }
  },

  exitImpersonation: async () => {
    const { memberships, setActiveTenant } = get();
    // Remover las membresías virtuales
    const realMemberships = memberships.filter(m => !m.id.startsWith('impersonated_'));
    set({ memberships: realMemberships, impersonatedName: null });
    sessionStorage.removeItem('psmx_active_tenant');

    // Hub ID siempre en localStorage (establecido por auth listener al login)
    const hubId = localStorage.getItem('psmx_active_tenant');
    if (hubId) {
      await setActiveTenant(hubId);
    } else if (realMemberships.length > 0) {
      await setActiveTenant(realMemberships[0].tenantId);
    } else {
      // Intentar forzar regreso al Hub
      try {
        const { SuperAdminService } = await import('@/services/firebase/SuperAdminService');
        const hubId = await SuperAdminService.getHubTenantId();
        await setActiveTenant(hubId);
      } catch (e) {
        console.error("No se pudo regresar al hub", e);
      }
    }
  },

  logout: async () => {
    localStorage.removeItem('psmx_active_tenant');
    sessionStorage.removeItem('psmx_active_tenant');
    await AuthService.logout();
  },

  refreshAuth: async () => {
    get().initializeAuthListener();
  }
}));
