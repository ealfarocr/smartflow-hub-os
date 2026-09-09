import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { PresenceService } from '@/services/firebase/PresenceService';
import { usePresenceTracker } from '@/hooks/usePresenceTracker';
import { forgetDeviceAndIdentity } from '@/utils/deviceTrust';
import { OperationalStatus, UserPresence, WorkSession } from '@/types';
import { Loader2, LayoutGrid, UserCog } from 'lucide-react';

const STATUS_BUTTONS: { status: OperationalStatus; label: string; emoji: string; activeClass: string }[] = [
  { status: 'working', label: 'Trabajando', emoji: '🟢', activeClass: 'bg-emerald-500 border-emerald-500' },
  { status: 'coffee', label: 'Café / Pausa', emoji: '🟡', activeClass: 'bg-amber-400 border-amber-400' },
  { status: 'lunch', label: 'Almuerzo', emoji: '🟠', activeClass: 'bg-orange-500 border-orange-500' },
  { status: 'errand', label: 'Diligencia', emoji: '🔵', activeClass: 'bg-blue-500 border-blue-500' },
  { status: 'off_shift', label: 'Terminar turno', emoji: '🔴', activeClass: 'bg-red-500 border-red-500' },
];

// UX móvil simplificada para vendedores (LOOP Fase 17) — a diferencia del
// selector compacto del header de escritorio (OperationalStatusSelector),
// esta es la pantalla completa a la que aterriza alguien que entró por PIN:
// solo su estado y su turno, nada más ("no saturar de métricas").
export const MyShiftView = () => {
  const navigate = useNavigate();
  const { user, activeMembership } = useAuthStore();
  const { addToast } = useUIStore();
  // BUG real encontrado: esta ruta (/mi-turno) nunca pasa por MainLayout —
  // es la única que llama usePresenceTracker() ahora mismo (ver
  // MainLayout.tsx). Un vendedor que entra por PIN aterriza directo acá, así
  // que sin esto su user_presence nunca recibía status/lastSeenAt/
  // lastActiveAt (solo operationalStatus, escrito por setOperationalStatus)
  // ni el heartbeat de tickPresence — se veía OFFLINE con "Visto el Invalid
  // Date" aunque el turno sí cambiara bien en Firestore.
  usePresenceTracker();
  const [presence, setPresence] = useState<UserPresence | null>(null);
  const [session, setSession] = useState<WorkSession | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Optimista: refleja el estado tocado AL INSTANTE, sin esperar el
  // round-trip de setOperationalStatus + el onSnapshot de abajo. Se
  // reconcilia solo (useEffect más abajo) apenas Firestore confirma el
  // mismo valor, y se revierte a null (deja mandar a `presence` real) si el
  // backend rechaza el cambio.
  const [optimisticStatus, setOptimisticStatus] = useState<OperationalStatus | null>(null);

  useEffect(() => {
    if (!user?.id || !activeMembership?.tenantId) return;
    const presenceId = `${activeMembership.tenantId}_${user.id}`;
    const unsub = onSnapshot(doc(db, 'user_presence', presenceId), (snap) => {
      const data = snap.exists() ? (snap.data() as UserPresence) : null;
      setPresence(data);
      // Reconciliación acá mismo (no en un efecto derivado aparte): apenas
      // Firestore confirma el mismo valor que ya se mostraba de forma
      // optimista, se suelta — currentStatus vuelve a reflejar directamente
      // `presence`, incluido si otro dispositivo/sesión cambia el estado
      // mientras tanto. Forma funcional para no depender de un
      // optimisticStatus capturado en un closure viejo de este callback.
      const next = data?.operationalStatus ?? 'off_shift';
      setOptimisticStatus((prev) => (prev === next ? null : prev));
    });
    return () => unsub();
  }, [user?.id, activeMembership?.tenantId]);

  useEffect(() => {
    const sessionId = presence?.activeWorkSessionId;
    if (!sessionId) {
      setSession(null);
      return;
    }
    const unsub = onSnapshot(doc(db, 'work_sessions', sessionId), (snap) => {
      setSession(snap.exists() ? ({ id: snap.id, ...snap.data() } as WorkSession) : null);
    });
    return () => unsub();
  }, [presence?.activeWorkSessionId]);

  const currentStatus: OperationalStatus = optimisticStatus ?? presence?.operationalStatus ?? 'off_shift';

  const handleSelect = async (status: OperationalStatus) => {
    if (!user?.id || !activeMembership?.tenantId || status === currentStatus || isSaving) return;
    setOptimisticStatus(status);
    setIsSaving(true);
    try {
      await PresenceService.setOperationalStatus(activeMembership.tenantId, status);
    } catch {
      setOptimisticStatus(null); // rollback — currentStatus vuelve a reflejar presence real
      addToast('No se pudo cambiar el estado — intentá de nuevo', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const formatDuration = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  // LOOP Fase 11 — cambiar de usuario en el MISMO teléfono. A propósito NO
  // reutiliza el deviceId actual: uno nuevo se genera recién cuando la
  // próxima persona complete su propio enrolamiento (link + PIN), tratado
  // igual que "dispositivo nuevo" (Fase 12). Así nunca hace falta que
  // registerDevice le transfiera la confianza de un usuario a otro con solo
  // tocar localStorage — el dispositivo viejo queda "Activo" a nombre de
  // quien lo tenía hasta que un Owner/Admin lo revoque o renombre a mano.
  const handleSwitchUser = async () => {
    if (!window.confirm('¿Cambiar de usuario en este teléfono?\n\nVas a cerrar tu sesión. La próxima persona necesita su propio link + PIN.')) return;
    await signOut(auth);
    forgetDeviceAndIdentity();
    navigate('/acceso', { replace: true });
  };

  if (!user || !activeMembership) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col px-6 py-10">
      <div className="max-w-sm w-full mx-auto flex-1 flex flex-col">
        <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">Hola</p>
        <h1 className="text-slate-900 dark:text-white text-3xl font-black mb-8">{user.name}</h1>

        <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">Tu estado</p>
        <div className="space-y-3 mb-6">
          {STATUS_BUTTONS.map((btn) => {
            const isActive = btn.status === currentStatus;
            return (
              <button
                key={btn.status}
                onClick={() => handleSelect(btn.status)}
                disabled={isSaving}
                className={`w-full flex items-center gap-3 px-5 py-4 rounded-2xl border-2 font-black text-lg transition-all disabled:opacity-50 ${
                  isActive
                    ? `${btn.activeClass} text-white shadow-lg`
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200'
                }`}
              >
                <span className="text-2xl">{btn.emoji}</span>
                {btn.label}
              </button>
            );
          })}
        </div>

        {/* FIX UX — acción principal: marcaste tu estado, ahora entrás al
            sistema. Antes vivía al fondo, con la misma jerarquía visual que
            "Cambiar de usuario" (acción rara, casi de emergencia) — como si
            fueran igual de importantes. */}
        <button
          onClick={() => navigate('/')}
          className="w-full flex items-center justify-center gap-2.5 px-5 py-4 rounded-2xl text-base font-black text-white shadow-lg active:scale-[0.98] transition-all mb-8"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          <LayoutGrid className="w-5 h-5" /> Ir al sistema completo
        </button>

        {session && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5 mb-8">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Turno de hoy</p>
            <div className="flex justify-between">
              <div>
                <p className="text-2xl font-black text-slate-900 dark:text-white">{formatDuration(session.activeSeconds || 0)}</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase">Tiempo activo</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black text-slate-400">{formatDuration((session.activeSeconds || 0) + (session.idleSeconds || 0))}</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase">Tiempo conectado</p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-auto">
          <button
            onClick={handleSwitchUser}
            className="w-full flex items-center justify-center gap-2 text-sm font-bold text-slate-400 hover:text-slate-600 py-3"
          >
            <UserCog className="w-4 h-4" /> Cambiar de usuario
          </button>
        </div>
      </div>
    </div>
  );
};
