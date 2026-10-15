import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computeMenuPosition, type MenuPosition } from '@/utils/dropdownPosition';
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);

  // El menú va en un portal a document.body con position:fixed: el contenedor
  // del layout tiene overflow-hidden y, en móvil, el botón queda cerca del borde
  // izquierdo — un menú absolute right-0 de 192px se salía por ahí. Se mide el
  // botón y se acota al viewport visible (visualViewport = sin la barra del
  // navegador ni el teclado), con scroll interno si no cabe.
  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const vv = window.visualViewport;
    setMenuPos(computeMenuPosition(
      { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
      { width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight },
      { desiredWidth: 192, contentHeight: menuRef.current?.scrollHeight ?? STATUS_ORDER.length * 40 + 12 },
    ));
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    window.visualViewport?.addEventListener('resize', updateMenuPosition);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
      window.visualViewport?.removeEventListener('resize', updateMenuPosition);
    };
  }, [isOpen, updateMenuPosition]);

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
      const target = e.target as Node;
      // El menú vive en un portal: ya no es descendiente de containerRef.
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
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
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((o) => !o)}
        disabled={isSaving}
        className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors disabled:opacity-50"
      >
        <span className={`w-2.5 h-2.5 shrink-0 rounded-full ${meta.dot}`} />
        <span className="text-[11px] sm:text-xs font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap max-[359px]:hidden">{meta.label}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
      </button>
      {isOpen && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={menuPos
            ? { position: 'fixed', top: menuPos.top, left: menuPos.left, width: menuPos.width, maxHeight: menuPos.maxHeight }
            : { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }}
          className="overflow-y-auto overscroll-contain bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-100 dark:border-slate-700 py-1.5 z-[60]">
          {STATUS_ORDER.map((s) => {
            const meta = STATUS_META[s];
            const isActive = s === status;
            return (
              <button
                key={s}
                role="menuitem"
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
        </div>,
        document.body,
      )}
    </div>
  );
};
