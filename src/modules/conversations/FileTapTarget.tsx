import { useEffect, useRef, type ReactNode } from 'react';
import { recordMediaDiag } from '@/utils/mediaDiag';

interface FileTapTargetProps {
  /** Prefijo de los eventos del panel QA: CLIP, PHOTO, VIDEO. */
  diag: string;
  accept: string;
  capture?: 'environment' | 'user';
  multiple?: boolean;
  onFiles: (files: FileList) => unknown;
  className?: string;
  title?: string;
  children: ReactNode;
}

/**
 * El dedo toca DIRECTAMENTE el <input type="file">.
 *
 * El input transparente cubre toda la superficie del botón: no hay label, ni
 * .click() programático, ni nada entre el toque y el selector nativo. Es la
 * forma más directa que existe en la web de pedir un archivo — si con esto no
 * abre nada, el problema no es cómo lo activamos sino el entorno (por ejemplo,
 * un navegador dentro de otra app que no implementa el selector de archivos).
 *
 * Por eso registra en el panel QA la cadena completa de cada toque:
 *   <diag>_TAP              el toque llegó al input (con su accept y capture)
 *   <diag>_DIALOG_OPENED    la página perdió el foco / quedó oculta: el selector
 *                           o la cámara se abrieron de verdad
 *   <diag>_CANCEL           se cerró sin elegir nada (también prueba que abrió)
 *   <diag>_CHANGE           volvieron archivos
 * Si hay TAP y nunca DIALOG_OPENED ni CANCEL ni CHANGE, el navegador recibió el
 * toque y no abrió nada.
 */
export const FileTapTarget = ({
  diag, accept, capture, multiple, onFiles, className, title, children,
}: FileTapTargetProps) => {
  const localRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    // React no tipa onCancel en <input>: el evento nativo 'cancel' (Chrome 113+)
    // se escucha a mano. Llega cuando el selector abrio y se cerro sin elegir.
    const onCancel = () => recordMediaDiag(`${diag}_CANCEL`);
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [diag]);

  const onTap = (input: HTMLInputElement) => {
    recordMediaDiag(`${diag}_TAP`, {
      enabled: !input.disabled,
      accept: input.accept,
      capture: input.getAttribute('capture') || 'ninguno',
      filesApi: 'files' in input,
    });
    // Evidencia de que el selector abrió: la página pierde el foco o queda
    // oculta cuando aparece el diálogo nativo o la app de cámara. Son listeners
    // de una sola vez, no timers: no se interponen entre el toque y el selector.
    let reported = false;
    const opened = (how: string) => {
      if (reported) return;
      reported = true;
      recordMediaDiag(`${diag}_DIALOG_OPENED`, { via: how });
    };
    window.addEventListener('blur', () => opened('blur'), { once: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) opened('hidden'); }, { once: true });
  };

  return (
    <div className={`relative ${className ?? ''}`} title={title}>
      {children}
      <input
        ref={localRef}
        type="file"
        accept={accept}
        {...(capture ? { capture } : {})}
        multiple={multiple}
        aria-label={title}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        onClick={(e) => onTap(e.currentTarget)}
        onChange={async (e) => {
          const files = e.target.files;
          recordMediaDiag(`${diag}_CHANGE`, { files: files?.length ?? 0 });
          if (files?.length) await onFiles(files);
          e.target.value = '';
        }}
      />
    </div>
  );
};
