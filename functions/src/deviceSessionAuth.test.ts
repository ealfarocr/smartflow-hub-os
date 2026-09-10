import { describe, it, expect } from 'vitest';
import { checkDeviceQuickEntry, quickEntryFallback, type DeviceSessionInput } from './deviceSessionAuth';

const base: DeviceSessionInput = {
  membershipExists: true,
  membershipStatus: 'active',
  deviceExists: true,
  deviceStatus: 'active',
  deviceUserId: 'uid-eduardo',
  deviceTenantId: 't-usaditos',
  callerUid: 'uid-eduardo',
  tenantId: 't-usaditos',
};

describe('Entrada rápida: solo con TODO en regla', () => {
  it('dispositivo reconocido + membership activa -> ALLOW', () => {
    expect(checkDeviceQuickEntry(base).allowed).toBe(true);
  });
});

describe('Cada condición que falta cierra la puerta', () => {
  it('usuario desactivado -> DENY (desactivar tiene que cerrar TAMBIÉN esta puerta)', () => {
    const r = checkDeviceQuickEntry({ ...base, membershipStatus: 'suspended' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('not-active');
  });

  it('sin membership en este negocio -> DENY', () => {
    const r = checkDeviceQuickEntry({ ...base, membershipExists: false, membershipStatus: undefined });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('no-membership');
  });

  it('dispositivo revocado por un Owner/Admin -> DENY', () => {
    const r = checkDeviceQuickEntry({ ...base, deviceStatus: 'revoked' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('device-revoked');
  });

  it('dispositivo nunca registrado -> DENY (un deviceId inventado no abre nada)', () => {
    const r = checkDeviceQuickEntry({ ...base, deviceExists: false, deviceStatus: undefined, deviceUserId: undefined });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('device-unknown');
  });

  it('caso real del teléfono corporativo: el equipo quedó a nombre de otra persona -> DENY', () => {
    const r = checkDeviceQuickEntry({ ...base, deviceUserId: 'uid-michelle' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('device-of-another-user');
  });

  it('dispositivo registrado en OTRO negocio -> DENY', () => {
    const r = checkDeviceQuickEntry({ ...base, deviceTenantId: 't-otro-negocio' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('device-of-another-tenant');
  });

  it('pending/prepared tampoco entran por acá — solo "active"', () => {
    for (const status of ['pending', 'prepared', 'draft', 'inactive', undefined]) {
      expect(checkDeviceQuickEntry({ ...base, membershipStatus: status }).allowed).toBe(false);
    }
  });
});

describe('Qué hace la UI ante cada rechazo', () => {
  it('si la persona ya no está habilitada, no alcanza con pedir el código: hay que cerrar la sesión', () => {
    expect(quickEntryFallback('not-active')).toBe('sign-out');
    expect(quickEntryFallback('no-membership')).toBe('sign-out');
  });

  it('si el problema es el dispositivo, se pide el código de acceso (vinculación nueva)', () => {
    expect(quickEntryFallback('device-revoked')).toBe('require-code');
    expect(quickEntryFallback('device-unknown')).toBe('require-code');
    expect(quickEntryFallback('device-of-another-user')).toBe('require-code');
    expect(quickEntryFallback('device-of-another-tenant')).toBe('require-code');
  });

  it('ante un motivo desconocido, el fallback seguro es pedir el código', () => {
    expect(quickEntryFallback(undefined)).toBe('require-code');
  });
});
