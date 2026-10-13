export interface AnchorRect { top: number; bottom: number; left: number; right: number }
export interface ViewportSize { width: number; height: number }

export interface MenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: 'below' | 'above';
}

interface Options {
  /** Ancho deseado del menú (px). Se reduce si el viewport es más angosto. */
  desiredWidth?: number;
  /** Alto natural del menú (px), para decidir si cabe debajo o hay que subirlo. */
  contentHeight?: number;
  /** Separación mínima con los bordes del viewport (px). */
  margin?: number;
  /** Separación entre el botón y el menú (px). */
  gap?: number;
}

/**
 * Posición de un menú desplegable anclado a un botón, siempre dentro del
 * viewport: ancho acotado al viewport, alineado al borde derecho del botón
 * (como en escritorio) pero corrido lo necesario para no recortarse ni por la
 * izquierda ni por la derecha, y con "flip" hacia arriba cuando abajo no cabe
 * y arriba hay más lugar. maxHeight permite scroll interno en vez de salirse.
 * Función pura: recibe medidas, no toca el DOM.
 */
export function computeMenuPosition(anchor: AnchorRect, viewport: ViewportSize, opts: Options = {}): MenuPosition {
  const { desiredWidth = 192, contentHeight = 0, margin = 8, gap = 8 } = opts;
  const width = Math.max(0, Math.min(desiredWidth, viewport.width - margin * 2));

  const preferredLeft = anchor.right - width;
  const maxLeft = Math.max(margin, viewport.width - width - margin);
  const left = Math.min(Math.max(preferredLeft, margin), maxLeft);

  const spaceBelow = viewport.height - anchor.bottom - gap - margin;
  const spaceAbove = anchor.top - gap - margin;
  const fitsBelow = contentHeight <= spaceBelow;
  const placement: 'below' | 'above' = !fitsBelow && spaceAbove > spaceBelow ? 'above' : 'below';

  const available = Math.max(0, placement === 'below' ? spaceBelow : spaceAbove);
  const maxHeight = available;
  const height = Math.min(contentHeight || available, available);
  const top = placement === 'below' ? anchor.bottom + gap : anchor.top - gap - height;

  return { top, left, width, maxHeight, placement };
}
