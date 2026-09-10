import { describe, it, expect } from 'vitest';
import {
  generateDeviceSecret,
  hashDeviceSecret,
  verifyDeviceSecret,
  checkDeviceLogin,
  DEVICE_SECRET_BYTES,
  type DeviceLoginInput,
} from './deviceSecret';

describe('Credencial de dispositivo', () => {
  it('tiene 256 bits de entropía real y no se repite', () => {
    const a = generateDeviceSecret();
    const b = generateDeviceSecret();
    expect(Buffer.from(a, 'base64url').length).toBe(DEVICE_SECRET_BYTES);
    expect(a).not.toBe(b);
  });

  it('el hash verifica el secreto correcto', () => {
    const secret = generateDeviceSecret();
    const hash = hashDeviceSecret(secret, 'sal-1');
    expect(verifyDeviceSecret(secret, 'sal-1', hash)).toBe(true);
  });

  it('un secreto distinto NO verifica', () => {
    const hash = hashDeviceSecret(generateDeviceSecret(), 'sal-1');
    expect(verifyDeviceSecret(generateDeviceSecret(), 'sal-1', hash)).toBe(false);
  });

  it('la misma credencial con otra sal NO verifica', () => {
    const secret = generateDeviceSecret();
    expect(verifyDeviceSecret(secret, 'sal-2', hashDeviceSecret(secret, 'sal-1'))).toBe(false);
  });

  it('valores vacíos nunca verifican (no hay credencial vacía válida)', () => {
    expect(verifyDeviceSecret('', 'sal', 'abc')).toBe(false);
    expect(verifyDeviceSecret('x', '', 'abc')).toBe(false);
    expect(verifyDeviceSecret('x', 'sal', '')).toBe(false);
  });

  it('el deviceId solo NO alcanza: sin el secreto no hay hash que verifique', () => {
    // El caso que motiva todo esto: un deviceId es público. Conocerlo no debe
    // bastar para entrar.
    const hash = hashDeviceSecret(generateDeviceSecret(), 'sal');
    expect(verifyDeviceSecret('telefono-corporativo-1', 'sal', hash)).toBe(false);
  });
});

const ok: DeviceLoginInput = {
  deviceExists: true,
  deviceStatus: 'active',
  hasSecret: true,
  secretMatches: true,
  deviceTenantId: 't-usaditos',
  requestedTenantId: 't-usaditos',
  membershipExists: true,
  membershipStatus: 'active',
};

describe('Reentrada sin código tras cerrar sesión', () => {
  it('equipo reconocido + credencial correcta + persona activa -> entra', () => {
    expect(checkDeviceLogin(ok).allowed).toBe(true);
  });

  const casos: [string, Partial<DeviceLoginInput>, string][] = [
    ['equipo desconocido', { deviceExists: false }, 'device-unknown'],
    ['equipo revocado por el Owner', { deviceStatus: 'revoked' }, 'device-revoked'],
    ['credencial invalidada (código regenerado)', { hasSecret: false }, 'no-secret'],
    ['credencial incorrecta', { secretMatches: false }, 'bad-secret'],
    ['equipo de otro negocio', { deviceTenantId: 't-otro' }, 'wrong-tenant'],
    ['sin membership en el negocio', { membershipExists: false }, 'no-membership'],
    ['persona desactivada', { membershipStatus: 'suspended' }, 'not-active'],
    ['persona sin activar todavía', { membershipStatus: 'pending' }, 'not-active'],
  ];

  casos.forEach(([label, override, reason]) => {
    it(`${label} -> DENY (${reason})`, () => {
      const r = checkDeviceLogin({ ...ok, ...override });
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe(reason);
    });
  });
});
