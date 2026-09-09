"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DUMMY_PIN_HASH = exports.DUMMY_PIN_SALT = exports.PIN_LOGIN_GENERIC_ERROR = exports.PIN_LOCKOUT_MS = exports.PIN_MAX_ATTEMPTS = void 0;
exports.hashPin = hashPin;
exports.verifyPinHash = verifyPinHash;
exports.generatePin = generatePin;
exports.normalizeLoginHandle = normalizeLoginHandle;
exports.loginHandleKey = loginHandleKey;
const crypto = __importStar(require("crypto"));
// Helpers puros de PIN (LOOP dispositivo confiable) — extraídos a su propio
// módulo, sin efectos secundarios (nada de admin.initializeApp ni top-level
// execution), específicamente para poder testearlos con vitest sin importar
// el archivo index.ts completo (4000+ líneas, con inicializaciones reales de
// Firebase Admin/SendGrid al cargar el módulo).
exports.PIN_MAX_ATTEMPTS = 5;
exports.PIN_LOCKOUT_MS = 15 * 60000;
const PIN_SCRYPT_KEYLEN = 64;
function hashPin(pin, salt) {
    return crypto.scryptSync(pin, salt, PIN_SCRYPT_KEYLEN).toString('hex');
}
function verifyPinHash(pin, salt, expectedHashHex) {
    const actual = Buffer.from(hashPin(pin, salt), 'hex');
    const expected = Buffer.from(expectedHashHex, 'hex');
    if (actual.length !== expected.length)
        return false;
    return crypto.timingSafeEqual(actual, expected);
}
function generatePin() {
    // 6 dígitos, cada uno independiente — evita sesgo de módulo con randomInt(0,10) por dígito.
    let pin = '';
    for (let i = 0; i < 6; i++)
        pin += crypto.randomInt(0, 10).toString();
    return pin;
}
// Normaliza un nombre a un handle de login corto y estable ("Michelle" ->
// "michelle") — el vendedor solo ve "Michelle"/PIN (checkpoint de
// seguridad), nunca un membershipId. Único DENTRO de un tenant, no
// globalmente: login_handles/{tenantId}_{handle} es el índice de
// resolución (ver setVendorPin/loginWithPin en index.ts). Mismo criterio de
// transliteración que slugifyTenantId (src/utils/slug.ts) para consistencia.
function normalizeLoginHandle(raw) {
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
function loginHandleKey(tenantId, rawHandle) {
    return `${tenantId}_${normalizeLoginHandle(rawHandle)}`;
}
// Mensaje ÚNICO para "usuario no existe" y "PIN incorrecto" — checkpoint de
// seguridad: nunca revelar por mensaje si un nombre de usuario existe en un
// tenant. Exportado (no solo usado en index.ts) para poder testear que de
// verdad es la MISMA constante en ambos caminos, no dos strings iguales por
// coincidencia que alguien podría desincronizar en un cambio futuro.
exports.PIN_LOGIN_GENERIC_ERROR = 'Usuario o PIN incorrecto.';
// Hash/salt fijos SOLO para absorber el costo de scrypt cuando el usuario no
// existe — mismo tiempo de cómputo que una verificación real, para que la
// latencia de la respuesta no delate por sí sola que ese usuario no existe.
exports.DUMMY_PIN_SALT = 'dummy-salt-constant-cost-only';
exports.DUMMY_PIN_HASH = hashPin('000000', exports.DUMMY_PIN_SALT);
//# sourceMappingURL=pinAuth.js.map