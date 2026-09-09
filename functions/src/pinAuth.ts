import * as crypto from 'crypto';

// Helpers puros de PIN (LOOP dispositivo confiable) — extraídos a su propio
// módulo, sin efectos secundarios (nada de admin.initializeApp ni top-level
// execution), específicamente para poder testearlos con vitest sin importar
// el archivo index.ts completo (4000+ líneas, con inicializaciones reales de
// Firebase Admin/SendGrid al cargar el módulo).

export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCKOUT_MS = 15 * 60_000;
const PIN_SCRYPT_KEYLEN = 64;

export function hashPin(pin: string, salt: string): string {
  return crypto.scryptSync(pin, salt, PIN_SCRYPT_KEYLEN).toString('hex');
}

export function verifyPinHash(pin: string, salt: string, expectedHashHex: string): boolean {
  const actual = Buffer.from(hashPin(pin, salt), 'hex');
  const expected = Buffer.from(expectedHashHex, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export function generatePin(): string {
  // 6 dígitos, cada uno independiente — evita sesgo de módulo con randomInt(0,10) por dígito.
  let pin = '';
  for (let i = 0; i < 6; i++) pin += crypto.randomInt(0, 10).toString();
  return pin;
}

// Normaliza un nombre a un handle de login corto y estable ("Michelle" ->
// "michelle") — el vendedor solo ve "Michelle"/PIN (checkpoint de
// seguridad), nunca un membershipId. Único DENTRO de un tenant, no
// globalmente: login_handles/{tenantId}_{handle} es el índice de
// resolución (ver setVendorPin/loginWithPin en index.ts). Mismo criterio de
// transliteración que slugifyTenantId (src/utils/slug.ts) para consistencia.
export function normalizeLoginHandle(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 30);
}

// Clave de resolución "usuario visible dentro de un tenant" — la MISMA
// composición que usan setVendorPin/loginWithPin para el doc id de
// login_handles. Extraída acá para poder probar de forma determinística que
// "michelle" en dos tenants distintos produce claves distintas (no hay
// unicidad global de username, solo por tenant).
export function loginHandleKey(tenantId: string, rawHandle: string): string {
  return `${tenantId}_${normalizeLoginHandle(rawHandle)}`;
}

// Mensaje ÚNICO para "usuario no existe" y "PIN incorrecto" — checkpoint de
// seguridad: nunca revelar por mensaje si un nombre de usuario existe en un
// tenant. Exportado (no solo usado en index.ts) para poder testear que de
// verdad es la MISMA constante en ambos caminos, no dos strings iguales por
// coincidencia que alguien podría desincronizar en un cambio futuro.
export const PIN_LOGIN_GENERIC_ERROR = 'Usuario o PIN incorrecto.';

// Hash/salt fijos SOLO para absorber el costo de scrypt cuando el usuario no
// existe — mismo tiempo de cómputo que una verificación real, para que la
// latencia de la respuesta no delate por sí sola que ese usuario no existe.
export const DUMMY_PIN_SALT = 'dummy-salt-constant-cost-only';
export const DUMMY_PIN_HASH = hashPin('000000', DUMMY_PIN_SALT);
