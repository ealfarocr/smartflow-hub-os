import { toSafeDate, type PresenceTimestampLike } from '@/utils/formatLastSeen';
import type { Membership, OperationalStatus, UserPresence } from '@/types';

// usePresenceTracker escribe user_presence.lastSeenAt cada 60s (setInterval)
// además de en cada cambio de ruta. Fuente única: el hook importa esta
// constante, así el umbral de abajo no puede divergir del heartbeat real.
export const PRESENCE_HEARTBEAT_MS = 60 * 1000;

// 3 heartbeats: tolera 1 latido perdido (red lenta, pestaña en segundo plano
// con timers acelerados) más el desfase entre el reloj del cliente que escribe
// y el que lee. Menos de eso parpadearía "Offline" con pestañas abiertas;
// mucho más dejaría a alguien que cerró la pestaña como conectado.
export const PRESENCE_STALE_THRESHOLD_MS = 3 * PRESENCE_HEARTBEAT_MS;

export type ResolvedPresence = 'online' | 'idle' | 'offline';

type PresenceLike = Partial<Pick<UserPresence, 'status' | 'tenantId'>> & {
  lastSeenAt?: PresenceTimestampLike;
};

/**
 * Presencia técnica derivada SOLO en lectura: nadie escribe 'offline' en
 * Firestore (cerrar la pestaña no dispara nada fiable), así que un
 * status='online'|'idle' con lastSeenAt vencido se muestra como offline.
 * No toca operationalStatus (turno) — son dimensiones independientes.
 *
 * `expectedTenantId` evita mezclar presencia de otro tenant mientras el store
 * aún conserva el mapa del negocio anterior tras un cambio de tenant.
 */
export function resolvePresenceStatus(
  presence: PresenceLike | null | undefined,
  now: Date = new Date(),
  expectedTenantId?: string,
): ResolvedPresence {
  if (!presence) return 'offline';
  if (expectedTenantId && presence.tenantId && presence.tenantId !== expectedTenantId) return 'offline';
  if (presence.status !== 'online' && presence.status !== 'idle') return 'offline';

  const lastSeen = toSafeDate(presence.lastSeenAt);
  const nowMs = now.getTime();
  // Sin lastSeenAt legible o reloj inválido: no hay evidencia de vida.
  if (!lastSeen || Number.isNaN(nowMs)) return 'offline';
  // Reloj del cliente escritor adelantado (diff negativo) = latido reciente.
  if (nowMs - lastSeen.getTime() > PRESENCE_STALE_THRESHOLD_MS) return 'offline';
  return presence.status;
}

/** Turno: nunca depende de la presencia técnica. Sin dato = off_shift. */
export function resolveOperationalStatus(
  presence: Pick<UserPresence, 'operationalStatus'> | null | undefined,
  expectedTenantId?: string,
): OperationalStatus {
  if (!presence) return 'off_shift';
  const p = presence as Partial<UserPresence>;
  if (expectedTenantId && p.tenantId && p.tenantId !== expectedTenantId) return 'off_shift';
  return presence.operationalStatus || 'off_shift';
}

/**
 * SuperAdmin viendo un negocio ajeno: no es miembro real ni tiene turno ahí.
 * Dos señales: la marca visual del authStore y la membresía sintética.
 */
export function isImpersonatingTenant(
  impersonatedName: string | null | undefined,
  activeMembership: Pick<Membership, 'id'> | null | undefined,
): boolean {
  return !!impersonatedName || !!activeMembership?.id?.startsWith('impersonated_');
}
