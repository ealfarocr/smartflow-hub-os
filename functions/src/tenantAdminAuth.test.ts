import { describe, it, expect } from 'vitest';
import { checkTenantAdminAuth } from './tenantAdminAuth';

describe('checkTenantAdminAuth — reutilización de teléfonos corporativos (setMembershipActive)', () => {
  it('SuperAdmin sin membership -> ALLOW', () => {
    expect(checkTenantAdminAuth({ isSuperAdmin: true, callerMembership: null }).allowed).toBe(true);
  });

  it('Owner activo del mismo tenant -> ALLOW', () => {
    expect(checkTenantAdminAuth({ isSuperAdmin: false, callerMembership: { status: 'active', role: 'Owner' } }).allowed).toBe(true);
  });

  it('Admin activo del mismo tenant -> ALLOW', () => {
    expect(checkTenantAdminAuth({ isSuperAdmin: false, callerMembership: { status: 'active', role: 'Admin' } }).allowed).toBe(true);
  });

  it('Asesor Comercial activo -> DENY (no puede desactivar colegas)', () => {
    const r = checkTenantAdminAuth({ isSuperAdmin: false, callerMembership: { status: 'active', role: 'Asesor Comercial' } });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('no-active-admin');
  });

  it('Owner con membership no activa -> DENY', () => {
    expect(checkTenantAdminAuth({ isSuperAdmin: false, callerMembership: { status: 'suspended', role: 'Owner' } }).allowed).toBe(false);
  });

  it('sin membership y sin SuperAdmin -> DENY', () => {
    expect(checkTenantAdminAuth({ isSuperAdmin: false, callerMembership: null }).allowed).toBe(false);
  });

  it('tenant mismatch: sin membership EN ESTE tenant (aunque sea Owner activo en otro) -> DENY', () => {
    // El lookup real de callerMembership ya está scoped a
    // memberships/{uid}_{tenantId-objetivo} — una membership activa en OTRO
    // tenant nunca llega acá como no-null, así que este caso es
    // indistinguible de "sin membership en este tenant".
    expect(checkTenantAdminAuth({ isSuperAdmin: false, callerMembership: null }).allowed).toBe(false);
  });
});
