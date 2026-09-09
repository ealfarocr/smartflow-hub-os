import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { PresenceService } from '@/services/firebase/PresenceService';
import { OperationalStatus, UserPresence } from '@/types';
import { ChevronDown } from 'lucide-react';

const STATUS_META: Record<OperationalStatus, { label: string; dot: string; activeBg: string; activeText: string }> = {
  // activeBg/activeText: fondo completo del botón cuando ese estado está
  // activo (antes solo cambiaba el dot de 2.5px, casi invisible en mobile).
  // activeText elegido por contraste real, no copiado a ciegas de blanco
  // para todos — amber-400/orange-500 con texto blanco no pasan WCAG AA
  // (~1.6:1 y ~2.4:1); con texto oscuro sí.
  working: { label: 'Trabajando', dot: 'bg-emerald-500', activeBg: 'bg-emerald-500 border-emerald-600', activeText: 'text-white' },
  coffee: { label: 'Café / Pausa', dot: 'bg-amber-400', activeBg: 'bg-amber-400 border-amber-500', activeText: 'text-amber-950' },
  lunch: { label: 'Almuerzo', dot: 'bg-orange-500', activeBg: 'bg-orange-500 border-orange-600', activeText: 'text-orange-950' },
  errand: { label: 'Diligencia', dot: 'bg-blue-500', activeBg: 'bg-blue-500 border-blue-600', activeText: 'text-white' },
  off_shift: { label: 'Terminar turno', dot: 'bg-red-500', activeBg: 'bg-red-500 border-red-600', activeText: 'text-white' },
};
const STATUS_ORDER: OperationalStatus[] = ['working', 'coffee', 'lunch', 'errand', 'off_shift'];

// Selector compacto de estado operativo (LOOP Fase 5) — versión funcional
// para el header de escritorio. La pantalla móvil grande y simplificada
// ("Hola, Michelle" + selector enorme) es un componente aparte (Fase 17),
// reutiliza la misma PresenceService.setOperationalStatus.
export const OperationalStatusSelector = () => {
  const { user, activeMembership } = useAuthStore();
  const { addToast } = useUIStore();
  const [firestoreStatus, setFirestoreStatus] = useState<OperationalStatus>('off_shift');
  // Optimista: refleja el estado tocado al instante, sin esperar el
  // round-trip de setOperationalStatus + este mismo onSnapshot. Se
  // reconcilia solo apenas Firestore confirma el mismo valor, y se revierte
  // a null (deja mandar a firestoreStatus real) si el backend rechaza el
  // cambio.
  const [optimisticStatus, setOptimisticStatus] = useState<OperationalStatus | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user?.id || !activeMembership?.tenantId) return;
    const presenceId = `${activeMembership.tenantId}_${user.id}`;
    const unsub = onSnapshot(doc(db, 'user_presence', presenceId), (snap) => {
      const data = snap.data() as UserPresence | undefined;
      // Sin operationalStatus todavía = off_shift (Fase 21) — nunca 'working' por defecto.
      const next = data?.operationalStatus || 'off_shift';
      setFirestoreStatus(next);
      // Reconciliación acá mismo (no en un efecto derivado aparte): apenas
      // Firestore confirma el mismo valor que ya se mostraba de forma
      // optimista, se suelta — status vuelve a reflejar directamente lo
      // real, incluido si otro dispositivo/sesión cambia el estado mientras
      // tanto. Forma funcional para no depender de un optimisticStatus
      // capturado en un closure viejo de este mismo callback.
      setOptimisticStatus((prev) => (prev === next ? null : prev));
    });
    return () => unsub();
  }, [user?.id, activeMembership?.tenantId]);

  const status = optimisticStatus ?? firestoreStatus;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = async (next: OperationalStatus) => {
    if (!user?.id || !activeMembership?.tenantId || next === status || isSaving) {
      setIsOpen(false);
      return;
    }
    setOptimisticStatus(next);
    setIsSaving(true);
    setIsOpen(false);
    try {
      await PresenceService.setOperationalStatus(activeMembership.tenantId, next);
    } catch {
      setOptimisticStatus(null); // rollback — status vuelve a reflejar firestoreStatus real
      addToast('No se pudo cambiar el estado — intentá de nuevo', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (!activeMembership) return null;
  const meta = STATUS_META[status];

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen((o) => !o)}
        disabled={isSaving}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors disabled:opacity-50"
      >
        <span className={`w-2.5 h-2.5 rounded-full ${meta.dot}`} />
        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 hidden sm:inline">{meta.label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>
      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-100 dark:border-slate-700 py-1.5 z-50">
          {STATUS_ORDER.map((s) => {
            const meta = STATUS_META[s];
            const isActive = s === status;
            return (
              <button
                key={s}
                onClick={() => handleSelect(s)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm border-2 transition-colors active:scale-[0.98] ${
                  isActive
                    ? `${meta.activeBg} ${meta.activeText} font-bold`
                    : 'border-transparent font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${isActive ? 'bg-white/70' : meta.dot}`} />
                {meta.label}
                {isActive && <span className="ml-auto text-[10px] font-bold uppercase tracking-wide opacity-80">Actual</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
