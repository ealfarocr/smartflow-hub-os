import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthStore } from '@/stores/authStore';
import { PresenceService } from '@/services/firebase/PresenceService';
import { OperationalStatus, UserPresence } from '@/types';
import { ChevronDown } from 'lucide-react';

const STATUS_META: Record<OperationalStatus, { label: string; dot: string }> = {
  working: { label: 'Trabajando', dot: 'bg-emerald-500' },
  coffee: { label: 'Café / Pausa', dot: 'bg-amber-400' },
  lunch: { label: 'Almuerzo', dot: 'bg-orange-500' },
  errand: { label: 'Diligencia', dot: 'bg-blue-500' },
  off_shift: { label: 'Terminar turno', dot: 'bg-red-500' },
};
const STATUS_ORDER: OperationalStatus[] = ['working', 'coffee', 'lunch', 'errand', 'off_shift'];

// Selector compacto de estado operativo (LOOP Fase 5) — versión funcional
// para el header de escritorio. La pantalla móvil grande y simplificada
// ("Hola, Michelle" + selector enorme) es un componente aparte (Fase 17),
// reutiliza la misma PresenceService.setOperationalStatus.
export const OperationalStatusSelector = () => {
  const { user, activeMembership } = useAuthStore();
  const [status, setStatus] = useState<OperationalStatus>('off_shift');
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user?.id || !activeMembership?.tenantId) return;
    const presenceId = `${activeMembership.tenantId}_${user.id}`;
    const unsub = onSnapshot(doc(db, 'user_presence', presenceId), (snap) => {
      const data = snap.data() as UserPresence | undefined;
      // Sin operationalStatus todavía = off_shift (Fase 21) — nunca 'working' por defecto.
      setStatus(data?.operationalStatus || 'off_shift');
    });
    return () => unsub();
  }, [user?.id, activeMembership?.tenantId]);

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
    setIsSaving(true);
    setIsOpen(false);
    try {
      await PresenceService.setOperationalStatus(activeMembership.tenantId, next);
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
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => handleSelect(s)}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <span className={`w-2.5 h-2.5 rounded-full ${STATUS_META[s].dot}`} />
              {STATUS_META[s].label}
              {s === status && <span className="ml-auto text-[10px] text-slate-400">Actual</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
