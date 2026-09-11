import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  getMediaDiag, subscribeMediaDiag, clearMediaDiag, isQaModeEnabled, recordMediaDiag, describeEnvironment,
} from '@/utils/mediaDiag';
import { FileTapTarget, type MediaInputKind } from './FileTapTarget';

/** Descripción corta y no sensible de un elemento: etiqueta, tipo, marcas QA y 2 clases. */
function describeTarget(el: EventTarget | null): string {
  if (!(el instanceof Element)) return String(el);
  const tag = el.tagName.toLowerCase();
  const type = el instanceof HTMLInputElement ? `[type=${el.type}]` : '';
  const mark = el.getAttribute('data-media-input') || el.getAttribute('data-media-control');
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
  return `${tag}${type}${mark ? `{${mark}}` : ''}${cls ? '.' + cls : ''}`;
}

/** z-index efectivo: el del primer ancestro posicionado que lo defina. */
function effectiveZ(el: Element | null): string {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const z = getComputedStyle(n).zIndex;
    if (z !== 'auto') return `${z}@${n.tagName.toLowerCase()}`;
  }
  return 'auto';
}

/** Primer ancestro (o él mismo) con pointer-events:none, si existe. */
function pointerEventsBlocker(el: Element | null): string {
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    if (getComputedStyle(n).pointerEvents === 'none') return describeTarget(n);
  }
  return 'ninguno';
}

const rectText = (r: DOMRect) => `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;

/**
 * Auditoría de un control multimedia del chat en un punto de la pantalla.
 * Responde lo que pedía el P0: si el control y su input están renderizados, si
 * el input está deshabilitado, dónde está, qué elemento recibe realmente el
 * toque en ese punto, y con qué pointer-events / z-index.
 */
function auditControl(control: HTMLElement, x?: number, y?: number) {
  const r = control.getBoundingClientRect();
  const input = control.querySelector<HTMLElement>('[data-media-input]') ?? control.querySelector<HTMLElement>('button');
  const px = x ?? r.left + r.width / 2;
  const py = y ?? r.top + r.height / 2;
  const top = document.elementFromPoint(px, py);
  return {
    control: control.dataset.mediaControl,
    renderizado: r.width > 0 && r.height > 0,
    rect: rectText(r),
    input: input ? describeTarget(input) : 'NO RENDERIZADO',
    deshabilitado: input instanceof HTMLInputElement || input instanceof HTMLButtonElement ? input.disabled : false,
    enElPunto: describeTarget(top),
    loRecibeElInput: !!(input && top && (top === input || input.contains(top))),
    peInput: input ? getComputedStyle(input).pointerEvents : '-',
    bloqueaPE: input ? pointerEventsBlocker(input) : '-',
    z: effectiveZ(top),
  };
}

/**
 * Input de archivo NATIVO mínimo, fuera del chat: el dedo toca el propio
 * <input> (o su <label>). Sin overlay, sin showPicker, sin click programático.
 * Listeners nativos, independientes de React.
 */
const NativeProbe = ({ label, kind, accept, capture, multiple, onFiles }: {
  label: string; kind: 'GALLERY' | 'PHOTO' | 'VIDEO'; accept: string; capture?: 'environment';
  multiple?: boolean; onFiles?: (files: FileList) => void;
}) => {
  const ref = useRef<HTMLInputElement | null>(null);
  const onFilesRef = useRef(onFiles);
  useEffect(() => { onFilesRef.current = onFiles; }, [onFiles]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onClick = () => {
      recordMediaDiag(`QA_${kind}_TAP`);
      let reported = false;
      const opened = (how: string) => { if (!reported) { reported = true; recordMediaDiag(`QA_${kind}_DIALOG_OPENED`, { via: how }); } };
      window.addEventListener('blur', () => opened('blur'), { once: true });
      document.addEventListener('visibilitychange', () => { if (document.hidden) opened('hidden'); }, { once: true });
    };
    const onChange = () => {
      const f = el.files;
      recordMediaDiag(`QA_${kind}_CHANGE`, { archivos: f?.length ?? 0, tipo: f?.[0]?.type || '-', kb: f?.[0] ? Math.round(f[0].size / 1024) : 0 });
      if (f?.length) onFilesRef.current?.(f);
      // El valor se limpia después: el pipeline ya tomó los File.
      setTimeout(() => { el.value = ''; }, 0);
    };
    const onCancel = () => recordMediaDiag(`QA_${kind}_CANCEL`);
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('cancel', onCancel);
    return () => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('change', onChange);
      el.removeEventListener('cancel', onCancel);
    };
  }, [kind]);

  return (
    <label className="flex items-center gap-1.5 rounded bg-white/10 px-1.5 py-1">
      <span className="w-24 shrink-0 font-bold text-emerald-300">{label}</span>
      <input
        ref={ref}
        type="file"
        accept={accept}
        {...(capture ? { capture } : {})}
        multiple={multiple}
        data-qa-native={kind}
        className="min-w-0 flex-1 text-[10px] text-white"
      />
    </label>
  );
};

/**
 * Panel de diagnóstico multimedia visible en el teléfono (?qa=1 o SuperAdmin).
 *
 * OBSERVA, NO PARTICIPA. Va sobre la zona de MENSAJES, a media altura: no tapa
 * la barra superior (menú, estado, cerrar sesión), ni la cabecera del chat
 * (volver, Tomar), ni el composer (clip, cámara, micrófono, enviar). Los
 * registros son pointer-events-none; solo reciben toques la pastilla y la
 * tarjeta de PRUEBA MEDIA NATIVA (que se pliega con "prueba").
 *
 * PRUEBA MEDIA NATIVA: inputs de archivo nativos mínimos FUERA del chat, más una
 * copia del clip del chat también fuera del chat. En una sola prueba separa:
 *   - el navegador/teléfono (si ni el nativo abre),
 *   - el patrón del control (si el nativo abre y la copia no),
 *   - la ubicación dentro del chat (si los dos abren y el clip real no).
 */
export const MediaDiagPanel = ({ isSuperAdmin, onNativeFiles }: {
  isSuperAdmin: boolean;
  onNativeFiles?: (files: FileList, kind: MediaInputKind) => void;
}) => {
  const events = useSyncExternalStore(subscribeMediaDiag, getMediaDiag, getMediaDiag);
  const [enabled] = useState(() => isSuperAdmin || isQaModeEnabled());
  const [open, setOpen] = useState(true);
  const [showProbe, setShowProbe] = useState(true);
  const env = useMemo(() => describeEnvironment(), []);
  const pillRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const inPill = (e: Event) => !!pillRef.current && e.composedPath().includes(pillRef.current);

    // Cada toque: dónde, qué elemento lo recibe, y la auditoría del control
    // multimedia más cercano (o del que tapa, si el dedo cayó dentro de uno).
    const onPointer = (e: PointerEvent) => {
      if (inPill(e)) return;
      const path = e.composedPath();
      const x = e.clientX, y = e.clientY;
      let nearest: { el: HTMLElement; d: number } | null = null;
      document.querySelectorAll<HTMLElement>('[data-media-control]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const dx = Math.max(r.left - x, 0, x - r.right);
        const dy = Math.max(r.top - y, 0, y - r.bottom);
        const d = Math.round(Math.hypot(dx, dy));
        if (!nearest || d < nearest.d) nearest = { el, d };
      });
      const n = nearest as { el: HTMLElement; d: number } | null;
      recordMediaDiag('TOQUE', {
        xy: `${Math.round(x)},${Math.round(y)}`,
        en: path.slice(0, 3).map(describeTarget).join(' < '),
        control: n ? `${n.el.dataset.mediaControl} ${n.d === 0 ? 'DENTRO' : `a ${n.d}px`}` : 'no hay controles en pantalla',
      });
      if (n && n.d === 0) {
        const name = (n.el.dataset.mediaControl || 'X').toUpperCase();
        recordMediaDiag(`${name}_AUDIT`, auditControl(n.el, x, y));
        if (!path.includes(n.el)) {
          recordMediaDiag(`${name}_COVERED_BY`, { por: path.slice(0, 4).map(describeTarget).join(' < ') });
        }
      }
    };
    // ¿El toque terminó en un click? ¿O el navegador lo canceló (scroll, gesto)?
    const onClick = (e: MouseEvent) => {
      if (inPill(e)) return;
      recordMediaDiag('CLICK', { en: describeTarget(e.target) });
    };
    const onCancel = (e: PointerEvent) => recordMediaDiag('POINTERCANCEL', { en: describeTarget(e.target) });

    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('pointercancel', onCancel, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('pointercancel', onCancel, true);
    };
  }, [enabled]);

  // Foto del DOM sin tocar nada: cada control, su input y quién recibe un toque
  // en su centro. Detecta capas encima aunque nadie haya tocado el control.
  const auditDom = () => {
    const controls = [...document.querySelectorAll<HTMLElement>('[data-media-control]')];
    const names = controls.map((c) => c.dataset.mediaControl);
    recordMediaDiag('CONTROL_RENDERED', {
      clip: names.includes('clip'), camera: names.includes('camera'),
      photo: names.includes('photo') ? true : 'menú cerrado', video: names.includes('video') ? true : 'menú cerrado',
    });
    controls.forEach((c) => recordMediaDiag(`DOM_${(c.dataset.mediaControl || 'x').toUpperCase()}`, auditControl(c)));
  };

  if (!enabled) return null;

  const deliver = (kind: MediaInputKind) => (files: FileList) => onNativeFiles?.(files, kind);

  return (
    <div className="fixed top-[26%] left-2 z-[9998] w-[min(80vw,340px)] text-[10px] font-mono pointer-events-none select-none">
      <div ref={pillRef} className="pointer-events-auto inline-flex items-center gap-2 rounded-md bg-black/85 px-2 py-1">
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-emerald-300 font-bold">
          QA {open ? '▾' : '▸'} {events.length}
        </button>
        <button type="button" onClick={() => setShowProbe((v) => !v)} className="text-sky-300 font-bold">prueba</button>
        <button type="button" onClick={auditDom} className="text-fuchsia-300 font-bold">DOM</button>
        <button type="button" onClick={clearMediaDiag} className="text-amber-300">limpiar</button>
      </div>

      {showProbe && (
        <div className="pointer-events-auto mt-1 space-y-1 rounded-lg bg-slate-900/95 p-1.5 text-white shadow-lg" data-qa-probe>
          <p className="font-bold text-sky-300">PRUEBA MEDIA NATIVA</p>
          <NativeProbe label="ABRIR GALERÍA" kind="GALLERY" accept="image/*,video/*" multiple onFiles={deliver('gallery')} />
          <NativeProbe label="TOMAR FOTO" kind="PHOTO" accept="image/*" capture="environment" onFiles={deliver('photo')} />
          <NativeProbe label="GRABAR VIDEO" kind="VIDEO" accept="video/*" capture="environment" onFiles={deliver('video')} />
          {/* Copia EXACTA del clip del chat (mismo componente), pero fuera del chat. */}
          <FileTapTarget diag="QA_CHATCOPY" accept="image/*,video/*" multiple title="Copia del clip" onFiles={deliver('gallery')}
            className="rounded bg-white/10">
            <span className="flex items-center gap-1.5 px-1.5 py-1.5 font-bold text-amber-300 pointer-events-none">📎 COPIA DEL CLIP DEL CHAT</span>
          </FileTapTarget>
        </div>
      )}

      {open && (
        <div className="mt-1 rounded-md bg-black/75 p-1 text-white max-h-[18vh] overflow-hidden">
          <div className="text-amber-300">
            {env.browser}{env.embedded ? ` · EMBEBIDO: ${env.embedded}` : ' · no embebido'} · showPicker: {env.showPickerApi ? 'sí' : 'no'}
          </div>
          {events.length === 0 && <div className="text-slate-400">Tocá la prueba nativa, o el clip / la cámara del chat…</div>}
          {events.slice(0, 10).map((e, i) => (
            <div key={i} className="whitespace-normal break-all leading-tight">
              <span className="text-slate-400">{e.at}</span>{' '}
              <span className={/_COVERED_BY|_ERROR|POINTERCANCEL|FAILED_AT/.test(e.step) ? 'text-red-400 font-bold' : e.step.startsWith('QA_') ? 'text-sky-300' : 'text-emerald-300'}>{e.step}</span>
              {e.data ? <span className="text-slate-300"> {JSON.stringify(e.data)}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
