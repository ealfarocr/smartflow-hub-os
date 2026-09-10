"use strict";
// Entrada rápida desde un dispositivo reconocido — autorización.
//
// QUÉ AUTORIZA ESTO Y QUÉ NO: el "mantener presionado para entrar" NO es un
// método de autenticación. La persona ya está autenticada (su sesión de
// Firebase sigue viva y su refresh token es la credencial real ligada a este
// navegador); el gesto solo confirma la intención de entrar. El deviceId NO
// cuenta como factor: lo genera el propio cliente y vive en localStorage, así
// que no es un secreto — sirve para RECONOCER el equipo, no para probar quién
// es. Por eso esta función re-valida contra el servidor en cada entrada rápida
// en vez de confiar en lo que diga el cliente, y por eso el código de acceso
// sigue siendo obligatorio cuando no hay sesión viva.
//
// Puro a propósito (sin Firestore ni admin SDK) para testearlo con vitest sin
// importar index.ts — mismo patrón que vendorPinAuth.ts / accessLifecycle.ts.
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkDeviceQuickEntry = checkDeviceQuickEntry;
exports.quickEntryFallback = quickEntryFallback;
function checkDeviceQuickEntry(input) {
    // 1. La persona sigue habilitada en este negocio. Desactivar a alguien tiene
    //    que cerrarle también esta puerta, no solo el login por código.
    if (!input.membershipExists)
        return { allowed: false, reason: 'no-membership' };
    if (input.membershipStatus !== 'active')
        return { allowed: false, reason: 'not-active' };
    // 2. El equipo está reconocido y no fue liberado por un Owner/Admin.
    if (!input.deviceExists)
        return { allowed: false, reason: 'device-unknown' };
    if (input.deviceStatus === 'revoked')
        return { allowed: false, reason: 'device-revoked' };
    // 3. El equipo es de ESTA persona y de ESTE negocio. Cubre el caso real del
    //    teléfono corporativo que cambia de manos: el dispositivo registrado a
    //    nombre de quien lo tenía antes nunca sirve para entrar como otra
    //    persona (ni siquiera si el navegador conservó el mismo deviceId).
    if (input.deviceUserId !== input.callerUid)
        return { allowed: false, reason: 'device-of-another-user' };
    if (input.deviceTenantId !== input.tenantId)
        return { allowed: false, reason: 'device-of-another-tenant' };
    return { allowed: true };
}
/**
 * Qué debe hacer la UI ante cada rechazo. 'require-code' = pedir el código de
 * acceso; 'sign-out' = además cerrar la sesión, porque la persona ya no está
 * habilitada en el negocio y no alcanza con volver a pedirle el código.
 */
function quickEntryFallback(reason) {
    return reason === 'no-membership' || reason === 'not-active' ? 'sign-out' : 'require-code';
}
//# sourceMappingURL=deviceSessionAuth.js.map