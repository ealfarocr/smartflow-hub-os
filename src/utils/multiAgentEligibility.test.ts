import { describe, it, expect } from 'vitest';
import { isEligibleForAutoLeads, isEligibleRightNow, isEligibleForManualClaim, getMemberIdentifier } from './multiAgentEligibility';

// LOOP Fase 20 — casos 1-8 (elegibilidad automática) usan isEligibleRightNow
// (espejo EXACTO de assignConversationAdvisor: status + included + leadEnabled
// + operationalStatus). isEligibleForAutoLeads es la base de CONFIGURACIÓN
// (sin operationalStatus) que usa toggleLeadEnabled — se prueba aparte para
// no perder cobertura del bug que motivó separarla (ver comentario en el
// archivo fuente).

const baseConfig = { includedUserIds: ['u1'], leadEnabledUserIds: null as string[] | null };

describe('isEligibleRightNow — asignación automática (Fase 20, casos 1-8)', () => {
  it('caso 1: active + working -> elegible', () => {
    expect(isEligibleRightNow({ id: 'u1', userId: 'u1', status: 'active', operationalStatus: 'working' }, baseConfig)).toBe(true);
  });
  it('caso 2: active + lunch -> no elegible', () => {
    expect(isEligibleRightNow({ id: 'u1', userId: 'u1', status: 'active', operationalStatus: 'lunch' }, baseConfig)).toBe(false);
  });
  it('caso 3: active + coffee -> no elegible', () => {
    expect(isEligibleRightNow({ id: 'u1', userId: 'u1', status: 'active', operationalStatus: 'coffee' }, baseConfig)).toBe(false);
  });
  it('caso 4: active + errand -> no elegible', () => {
    expect(isEligibleRightNow({ id: 'u1', userId: 'u1', status: 'active', operationalStatus: 'errand' }, baseConfig)).toBe(false);
  });
  it('caso 5: active + off_shift -> no elegible', () => {
    expect(isEligibleRightNow({ id: 'u1', userId: 'u1', status: 'active', operationalStatus: 'off_shift' }, baseConfig)).toBe(false);
  });
  it('caso 6: prepared + working -> no elegible', () => {
    expect(isEligibleRightNow({ id: 'u1', userId: null, status: 'prepared', operationalStatus: 'working' }, baseConfig)).toBe(false);
  });
  it('caso 7: leadEnabled=false (excluido de la lista curada) + working -> no elegible', () => {
    const config = { includedUserIds: ['u1'], leadEnabledUserIds: [] as string[] };
    expect(isEligibleRightNow({ id: 'u1', userId: 'u1', status: 'active', operationalStatus: 'working' }, config)).toBe(false);
  });
  it('caso 8: incluido=false (no está en includedUserIds) + working -> no elegible', () => {
    const config = { includedUserIds: [] as string[], leadEnabledUserIds: null };
    expect(isEligibleRightNow({ id: 'u1', userId: 'u1', status: 'active', operationalStatus: 'working' }, config)).toBe(false);
  });

  it('sin operationalStatus todavía (undefined) = tratado como off_shift, nunca working por defecto (Fase 21)', () => {
    expect(isEligibleRightNow({ id: 'u1', userId: 'u1', status: 'active' }, baseConfig)).toBe(false);
  });
});

describe('isEligibleForAutoLeads — configuración (sin operationalStatus, base de toggleLeadEnabled)', () => {
  it('active + included, sin curar (leadEnabledUserIds null) -> true independientemente del estado operativo', () => {
    expect(isEligibleForAutoLeads({ id: 'u1', userId: 'u1', status: 'active', operationalStatus: 'lunch' }, baseConfig)).toBe(true);
  });
  it('no depende de operationalStatus — alguien en café sigue contando para la configuración', () => {
    const withLunch = isEligibleForAutoLeads({ id: 'u1', userId: 'u1', status: 'active', operationalStatus: 'lunch' }, baseConfig);
    const withWorking = isEligibleForAutoLeads({ id: 'u1', userId: 'u1', status: 'active', operationalStatus: 'working' }, baseConfig);
    expect(withLunch).toBe(withWorking);
  });
});

describe('isEligibleForManualClaim — Modo Libre (Fase 16, exige working)', () => {
  const claimConfig = { includedUserIds: ['u1'] };
  it('active + included + working -> puede reclamar', () => {
    expect(isEligibleForManualClaim({ id: 'u1', userId: 'u1', status: 'active', operationalStatus: 'working' }, claimConfig)).toBe(true);
  });
  it('active + included + coffee -> no puede reclamar', () => {
    expect(isEligibleForManualClaim({ id: 'u1', userId: 'u1', status: 'active', operationalStatus: 'coffee' }, claimConfig)).toBe(false);
  });
});

describe('getMemberIdentifier', () => {
  it('usa userId cuando existe', () => {
    expect(getMemberIdentifier({ id: 'm1', userId: 'u1', status: 'active' })).toBe('u1');
  });
  it('cae a membership.id cuando userId es null (prepared/draft/pending)', () => {
    expect(getMemberIdentifier({ id: 'm1', userId: null, status: 'prepared' })).toBe('m1');
  });
});
