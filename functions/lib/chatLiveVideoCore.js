"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiveVideoError = exports.chatFinalObjectName = exports.chatChunkObjectName = exports.chatJobPrefix = exports.isSafePathId = exports.CHAT_LIVE_VIDEO_MAX_BYTES = exports.CHAT_LIVE_VIDEO_MAX_CHUNKS = exports.CHAT_LIVE_VIDEO_CHUNK_SECONDS = exports.CHAT_LIVE_VIDEO_MAX_SECONDS = exports.isValidJobId = void 0;
exports.authorizeLiveVideoCall = authorizeLiveVideoCall;
exports.deleteChatLiveVideoJob = deleteChatLiveVideoJob;
exports.composeChatLiveVideo = composeChatLiveVideo;
// Live Video PRODUCTIVO (grabar video desde SmartFlow y enviarlo por WhatsApp).
// Lógica pura / inyectable (sin firebase-admin) para probar rutas, autorización
// y el compose con un bucket falso: bucket.combine NO existe en el emulador de
// Storage, así que el orquestador recibe el bucket por parámetro.
//
// Fast path validado físicamente (MP4 H.264 + AAC grabado por MediaRecorder,
// ~57 s / 10.6 MB, Meta lo aceptó y el receptor lo reprodujo completo): sin
// transcodificar y sin ffprobe. El servidor solo compone los chunks, exige que
// el resultado sea un MP4 de <16 MB y publica el archivo final.
const liveVideoQaCore_1 = require("./liveVideoQaCore");
Object.defineProperty(exports, "isValidJobId", { enumerable: true, get: function () { return liveVideoQaCore_1.isValidJobId; } });
const sendMessageAuth_1 = require("./sendMessageAuth");
exports.CHAT_LIVE_VIDEO_MAX_SECONDS = 60;
exports.CHAT_LIVE_VIDEO_CHUNK_SECONDS = 2;
// 60 s / 2 s = 30 chunks + margen por chunks parciales al detener.
exports.CHAT_LIVE_VIDEO_MAX_CHUNKS = 40;
// Límite de WhatsApp para video; el MP4 grabado a ~1,4 Mbps + 64 kbps queda en ~11 MB por 60 s.
exports.CHAT_LIVE_VIDEO_MAX_BYTES = 16 * 1024 * 1024;
const HEAD_BYTES = 64 * 1024;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const isSafePathId = (v) => typeof v === 'string' && SAFE_ID.test(v);
exports.isSafePathId = isSafePathId;
// chat-live-video/{tenantId}/{conversationId}/{uid}/{jobId}/ — aislado por tenant,
// conversación Y usuario (storage.rules replica esta forma: uid == request.auth.uid).
const chatJobPrefix = (tenantId, conversationId, uid, jobId) => `chat-live-video/${tenantId}/${conversationId}/${uid}/${jobId}/`;
exports.chatJobPrefix = chatJobPrefix;
const chatChunkObjectName = (tenantId, conversationId, uid, jobId, index) => `${(0, exports.chatJobPrefix)(tenantId, conversationId, uid, jobId)}c${String(index).padStart(4, '0')}`;
exports.chatChunkObjectName = chatChunkObjectName;
const chatFinalObjectName = (tenantId, conversationId, uid, jobId) => `${(0, exports.chatJobPrefix)(tenantId, conversationId, uid, jobId)}final.mp4`;
exports.chatFinalObjectName = chatFinalObjectName;
class LiveVideoError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
exports.LiveVideoError = LiveVideoError;
/**
 * Mismo criterio que sendWhatsappMessage (el video termina enviándose por ahí):
 * membresía activa y rol distinto de "Solo lectura" (SuperAdmin exento), y la
 * conversación debe pertenecer EXACTAMENTE al tenant pedido — incluso para
 * SuperAdmin. La app no restringe conversaciones por asesor, así que tampoco
 * se restringe acá (sería más estricto que enviar el mensaje).
 */
function authorizeLiveVideoCall(i) {
    const m = (0, sendMessageAuth_1.checkMembershipAuth)({ isSuperAdmin: i.isSuperAdmin, membership: i.membership });
    if (!m.allowed) {
        return { ok: false, code: 'permission-denied', message: m.reason === 'read-only-role' ? 'Tu rol es de solo lectura.' : 'No tenés una membresía activa en este negocio.' };
    }
    if (i.conversationTenantId === null)
        return { ok: false, code: 'not-found', message: 'Conversación no encontrada.' };
    if (!(0, sendMessageAuth_1.checkConversationTenantMatch)(i.conversationTenantId, i.requestedTenantId)) {
        return { ok: false, code: 'permission-denied', message: 'La conversación no pertenece a este negocio.' };
    }
    return { ok: true };
}
const deleteQuiet = (f) => f.delete({ ignoreNotFound: true }).catch(() => undefined);
/** Descarta todo lo del job (cancelar / descartar el preview). Solo el prefijo del propio uid. */
async function deleteChatLiveVideoJob(bucket, p) {
    const [files] = await bucket.getFiles({ prefix: (0, exports.chatJobPrefix)(p.tenantId, p.conversationId, p.uid, p.jobId) });
    await Promise.all(files.map(deleteQuiet));
    return files.length;
}
async function composeChatLiveVideo(bucket, p) {
    if (!Number.isInteger(p.chunkCount) || p.chunkCount < 1 || p.chunkCount > exports.CHAT_LIVE_VIDEO_MAX_CHUNKS) {
        throw new LiveVideoError('invalid-argument', 'La grabación no es válida (duración fuera de rango).');
    }
    // Solo el fast path validado: MP4. WebM no lo acepta WhatsApp y no se transcodifica.
    if (typeof p.mimeType === 'string' && p.mimeType.toLowerCase().startsWith('video/webm')) {
        throw new LiveVideoError('invalid-argument', 'Este teléfono graba en un formato que WhatsApp no acepta.');
    }
    const chunkFile = (i) => bucket.file((0, exports.chatChunkObjectName)(p.tenantId, p.conversationId, p.uid, p.jobId, i));
    // Un hueco produciría un MP4 "válido" con un salto: se rechaza antes de componer.
    const exists = await Promise.all(Array.from({ length: p.chunkCount }, (_, i) => chunkFile(i).exists().then(([e]) => e)));
    if (exists.some(e => !e)) {
        throw new LiveVideoError('failed-precondition', 'El video no terminó de subir. Probá grabar de nuevo.');
    }
    const finalName = (0, exports.chatFinalObjectName)(p.tenantId, p.conversationId, p.uid, p.jobId);
    const finalFile = bucket.file(finalName);
    const cleanupAll = async () => {
        await deleteQuiet(finalFile);
        await Promise.all(Array.from({ length: p.chunkCount }, (_, i) => deleteQuiet(chunkFile(i))));
    };
    for (const step of (0, liveVideoQaCore_1.planComposeBatches)(p.chunkCount)) {
        const sources = [...(step.includesAccumulator ? [finalFile] : []), ...step.chunkIndexes.map(chunkFile)];
        await bucket.combine(sources, finalFile);
    }
    const [meta] = await finalFile.getMetadata();
    const sizeBytes = Number(meta.size);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        await cleanupAll();
        throw new LiveVideoError('failed-precondition', 'No se pudo preparar el video.');
    }
    if (sizeBytes > exports.CHAT_LIVE_VIDEO_MAX_BYTES) {
        await cleanupAll();
        throw new LiveVideoError('failed-precondition', 'El video pesa más de 16 MB y WhatsApp no lo acepta. Grabá uno más corto.');
    }
    // Solo la cabecera: basta para confirmar que el contenedor es MP4 (ftyp/moov/moof).
    const [head] = await finalFile.download({ start: 0, end: HEAD_BYTES - 1 });
    if ((0, liveVideoQaCore_1.summarizeMp4)(head).container !== 'mp4') {
        await cleanupAll();
        throw new LiveVideoError('failed-precondition', 'El video no quedó en un formato compatible con WhatsApp.');
    }
    await finalFile.setMetadata({ contentType: 'video/mp4', metadata: { firebaseStorageDownloadTokens: p.token } });
    // El final ya está publicado: los chunks sobran (el QA los dejaba; acá no).
    await Promise.all(Array.from({ length: p.chunkCount }, (_, i) => deleteQuiet(chunkFile(i))));
    return { finalName, sizeBytes };
}
//# sourceMappingURL=chatLiveVideoCore.js.map