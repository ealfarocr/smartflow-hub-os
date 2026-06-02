import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';

export const TenantEntryView = () => {
  const { tenantId } = useParams<{ tenantId: string }>();
  const navigate = useNavigate();
  const { isLoading: authLoading, user } = useAuthStore();
  const [status, setStatus] = useState('Autenticando...');

  useEffect(() => {
    if (authLoading || !tenantId) return;

    (async () => {
      try {
        setStatus('Cargando negocio...');

        // 1. Obtener datos del tenant desde Firestore
        const { getDoc, doc } = await import('firebase/firestore');
        const { db } = await import('@/lib/firebase');
        const tDoc = await getDoc(doc(db, 'tenants', tenantId));
        if (!tDoc.exists()) {
          navigate('/super-admin', { replace: true });
          return;
        }
        const tenantName: string = tDoc.data().name || tenantId;

        // 2. Crear membresía de impersonación y activarla directamente
        const impersonated = {
          id: `impersonated_${tenantId}`,
          userId: user?.id || '',
          email: user?.email || '',
          tenantId,
          tenantName,
          role: 'Admin' as const,
          status: 'active' as const,
        };
        sessionStorage.setItem('psmx_active_tenant', tenantId);
        const currentMemberships = useAuthStore.getState().memberships.filter(
          m => !m.id.startsWith('impersonated_')
        );
        useAuthStore.setState({
          activeMembership: impersonated,
          impersonatedName: tenantName,
          memberships: [...currentMemberships, impersonated],
        });

        // 3. Suscribir settings y esperar que carguen
        setStatus(`Cargando configuración de ${tenantName}...`);
        useSettingsStore.getState().subscribe(tenantId);

        await new Promise<void>((resolve) => {
          const unsub = useSettingsStore.subscribe((state) => {
            if (!state.isLoading) { unsub(); resolve(); }
          });
          // Por si ya cargó
          if (!useSettingsStore.getState().isLoading) { unsub(); resolve(); }
        });

        navigate('/dashboard', { replace: true });
      } catch (e) {
        console.error('TenantEntryView error:', e);
        navigate('/super-admin', { replace: true });
      }
    })();
  }, [authLoading, tenantId]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-[#1877F2] border-t-transparent rounded-full animate-spin" />
        <p className="text-white font-bold text-sm">{status}</p>
      </div>
    </div>
  );
};
