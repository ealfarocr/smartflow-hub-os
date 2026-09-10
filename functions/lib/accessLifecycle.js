"use strict";
// ═══════════════════════════════════════════════════════════════════════
// CICLO DE ACCESO DE UN USUARIO — máquina de estados explícita.
//
// Antes no existía: cada pieza (setVendorPin, getVendorAccessInfo,
// loginWithPin, la UI) decidía por su cuenta combinando `membership.status`
// con "¿existe vendor_credentials?", y quedó un estado muerto real en
// producción: una membership 'active' SIN credencial no podía generar PIN
// (setVendorPin exigía prepared/draft) aunque la UI ya sabía que no tenía
// PIN. Este módulo es la única fuente de verdad de qué estado de acceso
// tiene alguien y qué acción de NEGOCIO corresponde — el backend la aplica
// y también se la devuelve a la UI (getTenantAccessOverview), así la UI
// nunca ofrece un botón que el backend va a rechazar.
//
// Puro a propósito (sin Firestore, sin admin SDK) para poder testearlo con
// vitest sin importar index.ts — mismo patrón que vendorPinAuth.ts.
// ═══════════════════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUSPENDED_PIN_ERROR = void 0;
exports.resolveAccessState = resolveAccessState;
exports.resolveAccessActions = resolveAccessActions;
exports.resolveAccessActionsFor = resolveAccessActionsFor;
exports.checkSetVendorPinTransition = checkSetVendorPinTransition;
function resolveAccessState(input) {
    const { status, userId, hasCredential } = input;
    if (status === 'suspended' || status === 'inactive')
        return 'suspended';
    if (status === 'prepared' || status === 'draft')
        return 'no-access';
    if (status === 'pending') {
        // Con credencial y sin uid todavía = PIN generado, esperando el primer
        // acceso. Sin credencial = invitación por correo que nadie aceptó.
        return hasCredential && !userId ? 'pending-first-login' : 'no-access';
    }
    if (status === 'active') {
        return hasCredential ? 'active-with-access' : 'active-without-access';
    }
    return 'unknown';
}
function resolveAccessActions(state) {
    switch (state) {
        case 'no-access':
            return { primary: 'generate', canRegenerate: false };
        case 'active-without-access':
            return { primary: 'generate', canRegenerate: false };
        case 'pending-first-login':
            return { primary: 'copy', canRegenerate: true };
        case 'active-with-access':
            return { primary: 'copy', canRegenerate: true };
        case 'suspended':
            // Se decide con la credencial, no solo con el status: reactivar a
            // alguien que no tiene PIN lo dejaría activo y sin forma de entrar.
            return { primary: 'reactivate', canRegenerate: false };
        case 'unknown':
            return { primary: 'review', canRegenerate: false };
    }
}
/** Igual que resolveAccessActions, pero distingue el suspendido sin PIN. */
function resolveAccessActionsFor(input) {
    const state = resolveAccessState(input);
    if (state === 'suspended') {
        return {
            primary: input.hasCredential ? 'reactivate' : 'reactivate-and-generate',
            canRegenerate: false,
        };
    }
    return resolveAccessActions(state);
}
/**
 * Transiciones válidas de PRODUCTO (no de implementación):
 *   prepared/draft            -> generar PIN  (bootstrap)
 *   pending sin credencial    -> generar PIN  (bootstrap si nunca entró)
 *   active sin credencial     -> generar PIN  (attach al uid que ya existe)
 *   active/pending con cred.  -> regenerar PIN
 *   suspended                 -> RECHAZO explícito y accionable: primero
 *                                reactivar (la UI ofrece "Reactivar y
 *                                generar acceso" como una sola acción).
 */
function checkSetVendorPinTransition(input) {
    const state = resolveAccessState(input);
    switch (state) {
        case 'pending-first-login':
        case 'active-with-access':
            return { allowed: true, mode: 'regenerate' };
        case 'active-without-access':
            // Tiene uid real: se engancha la credencial a esa cuenta. Si por
            // algún motivo no lo tuviera, hay que crearla desde cero.
            return { allowed: true, mode: input.userId ? 'attach' : 'bootstrap' };
        case 'no-access':
            return { allowed: true, mode: input.userId ? 'attach' : 'bootstrap' };
        case 'suspended':
            return { allowed: false, reason: 'suspended' };
        case 'unknown':
            return { allowed: false, reason: 'unknown-state' };
    }
}
exports.SUSPENDED_PIN_ERROR = 'Este usuario está desactivado. Reactivalo primero y después generá su acceso.';
//# sourceMappingURL=accessLifecycle.js.map