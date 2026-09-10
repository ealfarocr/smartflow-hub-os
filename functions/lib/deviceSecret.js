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
exports.DEVICE_SECRET_BYTES = void 0;
exports.generateDeviceSecret = generateDeviceSecret;
exports.hashDeviceSecret = hashDeviceSecret;
exports.verifyDeviceSecret = verifyDeviceSecret;
exports.checkDeviceLogin = checkDeviceLogin;
const crypto = __importStar(require("crypto"));
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
exports.DEVICE_SECRET_BYTES = 32;
function generateDeviceSecret() {
    return crypto.randomBytes(exports.DEVICE_SECRET_BYTES).toString('base64url');
}
/**
 * sha256 con salt alcanza acá (a diferencia del PIN, que usa scrypt): el
 * secreto tiene 256 bits de entropía real, así que no hay espacio que
 * recorrer por fuerza bruta. El scrypt del PIN existe porque un PIN de 6
 * dígitos solo tiene un millón de valores posibles.
 */
function hashDeviceSecret(secret, salt) {
    return crypto.createHash('sha256').update(`${salt}:${secret}`).digest('hex');
}
function verifyDeviceSecret(secret, salt, expectedHashHex) {
    if (!secret || !salt || !expectedHashHex)
        return false;
    const actual = Buffer.from(hashDeviceSecret(secret, salt), 'hex');
    const expected = Buffer.from(expectedHashHex, 'hex');
    if (actual.length !== expected.length)
        return false;
    return crypto.timingSafeEqual(actual, expected);
}
/**
 * Decide si una reentrada con credencial de dispositivo puede emitir sesión.
 * El orden importa solo para el motivo que se registra: la respuesta al
 * cliente es SIEMPRE el mismo error genérico, para no revelar si el equipo
 * existe, si fue revocado o si la persona fue desactivada.
 */
function checkDeviceLogin(input) {
    if (!input.deviceExists)
        return { allowed: false, reason: 'device-unknown' };
    if (input.deviceStatus === 'revoked')
        return { allowed: false, reason: 'device-revoked' };
    if (!input.hasSecret)
        return { allowed: false, reason: 'no-secret' };
    if (!input.secretMatches)
        return { allowed: false, reason: 'bad-secret' };
    if (input.deviceTenantId !== input.requestedTenantId)
        return { allowed: false, reason: 'wrong-tenant' };
    if (!input.membershipExists)
        return { allowed: false, reason: 'no-membership' };
    if (input.membershipStatus !== 'active')
        return { allowed: false, reason: 'not-active' };
    return { allowed: true };
}
//# sourceMappingURL=deviceSecret.js.map