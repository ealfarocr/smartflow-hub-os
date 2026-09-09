import { describe, it, expect } from 'vitest';
import { checkVendorPinAuth, checkPinLoginAllowed } from './vendorPinAuth';

describe('checkVendorPinAuth — bootstrap del primer Owner (LOOP DE EMERGENCIA)', () => {
  it('1. 0 Owners activos + SuperAdmin bootstrapeando un Owner -> ALLOW', () => {
    const result = checkVendorPinAuth({
      isSuperAdmin: true,
      callerMembership: null,
      targetMembershipRole: 'Owner',
      tenantHasActiveOwner: false,
    });
    expect(result.allowed).toBe(true);
  });

  it('2. 0 Owners activos + usuario normal (no SuperAdmin, sin membership) -> DENY', () => {
    const result = checkVendorPinAuth({
      isSuperAdmin: false,
      callerMembership: null,
      targetMembershipRole: 'Owner',
      tenantHasActiveOwner: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no-active-admin');
  });

  it('3. Ya existe un Owner activo + SuperAdmin intentando el bootstrap especial -> DENY (usar flujo normal)', () => {
    const result = checkVendorPinAuth({
      isSuperAdmin: true,
      callerMembership: null,
      targetMembershipRole: 'Owner',
      tenantHasActiveOwner: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no-active-admin');
  });

  it('4. Tenant mismatch: el caller tiene membership activa de Owner en OTRO tenant (acá llega null) -> DENY', () => {
    // La consulta real que resuelve `callerMembership` es
    // memberships/{uid}_{tenantId} del tenant OBJETIVO — una membership
    // activa en un tenant distinto nunca se filtra hasta acá como no-null,
    // así que este caso es indistinguible de "sin membership en este tenant".
    const result = checkVendorPinAuth({
      isSuperAdmin: false,
      callerMembership: null, // no existe memberships/{uid}_{tenantId-objetivo}
      targetMembershipRole: 'Owner',
      tenantHasActiveOwner: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no-active-admin');
  });

  it('5. Bootstrap NO aplica a un vendedor común (solo a Owner) aunque no haya Owners activos', () => {
    const result = checkVendorPinAuth({
      isSuperAdmin: true,
      callerMembership: null,
      targetMembershipRole: 'Asesor Comercial',
      tenantHasActiveOwner: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no-active-admin');
  });

  it('6. Owner activo real (flujo normal, sin necesidad de bootstrap) -> ALLOW', () => {
    const result = checkVendorPinAuth({
      isSuperAdmin: false,
      callerMembership: { status: 'active', role: 'Owner' },
      targetMembershipRole: 'Asesor Comercial',
      tenantHasActiveOwner: true,
    });
    expect(result.allowed).toBe(true);
  });

  it('7. Admin activo real (flujo normal) -> ALLOW', () => {
    const result = checkVendorPinAuth({
      isSuperAdmin: false,
      callerMembership: { status: 'active', role: 'Admin' },
      targetMembershipRole: 'Asesor Comercial',
      tenantHasActiveOwner: true,
    });
    expect(result.allowed).toBe(true);
  });

  it('8. Membership existente pero no activa (prepared) -> DENY, ni siquiera para sí mismo', () => {
    const result = checkVendorPinAuth({
      isSuperAdmin: false,
      callerMembership: { status: 'prepared', role: 'Owner' },
      targetMembershipRole: 'Owner',
      tenantHasActiveOwner: false,
    });
    expect(result.allowed).toBe(false);
  });
});

describe('checkPinLoginAllowed — reutilización de teléfonos corporativos (loginWithPin)', () => {
  it('membership activa -> ALLOW', () => {
    const result = checkPinLoginAllowed({ membershipExists: true, membershipStatus: 'active' });
    expect(result.allowed).toBe(true);
  });

  it('membership desactivada (suspended) -> DENY — el caso real: Michelle no debe poder loguearse tras ser desactivada', () => {
    const result = checkPinLoginAllowed({ membershipExists: true, membershipStatus: 'suspended' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('not-active');
  });

  it('membership en cualquier otro estado no-activo (prepared/draft/pending) -> DENY', () => {
    for (const status of ['prepared', 'draft', 'pending']) {
      const result = checkPinLoginAllowed({ membershipExists: true, membershipStatus: status });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('not-active');
    }
  });

  it('membership inexistente -> DENY con motivo distinto (no-membership, no not-active)', () => {
    const result = checkPinLoginAllowed({ membershipExists: false, membershipStatus: undefined });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no-membership');
  });
});
