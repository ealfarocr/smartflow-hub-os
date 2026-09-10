import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  getMediaDiag, subscribeMediaDiag, clearMediaDiag, isQaModeEnabled, recordMediaDiag, describeEnvironment,
} from '@/utils/mediaDiag';

/** Descripción corta y no sensible de un elemento: etiqueta, tipo, id y 2 clases. */
function describeTarget(el: EventTarget | null): string {
  if (!(el instanceof Element)) return String(el);
  const tag = el.tagName.toLowerCase();
  const type = el instanceof HTMLInputElement ? `[type=${el.type}]` : '';
  const id = el.id ? `#${el.id}` : '';
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
  return `${tag}${type}${id}${cls ? '.' + cls : ''}`;
}

/**
 * Panel de diagnóstico multimedia visible en el teléfono (?qa=1 o SuperAdmin).
 *
 * OBSERVA, NO PARTICIPA. La versión anterior era un bloque grande con
 * pointer-events normales: tapaba parte de la pantalla y los toques de la
 * prueba caían SOBRE EL PANEL (TOQUE registraba div.fixed / div.text-emerald),
 * así que nunca llegaban al clip y el diagnóstico se contaminaba a sí mismo.
 * Ahora todo el panel es pointer-events-none; lo único que recibe toques es la
 * pastilla chiquita de arriba a la izquierda para plegarlo y limpiarlo.
 *
 * Además de registrar qué elemento recibe cada toque, detecta el caso que
 * importa: si el dedo cae DENTRO del área de un control multimedia pero el
 * toque lo recibe OTRO elemento, registra <CONTROL>_COVERED_BY con el elemento
 * que lo está tapando.
 */
export const MediaDiagPanel = ({ isSuperAdmin }: { isSuperAdmin: boolean }) => {
  const events = useSyncExternalStore(subscribeMediaDiag, getMediaDiag, getMediaDiag);
  const [enabled] = useState(() => isSuperAdmin || isQaModeEnabled());
  const [open, setOpen] = useState(true);
  const env = useMemo(() => describeEnvironment(), []);
  const pillRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    // Captura global, antes que cualquier otro handler. Los toques sobre la
    // propia pastilla del panel se ignoran para no contaminar el registro.
    const onPointer = (e: PointerEvent) => {
      const path = e.composedPath();
      if (pillRef.current && path.includes(pillRef.current)) return;
      recordMediaDiag('TOQUE', { en: path.slice(0, 3).map(describeTarget).join(' < ') });

      document.querySelectorAll<HTMLElement>('[data-media-target]').forEach((zone) => {
        const r = zone.getBoundingClientRect();
        const dentro = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (dentro && !path.includes(zone)) {
          recordMediaDiag(`${zone.dataset.mediaTarget}_COVERED_BY`, {
            por: path.slice(0, 4).map(describeTarget).join(' < '),
          });
        }
      });
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className="fixed top-1 left-1 z-[9998] max-w-[72vw] text-[9px] font-mono pointer-events-none select-none">
      <div ref={pillRef} className="pointer-events-auto inline-flex items-center gap-1 rounded-md bg-black/80 px-1.5 py-0.5">
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-emerald-300 font-bold">
          QA {open ? '▾' : '▸'} {events.length}
        </button>
        <button type="button" onClick={clearMediaDiag} className="text-amber-300">limpiar</button>
      </div>
      {open && (
        <div className="mt-0.5 rounded-md bg-black/75 p-1 text-white max-h-[26vh] overflow-hidden">
          <div className="text-amber-300">
            {env.browser}{env.embedded ? ` · EMBEBIDO: ${env.embedded}` : ' · no embebido'} · showPicker: {env.showPickerApi ? 'sí' : 'no'}
          </div>
          {events.length === 0 && <div className="text-slate-400">Tocá el clip o la cámara…</div>}
          {events.slice(0, 12).map((e, i) => (
            <div key={i} className="whitespace-normal break-all leading-tight">
              <span className="text-slate-400">{e.at}</span>{' '}
              <span className={e.step.endsWith('_COVERED_BY') || e.step.endsWith('_ERROR') ? 'text-red-400 font-bold' : 'text-emerald-300'}>{e.step}</span>
              {e.data ? <span className="text-slate-300"> {JSON.stringify(e.data)}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
