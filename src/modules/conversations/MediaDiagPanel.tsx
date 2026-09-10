import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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
 * Panel flotante de diagnóstico multimedia, visible en el propio teléfono.
 * Solo aparece con ?qa=1 (queda recordado; ?qa=0 lo apaga) o para SuperAdmin.
 *
 * Responde tres preguntas sin necesitar chrome://inspect:
 *  1. ¿Qué navegador es? Dentro del navegador embebido de otra app (Facebook,
 *     Instagram, a veces WhatsApp) los selectores de archivo no abren.
 *  2. ¿El toque llega al input? TOQUE muestra el elemento que recibió cada
 *     toque: si al tocar el clip no dice input[type=file], algo lo tapa.
 *  3. ¿El selector abrió? *_DIALOG_OPENED / *_CANCEL / *_CHANGE lo prueban.
 */
export const MediaDiagPanel = ({ isSuperAdmin }: { isSuperAdmin: boolean }) => {
  const events = useSyncExternalStore(subscribeMediaDiag, getMediaDiag, getMediaDiag);
  const [enabled] = useState(() => isSuperAdmin || isQaModeEnabled());
  const [open, setOpen] = useState(true);
  const env = useMemo(() => describeEnvironment(), []);

  useEffect(() => {
    if (!enabled) return;
    // Captura global: registra QUÉ elemento recibe el toque, antes que cualquier
    // otro handler. Es la forma de ver si una capa invisible tapa los botones.
    const onPointer = (e: PointerEvent) => {
      const path = e.composedPath().slice(0, 3).map(describeTarget).join(' < ');
      recordMediaDiag('TOQUE', { en: path });
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className="fixed top-2 right-2 z-[9998] max-w-[92vw] text-[10px] font-mono">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="px-2 py-1 rounded-lg bg-black/80 text-emerald-300 font-bold"
      >
        MEDIA_DIAG {open ? '▾' : '▸'} ({events.length})
      </button>
      {open && (
        <div className="mt-1 p-2 rounded-lg bg-black/85 text-white space-y-0.5 max-h-[55vh] overflow-y-auto">
          <div className="text-amber-300 font-bold">NAVEGADOR: {env.browser}{env.standalonePwa ? ' (app instalada)' : ''}</div>
          <div className={env.embedded ? 'text-red-400 font-bold' : 'text-emerald-300'}>
            EMBEBIDO: {env.embedded ? `SÍ — ${env.embedded}` : 'no'}
          </div>
          <div className="text-slate-300">
            táctil: {env.touch ? 'sí' : 'no'} · puntos: {env.maxTouchPoints} · showPicker: {env.showPickerApi ? 'sí' : 'no'}
          </div>
          <div className="text-slate-400 break-all whitespace-normal">{env.userAgent}</div>
          <div className="border-t border-white/20 my-1" />
          {events.length === 0 && <div className="text-slate-400">Tocá el clip o la cámara…</div>}
          {events.map((e, i) => (
            <div key={i} className="whitespace-normal break-all">
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
