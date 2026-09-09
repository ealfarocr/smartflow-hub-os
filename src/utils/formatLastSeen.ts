// Formatea "última actividad" a partir de lo que realmente puede llegar en
// user_presence.lastActiveAt: un string ISO (usePresenceTracker escribe
// `new Date(...).toISOString()`), un Firestore Timestamp (`.toDate()`), o
// directamente nada — antes `new Date(undefined)` producía un Invalid Date
// silencioso que terminaba mostrándose tal cual ("Visto el Invalid Date").
export type PresenceTimestampLike = string | number | { toDate: () => Date } | null | undefined;

function toSafeDate(value: PresenceTimestampLike): Date | null {
  if (value == null) return null;
  if (typeof value === 'object') {
    if (typeof value.toDate !== 'function') return null;
    const d = value.toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * `now` es un parámetro (default `new Date()`) en vez de leerlo adentro
 * para que esto sea determinístico en tests, sin depender del reloj real.
 */
export function formatLastSeen(value: PresenceTimestampLike, now: Date = new Date()): string {
  const date = toSafeDate(value);
  if (!date) return 'Sin actividad registrada';

  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000);
  // diffMin negativo (reloj del cliente ligeramente adelantado respecto al
  // servidor) no debe mostrar "hace -1 min" — se trata igual que "ahora".
  if (diffMin < 2) return 'Activo ahora';
  if (diffMin < 60) return `Visto hace ${diffMin} min`;

  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Visto hace ${diffH}h`;

  return `Visto el ${date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`;
}
