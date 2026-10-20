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
exports.chatLiveVideo = void 0;
const admin = __importStar(require("firebase-admin"));
const crypto = __importStar(require("crypto"));
const https_1 = require("firebase-functions/v2/https");
const chatLiveVideoCore_1 = require("./chatLiveVideoCore");
// Live Video PRODUCTIVO. Los chunks los sube el cliente directo a Storage
// (chat-live-video/{tenantId}/{conversationId}/{uid}/{jobId}/, ver storage.rules);
// esta función solo los compone y devuelve la URL con token para enviar por el
// pipeline normal (ConversationService.sendMessage → sendWhatsappMessage).
// El uid sale SIEMPRE de request.auth, nunca del payload.
exports.chatLiveVideo = (0, https_1.onCall)({ maxInstances: 10, memory: '512MiB', timeoutSeconds: 90 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Usuario no autenticado');
    const uid = request.auth.uid;
    const { action, tenantId, conversationId, jobId, chunkCount, mimeType } = request.data;
    if (!(0, chatLiveVideoCore_1.isSafePathId)(tenantId) || !(0, chatLiveVideoCore_1.isSafePathId)(conversationId) || !(0, chatLiveVideoCore_1.isValidJobId)(jobId)) {
        throw new https_1.HttpsError('invalid-argument', 'Parámetros inválidos');
    }
    if (action !== 'compose' && action !== 'delete')
        throw new https_1.HttpsError('invalid-argument', 'action inválida');
    const db = admin.firestore();
    const [userSnap, membershipSnap, convSnap] = await Promise.all([
        db.collection('users').doc(uid).get(),
        db.collection('memberships').doc(`${uid}_${tenantId}`).get(),
        db.collection('conversations').doc(conversationId).get(),
    ]);
    const membershipData = membershipSnap.data();
    const auth = (0, chatLiveVideoCore_1.authorizeLiveVideoCall)({
        isSuperAdmin: userSnap.exists && userSnap.data()?.isSuperAdmin === true,
        membership: membershipSnap.exists && membershipData ? { status: membershipData.status, role: membershipData.role } : null,
        conversationTenantId: convSnap.exists ? String(convSnap.data()?.tenantId ?? '') : null,
        requestedTenantId: tenantId,
    });
    if (!auth.ok)
        throw new https_1.HttpsError(auth.code, auth.message);
    const bucket = admin.storage().bucket();
    const base = { tenantId, conversationId, uid, jobId };
    try {
        if (action === 'delete') {
            return { ok: true, deleted: await (0, chatLiveVideoCore_1.deleteChatLiveVideoJob)(bucket, base) };
        }
        const t0 = Date.now();
        const token = crypto.randomUUID();
        const { finalName, sizeBytes } = await (0, chatLiveVideoCore_1.composeChatLiveVideo)(bucket, { ...base, chunkCount: chunkCount, mimeType, token });
        const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(finalName)}?alt=media&token=${token}`;
        console.log('CHAT_LIVE_VIDEO_COMPOSED', { tenantId, conversationId, jobId, chunkCount, sizeBytes, ms: Date.now() - t0 });
        return { ok: true, url, sizeBytes };
    }
    catch (e) {
        if (e instanceof chatLiveVideoCore_1.LiveVideoError)
            throw new https_1.HttpsError(e.code, e.message);
        console.error('[chatLiveVideo] error inesperado:', e instanceof Error ? e.message : e);
        throw new https_1.HttpsError('internal', 'No se pudo preparar el video.');
    }
});
//# sourceMappingURL=chatLiveVideo.js.map