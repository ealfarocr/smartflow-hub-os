// Traducción de la máquina de estados del ciclo de acceso a lenguaje de
// NEGOCIO para la lista de Usuarios.
//
// REGLA UX del ciclo de acceso: nunca mostrar un botón que el backend va a
// rechazar por una condición que la propia UI ya conoce. Por eso el estado y
// la acción principal NO se calculan acá: los resuelve el backend
// (getTenantAccessOverview, con la misma máquina de estados que aplica
// setVendorPin — functions/src/accessLifecycle.ts) y este módulo solo les
// pone nombre, ícono y tono. Así no existe una segunda copia de las reglas
// que pueda desincronizarse con el backend.

/** Claves que devuelve el backend en `primaryAction`. */
export type AccessActionKey =
  | 'generate'
  | 'copy'
  | 'reactivate'
  | 'reactivate-and-generate'
  | 'review';

export interface TenantAccessEntry {
  state: string;
  primaryAction: AccessActionKey;
  canRegenerate: boolean;
  hasPinAccess: boolean;
  loginHandle: string | null;
}

export interface PrimaryActionMeta {
  label: string;
  /** Texto del title/tooltip — explica el resultado, no el mecanismo. */
  hint: string;
  tone: 'primary' | 'neutral' | 'warning';
}

const PRIMARY_ACTION_META: Record<AccessActionKey, PrimaryActionMeta> = {
  generate: {
    label: 'Generar acceso',
    hint: 'Crea el usuario y el PIN para que esta persona pueda entrar desde su teléfono',
    tone: 'primary',
  },
  copy: {
    label: 'Copiar acceso',
    hint: 'Ver y copiar el enlace y el usuario para mandárselos por WhatsApp',
    tone: 'neutral',
  },
  reactivate: {
    label: 'Reactivar',
    hint: 'Vuelve a habilitar el acceso de esta persona (su historial se conserva)',
    tone: 'primary',
  },
  'reactivate-and-generate': {
    label: 'Reactivar y generar acceso',
    hint: 'Reactiva a esta persona y le crea un acceso nuevo en un solo paso',
    tone: 'primary',
  },
  review: {
    label: 'Revisar ficha',
    hint: 'El estado de acceso de esta persona necesita revisión manual',
    tone: 'warning',
  },
};

export function primaryActionMeta(key: AccessActionKey): PrimaryActionMeta {
  return PRIMARY_ACTION_META[key] || PRIMARY_ACTION_META.review;
}

/**
 * Estado de acceso legible para el Owner — la columna "Acceso" de la lista.
 * Deliberadamente sin jerga: nada de membership/credential/hash/prepared.
 */
export function accessStateLabel(state: string | undefined): string {
  switch (state) {
    case 'no-access': return 'Sin acceso';
    case 'pending-first-login': return 'Acceso listo, sin usar';
    case 'active-with-access': return 'Acceso activo';
    case 'active-without-access': return 'Activo, sin acceso';
    case 'suspended': return 'Desactivado';
    default: return 'Por revisar';
  }
}

/**
 * Mientras el overview todavía no llegó, no se asume nada: la fila no ofrece
 * ninguna acción de acceso (mejor un instante sin botón que un botón que el
 * backend va a rechazar).
 */
export function hasResolvedAccess(entry: TenantAccessEntry | undefined): entry is TenantAccessEntry {
  return !!entry && typeof entry.primaryAction === 'string';
}
