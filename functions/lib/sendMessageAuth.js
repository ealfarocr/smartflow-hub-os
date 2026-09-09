"use strict";
// Lógica de autorización de sendWhatsappMessage extraída a funciones puras
// (mismo patrón que pinAuth.ts) para poder testear los casos exigidos sin
// necesidad de emulador ni mocks de Firestore/Admin SDK. Dos funciones,
// reflejando los dos checkpoints reales y separados del código: la
// membership/rol se resuelve ANTES de tocar la integración/conversación; el
// match de tenant de la conversación se resuelve DESPUÉS, una vez leída.
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkMembershipAuth = checkMembershipAuth;
exports.checkConversationTenantMatch = checkConversationTenantMatch;
/**
 * Checkpoint 1 (paso 2 real): membership activa + rol permitido, con bypass
 * de SuperAdmin (mismo patrón que completeWhatsappEmbeddedSignup, Fase 4).
 */
function checkMembershipAuth(input) {
    if (input.isSuperAdmin) {
        return { allowed: true };
    }
    if (!input.membership || input.membership.status !== 'active') {
        return { allowed: false, reason: 'no-active-membership' };
    }
    if (input.membership.role === 'Solo lectura') {
        return { allowed: false, reason: 'read-only-role' };
    }
    return { allowed: true };
}
/**
 * Checkpoint 2 (paso 4 real): la conversación solicitada debe pertenecer
 * exactamente al tenantId pedido. Aplica siempre, incluso para SuperAdmin —
 * el bypass de checkMembershipAuth nunca alcanza para operar sobre la
 * conversación de un tenant distinto al declarado en el request.
 */
function checkConversationTenantMatch(conversationTenantId, requestedTenantId) {
    return conversationTenantId === requestedTenantId;
}
//# sourceMappingURL=sendMessageAuth.js.map