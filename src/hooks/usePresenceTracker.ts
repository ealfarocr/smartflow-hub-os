import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { PresenceService } from '@/services/firebase/PresenceService';
import { UserPresence } from '@/types';

export function usePresenceTracker() {
  const { user, activeMembership } = useAuthStore();
  const location = useLocation();
  const lastActivityRef = useRef<number>(Date.now());
  const statusRef = useRef<'online' | 'idle' | 'offline'>('online');

  useEffect(() => {
    if (!user || !activeMembership) return;

    const tenantId = activeMembership.tenantId;
    const uid = user.id;

    // Actualizar presencia inmediatamente al cambiar de ruta
    const update = async (overrideStatus?: 'online' | 'idle' | 'offline') => {
      const status = overrideStatus || statusRef.current;
      
      const presence: Partial<UserPresence> = {
        uid,
        tenantId,
        email: user.email,
        displayName: user.name,
        role: activeMembership.role,
        status,
        lastSeenAt: new Date().toISOString(),
        lastActiveAt: new Date(lastActivityRef.current).toISOString(),
        currentRoute: location.pathname,
        userAgent: navigator.userAgent,
        // Firebase Auth provider info if available
        authProvider: (user as any).providerId || 'password', 
      };

      try {
        await PresenceService.updatePresence(presence);
      } catch (err) {
        console.error("Error updating presence:", err);
      }
    };

    // Heartbeat cada 60 segundos
    const interval = setInterval(() => {
      const inactiveTime = Date.now() - lastActivityRef.current;
      
      // Si lleva más de 5 minutos sin mover el mouse, marcar como idle
      if (inactiveTime > 5 * 60 * 1000) {
        statusRef.current = 'idle';
      } else {
        statusRef.current = 'online';
      }

      update();
    }, 60 * 1000);

    // Detectar actividad
    const handleActivity = () => {
      lastActivityRef.current = Date.now();
      if (statusRef.current === 'idle') {
        statusRef.current = 'online';
        update('online');
      }
    };

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('click', handleActivity);
    window.addEventListener('scroll', handleActivity);

    // Update on mount or route change
    update();

    return () => {
      clearInterval(interval);
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      
      // Opcional: Marcar como offline al desmontar (aunque el cierre de pestaña no siempre lo dispara)
      // PresenceService.updatePresence({ uid, tenantId, status: 'offline' });
    };
  }, [user?.id, activeMembership?.tenantId, location.pathname]);
}
