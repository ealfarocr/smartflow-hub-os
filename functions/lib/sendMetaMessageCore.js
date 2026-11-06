"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GRAPH_MESSAGES_URL = void 0;
exports.runSendMetaMessage = runSendMetaMessage;
const https_1 = require("firebase-functions/v2/https");
const sendMessageAuth_1 = require("./sendMessageAuth");
// Lógica de sendMetaMessage extraída con dependencias inyectadas para poder
// testear todo el camino (auth -> conversación -> integración -> Graph ->
// persistencia) sin emulador ni mocks de Firestore.
exports.GRAPH_MESSAGES_URL = 'https://graph.facebook.com/v17.0/me/messages';
async function runSendMetaMessage(deps, input) {
    if (!input.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Usuario no autenticado');
    }
    const uid = input.uid;
    const { conversationId, text, tenantId, source: requestedSource } = input.data || {};
    if (!conversationId || !text || !tenantId || typeof conversationId !== 'string' || typeof text !== 'string' || typeof tenantId !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'Faltan parámetros obligatorios');
    }
    // 1. MEMBRESÍA + ROL (mismo checkpoint que sendWhatsappMessage)
    const isSuperAdmin = await deps.isSuperAdmin(uid);
    const membership = await deps.getMembership(uid, tenantId);
    const membershipAuth = (0, sendMessageAuth_1.checkMembershipAuth)({ isSuperAdmin, membership });
    if (!membershipAuth.allowed) {
        throw new https_1.HttpsError('permission-denied', membershipAuth.reason === 'read-only-role'
            ? 'Tu rol es de solo lectura — no podés enviar mensajes.'
            : 'No tienes una membresía activa en este tenant');
    }
    // 2. CONVERSACIÓN (antes de resolver la integración)
    const conv = await deps.getConversation(conversationId);
    if (!conv) {
        throw new https_1.HttpsError('not-found', 'Conversación no encontrada');
    }
    // 3. TENANT DE LA CONVERSACIÓN
    if (!(0, sendMessageAuth_1.checkConversationTenantMatch)(conv.tenantId, tenantId)) {
        throw new https_1.HttpsError('permission-denied', 'Esta conversación no pertenece a tu negocio.');
    }
    // 4. OWNERSHIP (Owner/Admin/SuperAdmin tenant-wide; resto solo asignada a su uid)
    const access = (0, sendMessageAuth_1.checkConversationSendAccess)({
        isSuperAdmin,
        role: membership?.role ?? null,
        conversationAdvisorId: conv.advisorId,
        uid,
    });
    if (!access.allowed) {
        throw new https_1.HttpsError('permission-denied', access.reason === 'unassigned-conversation'
            ? 'La conversación no tiene asesor asignado. Tómala primero.'
            : 'Esta conversación está asignada a otro asesor.');
    }
    // 5. SOURCE: sale SOLO de la conversación
    const source = conv.source;
    if (source !== 'instagram' && source !== 'facebook') {
        throw new https_1.HttpsError('permission-denied', 'Esta función solo envía por Instagram o Messenger.');
    }
    if (requestedSource !== undefined && requestedSource !== null && requestedSource !== source) {
        throw new https_1.HttpsError('failed-precondition', 'El canal solicitado no coincide con el de la conversación.');
    }
    // 6. INTEGRACIÓN (tenant validado + provider == conv.source + activa)
    const integration = await deps.findActiveIntegration(tenantId, source);
    if (!integration) {
        throw new https_1.HttpsError('failed-precondition', `No hay una integración de ${source} activa`);
    }
    if (integration.provider !== source || integration.tenantId !== tenantId) {
        throw new https_1.HttpsError('failed-precondition', 'La integración no corresponde al canal de la conversación.');
    }
    const accessToken = integration.accessToken;
    if (typeof accessToken !== 'string' || !accessToken) {
        throw new https_1.HttpsError('failed-precondition', `La integración de ${source} está mal configurada (falta el token)`);
    }
    const recipientId = conv.platformId;
    if (!recipientId) {
        throw new https_1.HttpsError('failed-precondition', 'La conversación no tiene destinatario.');
    }
    // 7. ENVÍO A META (token en cabecera, nunca en la URL)
    let status = 'sent';
    let externalId = `meta.${deps.randomId()}`;
    let errorMessage = null;
    let metaErrorDetail = null;
    try {
        const response = await deps.fetchFn(exports.GRAPH_MESSAGES_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
        });
        const result = await response.json();
        if (!response.ok) {
            metaErrorDetail = (0, sendMessageAuth_1.buildMetaErrorDetail)(response.status, result?.error);
            throw new Error(result?.error?.message || 'Error en Graph API');
        }
        externalId = result.message_id || externalId;
    }
    catch (err) {
        status = 'failed';
        errorMessage = String(err?.message || 'Error desconocido').split(accessToken).join('[REDACTED]');
    }
    // 8. PERSISTENCIA (se mantiene sent/failed)
    const messageId = await deps.persistMessage(conversationId, { text, status, externalId, errorMessage, metaErrorDetail });
    return { success: status === 'sent', messageId, status, externalId, errorMessage };
}
//# sourceMappingURL=sendMetaMessageCore.js.map