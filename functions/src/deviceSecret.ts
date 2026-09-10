import * as crypto from 'crypto';

// CREDENCIAL DE DISPOSITIVO — lo que permite volver a entrar sin el código de
// acceso después de cerrar sesión.
//
// Por qué hace falta: al cerrar sesión, Firebase destruye el refresh token de
// ese navegador, y hasta ahora la única forma de emitir un token nuevo era el
// código. El deviceId NO puede cumplir ese rol: lo genera el propio cliente y
// vive en localStorage, así que no es un secreto — sirve para RECONOCER el
// equipo, nunca para probar quién es.
//
// El secreto sí lo es: 256 bits aleatorios generados en el SERVIDOR, devueltos
// al teléfono UNA sola vez al vincularse con el código. En Firestore solo se
// guarda su hash; el valor en claro nunca se persiste del lado del servidor.
// Es el mismo modelo que un refresh token (un bearer que vive en el equipo),
// con dos diferencias a favor: un Owner/Admin lo invalida revocando el
// dispositivo, y se rota en cada vinculación con código.
//
// Puro a propósito, para testearlo sin Firestore — mismo patrón que pinAuth.ts.

export const DEVICE_SECRET_BYTES = 32;

export function generateDeviceSecret(): string {
  return crypto.randomBytes(DEVICE_SECRET_BYTES).toString('base64url');
}

/**
 * sha256 con salt alcanza acá (a diferencia del PIN, que usa scrypt): el
 * secreto tiene 256 bits de entropía real, así que no hay espacio que
 * recorrer por fuerza bruta. El scrypt del PIN existe porque un PIN de 6
 * dígitos solo tiene un millón de valores posibles.
 */
export function hashDeviceSecret(secret: string, salt: string): string {
  return crypto.createHash('sha256').update(`${salt}:${secret}`).digest('hex');
}

export function verifyDeviceSecret(secret: string, salt: string, expectedHashHex: string): boolean {
  if (!secret || !salt || !expectedHashHex) return false;
  const actual = Buffer.from(hashDeviceSecret(secret, salt), 'hex');
  const expected = Buffer.from(expectedHashHex, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export interface DeviceLoginInput {
  deviceExists: boolean;
  deviceStatus: string | undefined;
  /** El dispositivo tiene una credencial vigente (no fue invalidada). */
  hasSecret: boolean;
  secretMatches: boolean;
  deviceTenantId: string | undefined;
  requestedTenantId: string;
  membershipExists: boolean;
  membershipStatus: string | undefined;
}

export type DeviceLoginDenyReason =
  | 'device-unknown'
  | 'device-revoked'
  | 'no-secret'
  | 'bad-secret'
  | 'wrong-tenant'
  | 'no-membership'
  | 'not-active';

export interface DeviceLoginResult {
  allowed: boolean;
  reason?: DeviceLoginDenyReason;
}

/**
 * Decide si una reentrada con credencial de dispositivo puede emitir sesión.
 * El orden importa solo para el motivo que se registra: la respuesta al
 * cliente es SIEMPRE el mismo error genérico, para no revelar si el equipo
 * existe, si fue revocado o si la persona fue desactivada.
 */
export function checkDeviceLogin(input: DeviceLoginInput): DeviceLoginResult {
  if (!input.deviceExists) return { allowed: false, reason: 'device-unknown' };
  if (input.deviceStatus === 'revoked') return { allowed: false, reason: 'device-revoked' };
  if (!input.hasSecret) return { allowed: false, reason: 'no-secret' };
  if (!input.secretMatches) return { allowed: false, reason: 'bad-secret' };
  if (input.deviceTenantId !== input.requestedTenantId) return { allowed: false, reason: 'wrong-tenant' };
  if (!input.membershipExists) return { allowed: false, reason: 'no-membership' };
  if (input.membershipStatus !== 'active') return { allowed: false, reason: 'not-active' };
  return { allowed: true };
}
