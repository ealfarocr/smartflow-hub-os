import { useEffect, useRef, useState } from 'react';
import { MoreVertical, Volume2, VolumeX, Sun, Moon, LogOut } from 'lucide-react';
import { useInboundSoundPreference } from '@/hooks/useInboundAlerts';
import { playInboundBeep, armInboundAudio } from '@/utils/inboundSound';

interface HeaderMoreMenuProps {
  theme: string;
  onToggleTheme: () => void;
  onLogout: () => void;
}

/** Menú "Más" SOLO móvil: agrupa sonido, modo oscuro y cerrar sesión para
 *  liberar ancho al nombre del usuario en el header. Mismas acciones que los
 *  botones de escritorio, sin lógica nueva. */
export const HeaderMoreMenu = ({ theme, onToggleTheme, onLogout }: HeaderMoreMenuProps) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { enabled, set } = useInboundSoundPreference();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleSound = () => {
    const next = !enabled;
    set(next);
    if (next) {
      armInboundAudio();
      playInboundBeep();
    }
    setOpen(false);
  };

  const itemCls = 'w-full flex items-center gap-3 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-left';

  return (
    <div className="relative sm:hidden" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Más opciones"
        aria-haspopup="menu"
        aria-expanded={open}
        className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
      >
        <MoreVertical className="h-5 w-5" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-56 max-w-[calc(100vw-1rem)] bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-100 dark:border-slate-700 py-1.5 z-[60]"
        >
          <button role="menuitem" className={itemCls} onClick={toggleSound}>
            {enabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            {enabled ? 'Sonido: activado' : 'Sonido: desactivado'}
          </button>
          <button role="menuitem" className={itemCls} onClick={() => { onToggleTheme(); setOpen(false); }}>
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            {theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
          </button>
          <button role="menuitem" className={`${itemCls} text-red-600 dark:text-red-400`} onClick={() => { setOpen(false); onLogout(); }}>
            <LogOut className="h-5 w-5" />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
};
