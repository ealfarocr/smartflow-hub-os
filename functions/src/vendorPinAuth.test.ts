import { describe, it, expect } from 'vitest';
import { checkVendorPinAuth, checkPinLoginAllowed, buildBreakGlassAuditEvent } from './vendorPinAuth';

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

describe('checkVendorPinAuth — rescate del SuperAdmin (break-glass, 2026-09-30)', () => {
  // Caso real de USADITOS: EDUARDO ADMIN es Owner ACTIVO y perdió su código;
  // el bootstrap no aplica (ya hay Owner activo) y nadie de adentro puede
  // regenerarlo. El SuperAdmin global sí, pidiéndolo explícitamente.
  const usaditos = {
    isSuperAdmin: true,
    callerMembership: null,
    targetMembershipRole: 'Owner',
    tenantHasActiveOwner: true,
  } as const;

  it('1. Owner/Admin activo del negocio puede regenerar por el camino normal', () => {
    const r = checkVendorPinAuth({ ...usaditos, isSuperAdmin: false, callerMembership: { status: 'active', role: 'Owner' } });
    expect(r.allowed).toBe(true);
    expect(r.via).toBe('tenant-admin');
  });

  it('2. Usuario común del tenant NO puede, ni pidiendo el rescate', () => {
    const r = checkVendorPinAuth({
      ...usaditos,
      isSuperAdmin: false,
      callerMembership: { status: 'active', role: 'Asesor Comercial' },
      breakGlass: true,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('no-active-admin');
  });

  it('3. SuperAdmin global CON pedido explícito -> ALLOW, marcado como break-glass', () => {
    const r = checkVendorPinAuth({ ...usaditos, breakGlass: true });
    expect(r.allowed).toBe(true);
    expect(r.via).toBe('break-glass');
  });

  it('4. SuperAdmin SIN pedido explícito sigue bloqueado: nada de rescates por accidente', () => {
    expect(checkVendorPinAuth({ ...usaditos }).allowed).toBe(false);
    expect(checkVendorPinAuth({ ...usaditos, breakGlass: false }).allowed).toBe(false);
  });

  it('5. El rescate no cruza tenants: sin membership del tenant objetivo, la única vía es la explícita', () => {
    // callerMembership viene de memberships/{uid}_{tenantIdObjetivo} y
    // tenantId se lee del doc de la membership objetivo: apuntar a otro
    // negocio exige nombrar una membership de ESE negocio.
    const otroTenant = checkVendorPinAuth({ ...usaditos, breakGlass: true, targetMembershipRole: 'Asesor Comercial' });
    expect(otroTenant.allowed).toBe(true);
    expect(otroTenant.via).toBe('break-glass');
    expect(checkVendorPinAuth({ ...usaditos, isSuperAdmin: false, breakGlass: true }).allowed).toBe(false);
  });
});

describe('buildBreakGlassAuditEvent — qué queda registrado', () => {
  const evento = buildBreakGlassAuditEvent({
    tenantId: 't-1788554584458',
    membershipId: 'Bw4GC41RiSQ1s3pw4RpypL2eEcz1_t-1788554584458',
    targetName: 'EDUARDO ADMIN',
    targetRole: 'Owner',
    performedByUid: 'qsiEuc1lBWUOkjUQRiYvsRf3Syn2',
    performedByEmail: 'superadmin@example.com',
    mode: 'regenerate',
  });

  it('7. registra quién, a quién, en qué negocio y por qué vía', () => {
    expect(evento.type).toBe('VENDOR_PIN_BREAK_GLASS');
    expect(evento.tenantId).toBe('t-1788554584458');
    expect(evento.membershipId).toBe('Bw4GC41RiSQ1s3pw4RpypL2eEcz1_t-1788554584458');
    expect(evento.performedByUid).toBe('qsiEuc1lBWUOkjUQRiYvsRf3Syn2');
    expect(evento.mode).toBe('regenerate');
  });

  it('8. nunca lleva código, hash ni salt', () => {
    const claves = Object.keys(evento).join(' ').toLowerCase();
    expect(claves).not.toMatch(/pin|hash|salt|secret|token/);
    expect(JSON.stringify(evento).toLowerCase()).not.toMatch(/pinhash|pinsalt|secrethash/);
  });

  it('acepta campos ausentes sin inventar datos (null explícito, nunca undefined)', () => {
    const minimo = buildBreakGlassAuditEvent({
      tenantId: 't-x', membershipId: 'm-x', performedByUid: 'u-x', mode: 'attach',
    });
    expect(minimo.targetName).toBeNull();
    expect(minimo.performedByEmail).toBeNull();
    expect(Object.values(minimo).every((v) => v !== undefined)).toBe(true);
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

  it('prepared/draft -> DENY (no tienen método de acceso configurado)', () => {
    for (const status of ['prepared', 'draft']) {
      const result = checkPinLoginAllowed({ membershipExists: true, membershipStatus: status });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('not-active');
    }
  });

  // Este test antes afirmaba lo contrario ('pending' -> DENY) y con eso
  // codificaba un bug real: setVendorPin deja la membership en 'pending' a
  // propósito, porque es el PRIMER signInWithCustomToken el que dispara
  // acceptTenantInvite y la activa. Exigir 'active' en el login hacía que ese
  // primer acceso se denegara y la membership nunca llegara a 'active' —
  // ningún vendedor nuevo podía entrar jamás.
  it('pending SIN userId -> ALLOW: es el primer acceso, el que activa la membership', () => {
    const result = checkPinLoginAllowed({ membershipExists: true, membershipStatus: 'pending', membershipUserId: null });
    expect(result.allowed).toBe(true);
  });

  it('pending CON userId -> DENY: ya fue activada alguna vez, este estado no es un primer acceso', () => {
    const result = checkPinLoginAllowed({ membershipExists: true, membershipStatus: 'pending', membershipUserId: 'uid-1' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('not-active');
  });

  it('suspendido CON userId -> DENY (desactivar conserva el userId, así que no se cuela por la puerta de pending)', () => {
    const result = checkPinLoginAllowed({ membershipExists: true, membershipStatus: 'suspended', membershipUserId: 'uid-1' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('not-active');
  });

  it('membership inexistente -> DENY con motivo distinto (no-membership, no not-active)', () => {
    const result = checkPinLoginAllowed({ membershipExists: false, membershipStatus: undefined });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no-membership');
  });
});
