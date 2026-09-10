import { describe, it, expect } from 'vitest';
import {
  resolveAccessState,
  resolveAccessActionsFor,
  checkSetVendorPinTransition,
} from './accessLifecycle';

// Caso real reproducido: `eduardo pruebas` en USADITOS (t-1788554584458) —
// membership 'active', EN LÍNEA, trabajando, pero su vendor_credentials había
// quedado guardado bajo el ID de membership ANTERIOR a que acceptTenantInvite
// la re-indexara. La UI mostraba "PIN no configurado" y setVendorPin
// respondía "Esta membresía ya tiene un método de acceso configurado (no es
// prepared/draft)": un estado sin salida.
describe('Estado muerto reportado: active + sin credencial resoluble', () => {
  const input = { status: 'active', userId: 'nqjpQTo7teOOsJNoog5EsLQXfKt1', hasCredential: false };

  it('el estado se nombra explícitamente, no queda en unknown', () => {
    expect(resolveAccessState(input)).toBe('active-without-access');
  });

  it('la acción principal es "generar acceso" — nunca un callejón sin salida', () => {
    expect(resolveAccessActionsFor(input).primary).toBe('generate');
  });

  it('setVendorPin LO PERMITE, en modo attach (reusa el uid de Auth que ya existe)', () => {
    const t = checkSetVendorPinTransition(input);
    expect(t.allowed).toBe(true);
    expect(t.mode).toBe('attach');
  });
});

describe('Transiciones obligatorias del ciclo de acceso', () => {
  it('prepared + Owner -> generar PIN ALLOW (bootstrap: todavía no hay cuenta técnica)', () => {
    const t = checkSetVendorPinTransition({ status: 'prepared', userId: null, hasCredential: false });
    expect(t.allowed).toBe(true);
    expect(t.mode).toBe('bootstrap');
  });

  it('draft -> generar PIN ALLOW (bootstrap)', () => {
    const t = checkSetVendorPinTransition({ status: 'draft', userId: null, hasCredential: false });
    expect(t.allowed).toBe(true);
    expect(t.mode).toBe('bootstrap');
  });

  it('active + PIN existente -> regenerar ALLOW', () => {
    const t = checkSetVendorPinTransition({ status: 'active', userId: 'uid-1', hasCredential: true });
    expect(t.allowed).toBe(true);
    expect(t.mode).toBe('regenerate');
  });

  it('pending con PIN generado y sin usar -> regenerar ALLOW (el Owner puede reemplazarlo antes del primer acceso)', () => {
    const input = { status: 'pending', userId: null, hasCredential: true };
    expect(resolveAccessState(input)).toBe('pending-first-login');
    const t = checkSetVendorPinTransition(input);
    expect(t.allowed).toBe(true);
    expect(t.mode).toBe('regenerate');
  });

  it('suspended -> generar PIN DENY, con motivo accionable (reactivar primero)', () => {
    const t = checkSetVendorPinTransition({ status: 'suspended', userId: 'uid-1', hasCredential: true });
    expect(t.allowed).toBe(false);
    expect(t.reason).toBe('suspended');
  });

  it('status desconocido -> DENY (nunca se asume permisivo)', () => {
    const t = checkSetVendorPinTransition({ status: 'algo-raro', userId: 'uid-1', hasCredential: true });
    expect(t.allowed).toBe(false);
    expect(t.reason).toBe('unknown-state');
  });
});

describe('Ningún estado queda sin acción posible (no hay callejones sin salida)', () => {
  const cases = [
    { label: 'prepared', input: { status: 'prepared', userId: null, hasCredential: false }, expected: 'generate' },
    { label: 'draft', input: { status: 'draft', userId: null, hasCredential: false }, expected: 'generate' },
    { label: 'pending sin PIN (invitación por correo)', input: { status: 'pending', userId: null, hasCredential: false }, expected: 'generate' },
    { label: 'pending con PIN sin usar', input: { status: 'pending', userId: null, hasCredential: true }, expected: 'copy' },
    { label: 'active con PIN', input: { status: 'active', userId: 'u', hasCredential: true }, expected: 'copy' },
    { label: 'active sin PIN', input: { status: 'active', userId: 'u', hasCredential: false }, expected: 'generate' },
    { label: 'suspended con PIN', input: { status: 'suspended', userId: 'u', hasCredential: true }, expected: 'reactivate' },
    { label: 'suspended sin PIN', input: { status: 'suspended', userId: 'u', hasCredential: false }, expected: 'reactivate-and-generate' },
    { label: 'inactive (baja)', input: { status: 'inactive', userId: 'u', hasCredential: true }, expected: 'reactivate' },
  ];

  cases.forEach(({ label, input, expected }) => {
    it(`${label} -> acción principal "${expected}"`, () => {
      expect(resolveAccessActionsFor(input).primary).toBe(expected);
    });
  });

  it('reactivar a alguien SIN PIN ofrece reactivar Y generar acceso en un solo paso — no lo deja activo y sin forma de entrar', () => {
    expect(resolveAccessActionsFor({ status: 'suspended', userId: 'u', hasCredential: false }).primary)
      .toBe('reactivate-and-generate');
  });

  it('tras reactivar a alguien cuyo PIN fue invalidado, puede generarse uno nuevo', () => {
    // suspended -> (reactivar) -> active sin credencial -> generar
    const reactivated = { status: 'active', userId: 'u', hasCredential: false };
    expect(resolveAccessActionsFor(reactivated).primary).toBe('generate');
    expect(checkSetVendorPinTransition(reactivated).allowed).toBe(true);
  });
});

describe('Regenerar solo se ofrece cuando de verdad hay un PIN que reemplazar', () => {
  it('con credencial -> canRegenerate true', () => {
    expect(resolveAccessActionsFor({ status: 'active', userId: 'u', hasCredential: true }).canRegenerate).toBe(true);
    expect(resolveAccessActionsFor({ status: 'pending', userId: null, hasCredential: true }).canRegenerate).toBe(true);
  });

  it('sin credencial -> canRegenerate false (no se ofrece reemplazar algo que no existe)', () => {
    expect(resolveAccessActionsFor({ status: 'active', userId: 'u', hasCredential: false }).canRegenerate).toBe(false);
    expect(resolveAccessActionsFor({ status: 'prepared', userId: null, hasCredential: false }).canRegenerate).toBe(false);
  });

  it('suspendido nunca ofrece regenerar directo (primero reactivar)', () => {
    expect(resolveAccessActionsFor({ status: 'suspended', userId: 'u', hasCredential: true }).canRegenerate).toBe(false);
  });
});
