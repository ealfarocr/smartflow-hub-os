import { describe, it, expect } from 'vitest';
import {
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_STALE_THRESHOLD_MS,
  resolvePresenceStatus,
  resolveOperationalStatus,
  isImpersonatingTenant,
} from './presenceStatus';

const NOW = new Date('2026-10-12T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const FRESH = ago(PRESENCE_HEARTBEAT_MS);
const STALE = ago(PRESENCE_STALE_THRESHOLD_MS + 1000);

describe('resolvePresenceStatus', () => {
  it('umbral = 3 heartbeats de 60s', () => {
    expect(PRESENCE_STALE_THRESHOLD_MS).toBe(180_000);
  });
  it('heartbeat reciente + online => online', () => {
    expect(resolvePresenceStatus({ status: 'online', lastSeenAt: FRESH }, NOW)).toBe('online');
  });
  it('heartbeat reciente + idle => idle', () => {
    expect(resolvePresenceStatus({ status: 'idle', lastSeenAt: FRESH }, NOW)).toBe('idle');
  });
  it('heartbeat vencido + online => offline', () => {
    expect(resolvePresenceStatus({ status: 'online', lastSeenAt: STALE }, NOW)).toBe('offline');
  });
  it('heartbeat vencido + idle => offline', () => {
    expect(resolvePresenceStatus({ status: 'idle', lastSeenAt: STALE }, NOW)).toBe('offline');
  });
  it('justo en el umbral sigue vivo', () => {
    expect(resolvePresenceStatus({ status: 'online', lastSeenAt: ago(PRESENCE_STALE_THRESHOLD_MS) }, NOW)).toBe('online');
  });
  it('sin documento / null / undefined => offline', () => {
    expect(resolvePresenceStatus(undefined, NOW)).toBe('offline');
    expect(resolvePresenceStatus(null, NOW)).toBe('offline');
  });
  it('sin lastSeenAt o ilegible => offline', () => {
    expect(resolvePresenceStatus({ status: 'online' }, NOW)).toBe('offline');
    expect(resolvePresenceStatus({ status: 'online', lastSeenAt: 'basura' }, NOW)).toBe('offline');
    expect(resolvePresenceStatus({ status: 'online', lastSeenAt: null }, NOW)).toBe('offline');
  });
  it('acepta Timestamp de Firestore y epoch numérico', () => {
    expect(resolvePresenceStatus({ status: 'online', lastSeenAt: { toDate: () => new Date(FRESH) } }, NOW)).toBe('online');
    expect(resolvePresenceStatus({ status: 'online', lastSeenAt: { toDate: () => new Date(STALE) } }, NOW)).toBe('offline');
    expect(resolvePresenceStatus({ status: 'idle', lastSeenAt: NOW.getTime() - 1000 }, NOW)).toBe('idle');
  });
  it('reloj inválido => offline', () => {
    expect(resolvePresenceStatus({ status: 'online', lastSeenAt: FRESH }, new Date('x'))).toBe('offline');
  });
  it('lastSeenAt en el futuro (reloj adelantado) => vivo', () => {
    expect(resolvePresenceStatus({ status: 'online', lastSeenAt: ago(-30_000) }, NOW)).toBe('online');
  });
  it('status offline explícito => offline aunque el latido sea reciente', () => {
    expect(resolvePresenceStatus({ status: 'offline', lastSeenAt: FRESH }, NOW)).toBe('offline');
  });
  it('cambio de tenant: presencia de otro tenant no se mezcla', () => {
    const p = { status: 'online' as const, tenantId: 't-A', lastSeenAt: FRESH };
    expect(resolvePresenceStatus(p, NOW, 't-A')).toBe('online');
    expect(resolvePresenceStatus(p, NOW, 't-B')).toBe('offline');
  });
});

describe('resolveOperationalStatus — turno independiente de la presencia', () => {
  it('working + presencia vencida sigue working', () => {
    const p = { status: 'online' as const, lastSeenAt: STALE, operationalStatus: 'working' as const };
    expect(resolvePresenceStatus(p, NOW)).toBe('offline');
    expect(resolveOperationalStatus(p)).toBe('working');
  });
  it('sin documento o sin campo => off_shift', () => {
    expect(resolveOperationalStatus(undefined)).toBe('off_shift');
    expect(resolveOperationalStatus({})).toBe('off_shift');
  });
  it('turno de otro tenant no se mezcla', () => {
    expect(resolveOperationalStatus({ operationalStatus: 'working', tenantId: 't-A' } as never, 't-B')).toBe('off_shift');
  });
});

describe('isImpersonatingTenant', () => {
  it('SuperAdmin impersonando (marca visual) => true', () => {
    expect(isImpersonatingTenant('USADITOS CR', { id: 'impersonated_t-1' })).toBe(true);
  });
  it('membresía sintética sin nombre => true', () => {
    expect(isImpersonatingTenant(null, { id: 'impersonated_t-1' })).toBe(true);
  });
  it('Owner / Admin / Asesor reales => false (mantienen selector)', () => {
    for (const id of ['uidOwner_t-1', 'uidAdmin_t-1', 'uidAsesor_t-1', 'pwaKTckoj5HDmYFxhQFP']) {
      expect(isImpersonatingTenant(null, { id })).toBe(false);
    }
  });
  it('sin membresía => false', () => {
    expect(isImpersonatingTenant(null, null)).toBe(false);
  });
});
