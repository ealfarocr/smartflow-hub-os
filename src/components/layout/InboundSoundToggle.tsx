import { Volume2, VolumeX } from 'lucide-react';
import { useInboundSoundPreference } from '@/hooks/useInboundAlerts';
import { playInboundBeep, armInboundAudio } from '@/utils/inboundSound';

/** "Sonido de mensajes": al activarlo suena una vez para confirmar (y de paso
 *  el clic desbloquea el audio del navegador). */
export const InboundSoundToggle = () => {
  const { enabled, set } = useInboundSoundPreference();
  const label = enabled ? 'Sonido de mensajes: activado' : 'Sonido de mensajes: desactivado';

  const toggle = () => {
    const next = !enabled;
    set(next);
    if (next) {
      armInboundAudio();
      playInboundBeep();
    }
  };

  return (
    <button
      onClick={toggle}
      className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
      title={label}
      aria-label={label}
      aria-pressed={enabled}
    >
      {enabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
    </button>
  );
};
