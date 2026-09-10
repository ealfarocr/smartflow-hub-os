import { useSyncExternalStore, useState } from 'react';
import { getMediaDiag, subscribeMediaDiag, clearMediaDiag, isQaModeEnabled } from '@/utils/mediaDiag';

/**
 * Panel flotante de diagnóstico multimedia, visible en el propio teléfono.
 * Solo aparece con ?qa=1 (queda recordado) o para SuperAdmin. Muestra la cadena
 * de pasos de cada toque: si sale CLIP_TAP pero nunca CLIP_CHANGE, el toque
 * llegó pero el selector no abrió; si no sale ni CLIP_TAP, algo tapa el botón.
 */
export const MediaDiagPanel = ({ isSuperAdmin }: { isSuperAdmin: boolean }) => {
  const events = useSyncExternalStore(subscribeMediaDiag, getMediaDiag, getMediaDiag);
  const [enabled] = useState(() => isSuperAdmin || isQaModeEnabled());
  const [open, setOpen] = useState(true);

  if (!enabled) return null;

  return (
    <div className="fixed top-2 right-2 z-[9998] max-w-[70vw] text-[10px] font-mono">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="px-2 py-1 rounded-lg bg-black/80 text-emerald-300 font-bold"
      >
        MEDIA_DIAG {open ? '▾' : '▸'} ({events.length})
      </button>
      {open && (
        <div className="mt-1 p-2 rounded-lg bg-black/85 text-white space-y-0.5 max-h-[40vh] overflow-y-auto">
          {events.length === 0 && <div className="text-slate-400">Tocá el clip o la cámara…</div>}
          {events.map((e, i) => (
            <div key={i} className="whitespace-nowrap">
              <span className="text-slate-400">{e.at}</span>{' '}
              <span className="text-emerald-300">{e.step}</span>
              {e.data ? <span className="text-slate-300"> {JSON.stringify(e.data)}</span> : null}
            </div>
          ))}
          <button type="button" onClick={clearMediaDiag} className="mt-1 text-amber-300 underline">limpiar</button>
        </div>
      )}
    </div>
  );
};
