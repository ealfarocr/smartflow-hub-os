import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  getMediaDiag, subscribeMediaDiag, clearMediaDiag, isQaModeEnabled, recordMediaDiag, describeEnvironment,
} from '@/utils/mediaDiag';
import { buildDiagnosticText, explainMissingControls, type ChatDiagState, type ControlsSnapshot } from '@/utils/mediaDiagReport';
import { FileTapTarget, type MediaInputKind } from './FileTapTarget';

/**
 * Descripción corta y no sensible de un elemento: etiqueta, tipo, marcas QA, 2
 * clases y el rótulo (title/aria-label) del control interactivo que lo contiene
 * — así un TOQUE sobre un <span> dice "dentro del botón Cámara" en vez de solo
 * "span". Nunca el texto del contenido (podría ser un mensaje de un cliente).
 */
function describeTarget(el: EventTarget | null): string {
  if (!(el instanceof Element)) return String(el);
  const tag = el.tagName.toLowerCase();
  const type = el instanceof HTMLInputElement ? `[type=${el.type}]` : '';
  const mark = el.getAttribute('data-media-input') || el.getAttribute('data-media-control') || el.getAttribute('data-qa-native');
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
  const host = el.closest('button,a,label,input,textarea,[role=button]');
  const rotulo = host?.getAttribute('aria-label') || host?.getAttribute('title');
  return `${tag}${type}${mark ? `{${mark}}` : ''}${cls ? '.' + cls : ''}${rotulo ? ` «${rotulo.slice(0, 30)}»` : ''}`;
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

/** Controles del chat: los que están en el DOM y los que además tienen tamaño. */
function snapshotControls(): ControlsSnapshot {
  const all = [...document.querySelectorAll<HTMLElement>('[data-media-control]')];
  const visible = all.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  return { enDom: all.map((e) => e.dataset.mediaControl || '?'), visibles: visible.map((e) => e.dataset.mediaControl || '?') };
}

/**
 * Auditoría de un control multimedia del chat en un punto de la pantalla:
 * renderizado, input, deshabilitado, rect, qué elemento recibe realmente el
 * toque en ese punto, pointer-events y z-index.
 */
function auditControl(control: HTMLElement, x?: number, y?: number) {
  const r = control.getBoundingClientRect();
  // Solo hijos DIRECTOS: el 📷 contiene el menú (siempre montado) con los inputs
  // de Tomar foto / Grabar video; lo que se audita del 📷 es su propio botón.
  const input = control.querySelector<HTMLElement>(':scope > [data-media-input]') ?? control.querySelector<HTMLElement>(':scope > button');
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
 * Copia al portapapeles con respaldo. 1) Clipboard API (https + gesto del
 * usuario). 2) textarea temporal + execCommand('copy'), para navegadores o
 * contextos donde la API no está. Si los dos fallan devuelve false y el panel
 * muestra el texto seleccionado para copiarlo a mano.
 */
async function copyText(text: string): Promise<'clipboard' | 'execCommand' | false> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return 'clipboard';
    }
  } catch { /* se intenta el respaldo */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) return 'execCommand';
  } catch { /* sin respaldo posible */ }
  return false;
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
 * (volver, Tomar), ni el composer (clip, cámara, micrófono, enviar). El
 * contenedor y los registros son pointer-events-none. Reciben toques solo la
 * pastilla (plegar, copiar, limpiar, prueba, DOM) y los inputs de la tarjeta de
 * PRUEBA MEDIA NATIVA, que son la prueba en sí y se pliegan con "prueba".
 *
 * PRUEBA MEDIA NATIVA: inputs de archivo nativos mínimos FUERA del chat, más el
 * mismo control del clip del chat, también fuera del chat. En una sola prueba
 * separa:
 *   - el navegador/teléfono (si ni el nativo abre),
 *   - el patrón del control (si el nativo abre y el clip aislado no),
 *   - la ubicación dentro del chat (si los dos abren y el clip real no).
 */
export const MediaDiagPanel = ({ isSuperAdmin, onNativeFiles, chat }: {
  isSuperAdmin: boolean;
  onNativeFiles?: (files: FileList, kind: MediaInputKind) => void;
  /** Estado del chat, para explicar por qué 📎 / 📷 no están en pantalla. */
  chat?: ChatDiagState;
}) => {
  const events = useSyncExternalStore(subscribeMediaDiag, getMediaDiag, getMediaDiag);
  const [enabled] = useState(() => isSuperAdmin || isQaModeEnabled());
  const [open, setOpen] = useState(true);
  const [showProbe, setShowProbe] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const env = useMemo(() => describeEnvironment(), []);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const probeRef = useRef<HTMLDivElement | null>(null);
  const chatRef = useRef(chat);
  useEffect(() => { chatRef.current = chat; }, [chat]);

  // Cada cambio de estado del chat queda en el registro: si alguien toca "el
  // clip" con la lista abierta o con la ventana vencida, se ve por qué no está.
  const chatKey = chat ? `${chat.conversacionAbierta}|${chat.ventana}|${chat.grabando}` : 'fuera';
  useEffect(() => {
    if (!enabled || !chat) return;
    recordMediaDiag('CHAT_STATE', {
      conversacion: chat.conversacionAbierta ? 'abierta' : 'lista (ninguna abierta)',
      ventana24h: chat.ventana ?? '-',
      grabando: chat.grabando,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, chatKey]);

  useEffect(() => {
    if (!enabled) return;
    const inPill = (e: Event) => !!pillRef.current && e.composedPath().includes(pillRef.current);

    // Cada toque: dónde, qué elemento lo recibe, y la auditoría del control
    // multimedia más cercano (o del que tapa, si el dedo cayó dentro de uno).
    const onPointer = (e: PointerEvent) => {
      if (inPill(e)) return;
      const path = e.composedPath();
      const x = e.clientX, y = e.clientY;
      const enPrueba = !!probeRef.current && path.includes(probeRef.current);
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
        tipo: e.pointerType,
        zona: enPrueba ? 'PRUEBA MEDIA NATIVA' : 'app',
        en: path.slice(0, 3).map(describeTarget).join(' < '),
        control: n
          ? `${n.el.dataset.mediaControl} ${n.d === 0 ? 'DENTRO' : `a ${n.d}px`}`
          : explainMissingControls(chatRef.current ?? null, snapshotControls()),
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
      const t = e.target as Element | null;
      const control = t instanceof Element ? t.closest<HTMLElement>('[data-media-control]')?.dataset.mediaControl : undefined;
      recordMediaDiag(control ? `${control.toUpperCase()}_CLICK` : 'CLICK', { en: describeTarget(e.target) });
    };
    const onCancel = (e: PointerEvent) => {
      if (inPill(e)) return;
      // pointercancel = el navegador tomó el gesto (desplazamiento, zoom, menú
      // contextual) y NO habrá click. Se anota si la pantalla se movió.
      recordMediaDiag('POINTERCANCEL', {
        en: describeTarget(e.target),
        tipo: e.pointerType,
        scrollY: Math.round(window.scrollY),
        visualY: Math.round(window.visualViewport?.offsetTop ?? 0),
        zoom: +(window.visualViewport?.scale ?? 1).toFixed(2),
      });
    };

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
    const snap = snapshotControls();
    recordMediaDiag('CONTROL_RENDERED', {
      clip: snap.visibles.includes('clip'), camera: snap.visibles.includes('camera'),
      photo: snap.visibles.includes('photo') ? true : 'menú de cámara cerrado',
      video: snap.visibles.includes('video') ? true : 'menú de cámara cerrado',
      motivo: explainMissingControls(chatRef.current ?? null, snap),
    });
    document.querySelectorAll<HTMLElement>('[data-media-control]')
      .forEach((c) => recordMediaDiag(`DOM_${(c.dataset.mediaControl || 'x').toUpperCase()}`, auditControl(c)));
  };

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2500);
  };

  const copyDiagnostic = async () => {
    const text = buildDiagnosticText({
      now: new Date(),
      url: window.location.pathname,
      env,
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio, visualH: Math.round(window.visualViewport?.height ?? 0) || undefined },
      chat: chatRef.current ?? null,
      controls: snapshotControls(),
      events: getMediaDiag(),
    });
    const via = await copyText(text);
    if (via) {
      showFeedback('Diagnóstico copiado');
    } else {
      // Sin portapapeles: el texto queda seleccionado para copiarlo a mano.
      setManualCopy(text);
    }
  };

  const clearAll = () => {
    clearMediaDiag();
    showFeedback('Registro limpio');
  };

  if (!enabled) return null;

  const deliver = (kind: MediaInputKind) => (files: FileList) => onNativeFiles?.(files, kind);

  return (
    <div className="fixed top-[26%] left-2 z-[9998] w-[min(80vw,340px)] text-[10px] font-mono pointer-events-none select-none">
      <div ref={pillRef} className="pointer-events-auto inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-black/85 px-2 py-1">
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-emerald-300 font-bold" aria-label="Plegar o desplegar el registro">
          QA {open ? '▾' : '▸'} {events.length}
        </button>
        <button type="button" onClick={copyDiagnostic} className="text-white font-bold">📋 COPIAR DIAGNÓSTICO</button>
        <button type="button" onClick={clearAll} className="text-amber-300 font-bold">🧹 LIMPIAR</button>
        <button type="button" onClick={() => setShowProbe((v) => !v)} className="text-sky-300 font-bold">prueba</button>
        <button type="button" onClick={auditDom} className="text-fuchsia-300 font-bold">DOM</button>
        {feedback && <span role="status" className="text-emerald-300 font-bold">{feedback}</span>}
      </div>

      {manualCopy && (
        <div className="pointer-events-auto mt-1 rounded-lg bg-slate-900/95 p-1.5 text-white shadow-lg">
          <p className="mb-1 font-bold text-amber-300">No se pudo copiar solo: mantené presionado el texto y copialo.</p>
          <textarea readOnly value={manualCopy} onFocus={(e) => e.currentTarget.select()} autoFocus
            className="h-32 w-full rounded bg-black/60 p-1 text-[9px] text-white select-text" />
          <button type="button" onClick={() => setManualCopy(null)} className="mt-1 font-bold text-sky-300">cerrar</button>
        </div>
      )}

      {showProbe && (
        <div ref={probeRef} className="pointer-events-auto mt-1 space-y-1 rounded-lg bg-slate-900/95 p-1.5 text-white shadow-lg" data-qa-probe>
          <p className="font-bold text-sky-300">PRUEBA MEDIA NATIVA</p>
          <NativeProbe label="ABRIR GALERÍA" kind="GALLERY" accept="image/*,video/*" multiple onFiles={deliver('gallery')} />
          <NativeProbe label="TOMAR FOTO" kind="PHOTO" accept="image/*" capture="environment" onFiles={deliver('photo')} />
          <NativeProbe label="GRABAR VIDEO" kind="VIDEO" accept="video/*" capture="environment" onFiles={deliver('video')} />
          {/* El MISMO control del clip del chat (FileTapTarget), pero fuera del chat. */}
          <FileTapTarget diag="QA_CHATCOPY" accept="image/*,video/*" multiple title="Probar clip aislado" onFiles={deliver('gallery')}
            className="rounded bg-white/10">
            <span className="flex items-center gap-1.5 px-1.5 py-1.5 font-bold text-amber-300 pointer-events-none">📎 PROBAR CLIP AISLADO</span>
          </FileTapTarget>
        </div>
      )}

      {open && (
        <div className="mt-1 rounded-md bg-black/75 p-1 text-white max-h-[18vh] overflow-hidden">
          <div className="text-amber-300">
            {env.browser}{env.embedded ? ` · EMBEBIDO: ${env.embedded}` : ' · no embebido'} · showPicker: {env.showPickerApi ? 'sí' : 'no'} · táctil: {env.touch ? 'sí' : 'no'}
          </div>
          {events.length === 0 && <div className="text-slate-400">Abrí una conversación y tocá la prueba nativa, o el 📎 / 📷 del chat…</div>}
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
