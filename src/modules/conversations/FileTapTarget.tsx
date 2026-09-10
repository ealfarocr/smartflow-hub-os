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
 * El input transparente cubre toda la superficie del botón, y dentro del mismo
 * gesto se llama a input.showPicker() — la API explícita que Chrome Android
 * reporta como disponible en el teléfono de prueba. Si showPicker falla por
 * cualquier motivo, se deja pasar la activación nativa del input como
 * respaldo. Nada de setTimeout, await ni promesas entre el toque y el selector.
 *
 * La zona lleva data-media-target: el panel QA la usa para detectar si otro
 * elemento está tapando el control (<CONTROL>_COVERED_BY).
 *
 * Eventos del panel QA por cada toque:
 *   <diag>_TAP               el toque llegó al input
 *   <diag>_DIALOG_REQUESTED  se pidió el selector (vía showPicker o nativa)
 *   <diag>_SHOWPICKER_ERROR  showPicker lanzó; se usa la activación nativa
 *   <diag>_DIALOG_OPENED     la página perdió el foco o quedó oculta: abrió
 *   <diag>_CANCEL            se cerró sin elegir (también prueba que abrió)
 *   <diag>_CHANGE            volvieron archivos
 */
export const FileTapTarget = ({
  diag, accept, capture, multiple, onFiles, className, title, children,
}: FileTapTargetProps) => {
  const localRef = useRef<HTMLInputElement | null>(null);
  // true mientras se re-dispara la activación nativa tras un fallo de
  // showPicker: ese segundo click debe seguir su curso por defecto.
  const nativeFallbackRef = useRef(false);

  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    // React no tipa onCancel en <input>: el evento nativo 'cancel' (Chrome 113+)
    // se escucha a mano. Llega cuando el selector abrió y se cerró sin elegir.
    const onCancel = () => recordMediaDiag(`${diag}_CANCEL`);
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [diag]);

  const watchDialogOpened = () => {
    // Evidencia de que el selector abrió: la página pierde el foco o queda
    // oculta cuando aparece el diálogo nativo o la app de cámara. Listeners de
    // una sola vez, no timers: no se interponen entre el toque y el selector.
    let reported = false;
    const opened = (how: string) => {
      if (reported) return;
      reported = true;
      recordMediaDiag(`${diag}_DIALOG_OPENED`, { via: how });
    };
    window.addEventListener('blur', () => opened('blur'), { once: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) opened('hidden'); }, { once: true });
  };

  const onClick = (e: React.MouseEvent<HTMLInputElement>) => {
    const input = e.currentTarget;

    if (nativeFallbackRef.current) {
      // Segundo click, el del respaldo: se deja la acción por defecto.
      nativeFallbackRef.current = false;
      recordMediaDiag(`${diag}_DIALOG_REQUESTED`, { via: 'nativo (respaldo)' });
      return;
    }

    recordMediaDiag(`${diag}_TAP`, {
      inputPresente: true,
      habilitado: !input.disabled,
      accept: input.accept,
      capture: input.getAttribute('capture') || 'ninguno',
    });
    watchDialogOpened();

    if (typeof input.showPicker === 'function') {
      // Se cancela la apertura por defecto para no abrir el selector dos veces,
      // y se pide explícitamente — sigue siendo el mismo gesto del usuario.
      e.preventDefault();
      try {
        input.showPicker();
        recordMediaDiag(`${diag}_DIALOG_REQUESTED`, { via: 'showPicker' });
      } catch (err) {
        const error = err as { name?: string; message?: string };
        recordMediaDiag(`${diag}_SHOWPICKER_ERROR`, { nombre: error.name, detalle: error.message?.slice(0, 80) });
        nativeFallbackRef.current = true;
        input.click();
      }
      return;
    }

    recordMediaDiag(`${diag}_DIALOG_REQUESTED`, { via: 'nativo' });
  };

  return (
    <div className={`relative ${className ?? ''}`} title={title} data-media-target={diag}>
      {children}
      <input
        ref={localRef}
        type="file"
        accept={accept}
        {...(capture ? { capture } : {})}
        multiple={multiple}
        aria-label={title}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        onClick={onClick}
        onChange={async (e) => {
          const files = e.target.files;
          recordMediaDiag(`${diag}_CHANGE`, { archivos: files?.length ?? 0 });
          if (files?.length) await onFiles(files);
          e.target.value = '';
        }}
      />
    </div>
  );
};
