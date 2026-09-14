import { describe, it, expect } from 'vitest';
import { checkMembershipAuth, checkConversationTenantMatch, buildMetaErrorDetail } from './sendMessageAuth';

describe('checkMembershipAuth — fix outbound SuperAdmin (LOOP)', () => {
  it('1. SuperAdmin sin membership activa -> ALLOW', () => {
    const result = checkMembershipAuth({ isSuperAdmin: true, membership: null });
    expect(result.allowed).toBe(true);
  });

  it('2. Usuario normal sin membership -> DENY', () => {
    const result = checkMembershipAuth({ isSuperAdmin: false, membership: null });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no-active-membership');
  });

  it('2b. Usuario normal con membership pero status no activa -> DENY', () => {
    const result = checkMembershipAuth({ isSuperAdmin: false, membership: { status: 'prepared', role: 'Owner' } });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no-active-membership');
  });

  it('3. Usuario normal con membership activa y rol permitido -> ALLOW', () => {
    const result = checkMembershipAuth({ isSuperAdmin: false, membership: { status: 'active', role: 'Asesor Comercial' } });
    expect(result.allowed).toBe(true);
  });

  it('4. Rol Solo lectura -> DENY', () => {
    const result = checkMembershipAuth({ isSuperAdmin: false, membership: { status: 'active', role: 'Solo lectura' } });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('read-only-role');
  });

  it('SuperAdmin con membership Solo lectura igual entra por el bypass (rol no importa para SuperAdmin)', () => {
    const result = checkMembershipAuth({ isSuperAdmin: true, membership: { status: 'active', role: 'Solo lectura' } });
    expect(result.allowed).toBe(true);
  });
});

describe('checkConversationTenantMatch — guard cross-tenant (se preserva, aplica también a SuperAdmin)', () => {
  it('5. Tenant de la conversación coincide con el solicitado -> true', () => {
    expect(checkConversationTenantMatch('t-usaditos', 't-usaditos')).toBe(true);
  });

  it('7. Conversation tenant mismatch -> false (usuario normal)', () => {
    expect(checkConversationTenantMatch('t-otro-negocio', 't-usaditos')).toBe(false);
  });

  it('6. SuperAdmin cross-tenant -> DENY (checkMembershipAuth permite por bypass, pero checkConversationTenantMatch igual bloquea — este checkpoint no distingue SuperAdmin, aplica a todos igual)', () => {
    const membershipStep = checkMembershipAuth({ isSuperAdmin: true, membership: null });
    expect(membershipStep.allowed).toBe(true); // pasa el checkpoint 1 (bypass)
    const tenantStep = checkConversationTenantMatch('t-otro-negocio', 't-usaditos');
    expect(tenantStep).toBe(false); // pero el checkpoint 2 lo bloquea igual
  });
});

describe('buildMetaErrorDetail — P0 USADITOS 2026-09-14: subcode ausente no debe crashear la persistencia', () => {
  it('Meta manda error_subcode -> se preserva tal cual', () => {
    const detail = buildMetaErrorDetail(400, { type: 'OAuthException', code: 190, error_subcode: 463, fbtrace_id: 'abc123' });
    expect(detail).toEqual({ httpStatus: 400, type: 'OAuthException', code: 190, subcode: 463, fbtraceId: 'abc123' });
  });

  it('reproduce el caso real de hoy: OAuthException code:1 sin error_subcode -> subcode:null, nunca undefined', () => {
    const detail = buildMetaErrorDetail(500, { type: 'OAuthException', code: 1, fbtrace_id: 'Aosj6mgEU-FaB_PJA5SycIU' });
    expect(detail.subcode).toBe(null);
    expect(detail.subcode).not.toBe(undefined);
    expect(detail).toEqual({ httpStatus: 500, type: 'OAuthException', code: 1, subcode: null, fbtraceId: 'Aosj6mgEU-FaB_PJA5SycIU' });
  });

  it('bodyData.error viene undefined (respuesta HTTP sin cuerpo de error parseable) -> todos los campos quedan null, nunca undefined', () => {
    const detail = buildMetaErrorDetail(500, undefined);
    expect(Object.values(detail)).not.toContain(undefined);
    expect(detail).toEqual({ httpStatus: 500, type: null, code: null, subcode: null, fbtraceId: null });
  });

  it('ningún campo del resultado es undefined bajo ninguna combinación — es justamente lo que Firestore rechaza', () => {
    const cases = [
      { type: 'X', code: 1 },
      { code: 1, error_subcode: 2 },
      {},
    ];
    for (const c of cases) {
      const detail = buildMetaErrorDetail(500, c);
      for (const v of Object.values(detail)) {
        expect(v).not.toBe(undefined);
      }
    }
  });
});

// 8. Integration tenant mismatch -> DENY: no existe una función pura separada
// para este caso porque no hace falta — sendWhatsappMessage (index.ts, paso 3)
// obtiene la integración con `.where('tenantId', '==', tenantId)`, por lo que
// es estructuralmente imposible que integrationSnapshot.docs[0] pertenezca a
// un tenant distinto al solicitado. Verificado por lectura de código, no por
// test unitario (no hay lógica de decisión que testear, es una propiedad de
// la query de Firestore).
