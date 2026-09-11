import { useEffect, useRef, type ReactNode } from 'react';
import { recordMediaDiag } from '@/utils/mediaDiag';

export type MediaControl = 'clip' | 'photo' | 'video';
export type MediaInputKind = 'gallery' | 'photo' | 'video';

interface FileTapTargetProps {
  /** Prefijo de los eventos del panel QA: CLIP, PHOTO, VIDEO. */
  diag: string;
  /** Marca del DOM para la auditoría del panel QA (data-media-control). La
   *  copia de prueba del panel QA no la lleva: no es un control del chat. */
  control?: MediaControl;
  /** Marca del input para la auditoría del panel QA (data-media-input). */
  inputKind?: MediaInputKind;
  accept: string;
  capture?: 'environment' | 'user';
  multiple?: boolean;
  onFiles: (files: FileList) => unknown;
  className?: string;
  title?: string;
  children: ReactNode;
}

/**
 * El dedo toca DIRECTAMENTE el <input type="file">, y el navegador lo abre con
 * su activación nativa. Nada más: sin showPicker(), sin preventDefault, sin
 * .click() programático, sin timers. Es el mismo patrón que la prueba nativa
 * del panel QA, que vive fuera del chat; si esa abre y esta no, la diferencia
 * es la ubicación (algo encima, layout), no el mecanismo.
 *
 * Eventos del panel QA:
 *   <diag>_TAP             el click llegó al input (listener nativo, no React)
 *   <diag>_DIALOG_OPENED   la página perdió el foco o quedó oculta: abrió
 *   <diag>_CANCEL          se cerró sin elegir (también prueba que abrió)
 *   <diag>_CHANGE          volvieron archivos
 */
export const FileTapTarget = ({
  diag, control, inputKind, accept, capture, multiple, onFiles, className, title, children,
}: FileTapTargetProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    // Listeners NATIVOS: registran aunque la delegación de eventos de React no
    // llegara a ejecutarse — así el panel distingue "el toque no llegó al input"
    // de "llegó pero React no reaccionó".
    const onClick = () => {
      recordMediaDiag(`${diag}_TAP`, {
        habilitado: !el.disabled,
        accept: el.accept,
        capture: el.getAttribute('capture') || 'ninguno',
      });
      let reported = false;
      const opened = (how: string) => {
        if (reported) return;
        reported = true;
        recordMediaDiag(`${diag}_DIALOG_OPENED`, { via: how });
      };
      window.addEventListener('blur', () => opened('blur'), { once: true });
      document.addEventListener('visibilitychange', () => { if (document.hidden) opened('hidden'); }, { once: true });
    };
    const onCancel = () => recordMediaDiag(`${diag}_CANCEL`);
    el.addEventListener('click', onClick);
    el.addEventListener('cancel', onCancel);
    return () => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('cancel', onCancel);
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
          recordMediaDiag(`${diag}_CHANGE`, { archivos: files?.length ?? 0 });
          if (files?.length) await onFiles(files);
          e.target.value = '';
        }}
      />
    </label>
  );
};
