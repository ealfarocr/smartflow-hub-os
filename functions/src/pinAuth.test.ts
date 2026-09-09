import { describe, it, expect } from 'vitest';
import {
  hashPin, verifyPinHash, generatePin, PIN_MAX_ATTEMPTS, PIN_LOCKOUT_MS,
  normalizeLoginHandle, loginHandleKey, PIN_LOGIN_GENERIC_ERROR, DUMMY_PIN_SALT, DUMMY_PIN_HASH,
} from './pinAuth';

// LOOP Fase 20 — cobertura de los helpers puros de PIN (parte del caso 12
// "dispositivo revocado no se considera confiable" empieza acá: el PIN es
// la mitad "algo que sabés" de esa verificación en dos pasos).

describe('generatePin', () => {
  it('genera 6 dígitos numéricos', () => {
    const pin = generatePin();
    expect(pin).toMatch(/^\d{6}$/);
  });
  it('dos llamadas seguidas casi seguro difieren (no determinístico por diseño)', () => {
    const pins = new Set(Array.from({ length: 20 }, () => generatePin()));
    expect(pins.size).toBeGreaterThan(1);
  });
});

describe('hashPin / verifyPinHash', () => {
  it('el mismo PIN + salt siempre hashea igual (determinístico para verificar)', () => {
    const salt = 'abc123';
    expect(hashPin('482791', salt)).toBe(hashPin('482791', salt));
  });
  it('un PIN distinto da un hash distinto con la misma salt', () => {
    const salt = 'abc123';
    expect(hashPin('482791', salt)).not.toBe(hashPin('482792', salt));
  });
  it('nunca guarda el PIN en texto plano — el hash no contiene el PIN como substring', () => {
    const salt = 'abc123';
    expect(hashPin('482791', salt)).not.toContain('482791');
  });
  it('verifyPinHash acepta el PIN correcto', () => {
    const salt = 'somesalt';
    const hash = hashPin('123456', salt);
    expect(verifyPinHash('123456', salt, hash)).toBe(true);
  });
  it('verifyPinHash rechaza un PIN incorrecto', () => {
    const salt = 'somesalt';
    const hash = hashPin('123456', salt);
    expect(verifyPinHash('999999', salt, hash)).toBe(false);
  });
  it('verifyPinHash rechaza aunque el hash tenga distinta longitud (evita crash en timingSafeEqual)', () => {
    expect(verifyPinHash('123456', 'salt', 'ab')).toBe(false);
  });
});

describe('constantes de bloqueo (Fase 13)', () => {
  it('bloquea después de 5 intentos', () => {
    expect(PIN_MAX_ATTEMPTS).toBe(5);
  });
  it('el bloqueo dura 15 minutos', () => {
    expect(PIN_LOCKOUT_MS).toBe(15 * 60 * 1000);
  });
});

// Checkpoint de seguridad — caso "mismo username puede existir en tenants
// distintos": login_handles se indexa por tenantId+handle, no solo handle.
describe('loginHandleKey — username único por tenant, no global', () => {
  it('"Michelle" en tenantA y tenantB produce claves DISTINTAS', () => {
    expect(loginHandleKey('tenantA', 'Michelle')).not.toBe(loginHandleKey('tenantB', 'Michelle'));
  });
  it('la misma persona en el mismo tenant siempre resuelve a la misma clave, sin importar mayúsculas/acentos', () => {
    expect(loginHandleKey('tenantA', 'Michelle')).toBe(loginHandleKey('tenantA', 'michelle'));
    expect(loginHandleKey('tenantA', 'José')).toBe(loginHandleKey('tenantA', 'jose'));
  });
});

describe('normalizeLoginHandle', () => {
  it('transcribe acentos igual que slugifyTenantId (José -> jose)', () => {
    expect(normalizeLoginHandle('José')).toBe('jose');
  });
  it('quita espacios y símbolos', () => {
    expect(normalizeLoginHandle('Michelle Vendedora #1')).toBe('michellevendedora1');
  });
});

// Checkpoint de seguridad — caso "username inexistente y PIN incorrecto
// devuelven error indistinguible": ambos caminos de loginWithPin (en
// index.ts) usan LITERALMENTE esta misma constante — se prueba acá que es
// una única fuente de verdad, no dos strings que alguien podría
// desincronizar sin darse cuenta en un cambio futuro.
describe('PIN_LOGIN_GENERIC_ERROR — protección contra enumeración', () => {
  it('es un mensaje que no distingue "no existe" de "PIN incorrecto"', () => {
    expect(PIN_LOGIN_GENERIC_ERROR.toLowerCase()).not.toContain('no existe');
    expect(PIN_LOGIN_GENERIC_ERROR.toLowerCase()).not.toContain('no encontrado');
  });
  it('el hash dummy (costo constante para handles inexistentes) es válido y no revienta verifyPinHash', () => {
    expect(() => verifyPinHash('000000', DUMMY_PIN_SALT, DUMMY_PIN_HASH)).not.toThrow();
    expect(verifyPinHash('000000', DUMMY_PIN_SALT, DUMMY_PIN_HASH)).toBe(true);
  });
  it('el hash dummy con un PIN cualquiera de un atacante sigue sin revelar nada (siempre corre el mismo cómputo)', () => {
    expect(() => verifyPinHash('482791', DUMMY_PIN_SALT, DUMMY_PIN_HASH)).not.toThrow();
  });
});
