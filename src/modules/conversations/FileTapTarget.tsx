import { useEffect, useRef, type ReactNode } from 'react';
import { clearPickerOpen, markPickerOpen, recordMediaDiag } from '@/utils/mediaDiag';

export type MediaControl = 'clip' | 'photo' | 'video';
export type MediaInputKind = 'gallery' | 'photo' | 'video';

/**
 * Un `cancel` que llega antes de esto, sin que la página se haya ocultado, no
 * lo pudo hacer una persona (tendría que ver el selector y cerrarlo): Chrome no
 * llegó a mostrarlo. En Android pasa cuando Chrome no tiene permiso de Cámara o
 * de Fotos y videos en los Ajustes del teléfono.
 */
export const FAST_CANCEL_MS = 1200;

interface FileTapTargetProps {
  /** Prefijo de los eventos del panel QA: CLIP, PHOTO, VIDEO. */
  diag: string;
  /** Marca del DOM para la auditoría del panel QA (data-media-control). La
   *  prueba aislada del panel QA no la lleva: no es un control del chat. */
  control?: MediaControl;
  /** Marca del input para la auditoría del panel QA (data-media-input). */
  inputKind?: MediaInputKind;
  accept: string;
  capture?: 'environment' | 'user';
  multiple?: boolean;
  onFiles: (files: FileList) => unknown;
  /** El selector terminó de verdad: volvió un archivo (change) o se canceló (cancel). */
  onSettled?: () => void;
  /** Se canceló casi al instante sin mostrarse (ver FAST_CANCEL_MS). */
  onFastCancel?: () => void;
  className?: string;
  title?: string;
  children: ReactNode;
}

/**
 * El dedo toca DIRECTAMENTE el <input type="file">, y el navegador lo abre con
 * su activación nativa. Nada más: sin showPicker(), sin preventDefault, sin
 * .click() programático, sin timers.
 *
 * Eventos del panel QA (solo hechos observables, sin suposiciones):
 *   <diag>_TAP               el click llegó al input (listener nativo, no React)
 *   <diag>_PICKER_REQUESTED  se dejó correr la activación nativa del input
 *   <diag>_WINDOW_BLUR       la ventana perdió el foco (NO prueba que se vio nada)
 *   <diag>_PAGE_HIDDEN       la página quedó oculta (otra app encima)
 *   <diag>_CANCEL            evento nativo 'cancel' del input, con ms y lectura
 *   <diag>_CHANGE            volvieron archivos, con ms
 * Antes se registraba DIALOG_OPENED con el blur de la ventana: en el teléfono
 * aparecía aunque el selector nunca se mostró, así que se eliminó.
 */
export const FileTapTarget = ({
  diag, control, inputKind, accept, capture, multiple, onFiles, onSettled, onFastCancel, className, title, children,
}: FileTapTargetProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const tapAt = useRef(0);
  const hiddenSinceTap = useRef(false);
  const onSettledRef = useRef(onSettled);
  const onFastCancelRef = useRef(onFastCancel);
  useEffect(() => { onSettledRef.current = onSettled; onFastCancelRef.current = onFastCancel; }, [onSettled, onFastCancel]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const since = () => (tapAt.current ? Date.now() - tapAt.current : -1);
    // Listeners NATIVOS: registran aunque la delegación de eventos de React no
    // llegara a ejecutarse.
    const onClick = () => {
      tapAt.current = Date.now();
      hiddenSinceTap.current = false;
      recordMediaDiag(`${diag}_TAP`, {
        habilitado: !el.disabled,
        accept: el.accept,
        capture: el.getAttribute('capture') || 'ninguno',
      });
      recordMediaDiag(`${diag}_PICKER_REQUESTED`, { via: 'activación nativa' });
      // Marca de "selector abierto" para detectar si Android recarga la página
      // mientras la cámara está abierta. Solo diagnóstico: no toca el flujo.
      markPickerOpen(diag);
      window.addEventListener('focus', () => setTimeout(clearPickerOpen, 5000), { once: true });
    };
    const onBlur = () => { if (tapAt.current) recordMediaDiag(`${diag}_WINDOW_BLUR`, { ms: since() }); };
    const onVisibility = () => {
      if (tapAt.current && document.hidden && !hiddenSinceTap.current) {
        hiddenSinceTap.current = true;
        recordMediaDiag(`${diag}_PAGE_HIDDEN`, { ms: since() });
      }
    };
    // 'cancel' nativo del <input> (Chrome 113+): el selector se cerró sin archivo.
    const onCancel = () => {
      const ms = since();
      const instant = ms >= 0 && ms < FAST_CANCEL_MS && !hiddenSinceTap.current;
      clearPickerOpen();
      recordMediaDiag(`${diag}_CANCEL`, {
        ms,
        paginaOculta: hiddenSinceTap.current,
        ...(instant ? { lectura: 'cerró casi al instante sin mostrarse: Chrome no pudo abrir el selector (permisos de Chrome en Android)' } : {}),
      });
      tapAt.current = 0;
      if (instant) onFastCancelRef.current?.();
      onSettledRef.current?.();
    };
    el.addEventListener('click', onClick);
    el.addEventListener('cancel', onCancel);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('cancel', onCancel);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [diag]);

  return (
    <label className={`relative block cursor-pointer ${className ?? ''}`} title={title} data-media-control={control}>
      {children}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        {...(capture ? { capture } : {})}
        multiple={multiple}
        aria-label={title}
        data-media-input={inputKind}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        onChange={async (e) => {
          const files = e.target.files;
          const ms = tapAt.current ? Date.now() - tapAt.current : -1;
          tapAt.current = 0;
          clearPickerOpen();
          recordMediaDiag(`${diag}_CHANGE`, { archivos: files?.length ?? 0, ms });
          // El menú (si lo hay) se cierra recién ahora, con el archivo ya recibido.
          onSettledRef.current?.();
          if (files?.length) await onFiles(files);
          e.target.value = '';
        }}
      />
    </label>
  );
};
