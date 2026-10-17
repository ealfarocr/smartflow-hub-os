import { describe, it, expect } from 'vitest';
import { buildWaQaFailure, isWindow24hActive } from './liveVideoWhatsapp';

const H = 3600 * 1000;

describe('isWindow24hActive', () => {
  it('activa dentro de 24 h, inactiva después', () => {
    const now = Date.now();
    expect(isWindow24hActive(now - 23 * H, now)).toBe(true);
    expect(isWindow24hActive(now - 24 * H, now)).toBe(true);
    expect(isWindow24hActive(now - 24 * H - 1, now)).toBe(false);
    expect(isWindow24hActive(now - 49 * H, now)).toBe(false);
  });
  it('sin inbound conocido => inactiva', () => {
    expect(isWindow24hActive(null, Date.now())).toBe(false);
  });
});

describe('buildWaQaFailure', () => {
  it('mapea los campos de Meta y rellena faltantes con "—"', () => {
    const f = buildWaQaFailure('boom', { httpStatus: 400, code: 131053, subcode: null, type: 'OAuthException', fbtraceId: 'AbC' });
    expect(f).toEqual({ http: '400', code: '131053', subcode: '—', type: 'OAuthException', message: 'boom', fbtraceId: 'AbC' });
  });
  it('sin metaError ni mensaje no revienta', () => {
    expect(buildWaQaFailure(undefined, undefined).message).toBe('—');
  });
});
