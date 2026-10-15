import { describe, it, expect } from 'vitest';
import { canAccessLiveVideoQa, LIVE_VIDEO_QA_TESTER_UID } from './liveVideoQaAccess';

describe('canAccessLiveVideoQa', () => {
  it('SuperAdmin → permitido', () => expect(canAccessLiveVideoQa({ id: 'x', isSuperAdmin: true })).toBe(true));
  it('UID QA exacto → permitido', () => expect(canAccessLiveVideoQa({ id: LIVE_VIDEO_QA_TESTER_UID })).toBe(true));
  it('vendedor / otro uid → bloqueado', () => expect(canAccessLiveVideoQa({ id: 'vendedor1', isSuperAdmin: false })).toBe(false));
  it('sin usuario → bloqueado', () => {
    expect(canAccessLiveVideoQa(null)).toBe(false);
    expect(canAccessLiveVideoQa({})).toBe(false);
  });
});
