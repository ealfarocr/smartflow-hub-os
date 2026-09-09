import { describe, it, expect } from 'vitest';
import { checkMembershipAuth, checkConversationTenantMatch } from './sendMessageAuth';

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

// 8. Integration tenant mismatch -> DENY: no existe una función pura separada
// para este caso porque no hace falta — sendWhatsappMessage (index.ts, paso 3)
// obtiene la integración con `.where('tenantId', '==', tenantId)`, por lo que
// es estructuralmente imposible que integrationSnapshot.docs[0] pertenezca a
// un tenant distinto al solicitado. Verificado por lectura de código, no por
// test unitario (no hay lógica de decisión que testear, es una propiedad de
// la query de Firestore).
