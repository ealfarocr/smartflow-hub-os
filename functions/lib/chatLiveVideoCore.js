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
exports.LiveVideoError = exports.defaultFfmpegRunner = exports.FFMPEG_REMUX_ARGS = exports.chatFinalObjectName = exports.chatCombinedFragmentedObjectName = exports.chatChunkObjectName = exports.chatJobPrefix = exports.isSafePathId = exports.FFMPEG_DEFAULT_BINARY = exports.FFMPEG_TIMEOUT_MS = exports.CHAT_LIVE_VIDEO_MAX_BYTES = exports.CHAT_LIVE_VIDEO_MAX_CHUNKS = exports.CHAT_LIVE_VIDEO_CHUNK_SECONDS = exports.CHAT_LIVE_VIDEO_MAX_SECONDS = exports.isValidJobId = void 0;
exports.resolveFfmpegBinary = resolveFfmpegBinary;
exports.validateRemuxOutput = validateRemuxOutput;
exports.authorizeLiveVideoCall = authorizeLiveVideoCall;
exports.deleteChatLiveVideoJob = deleteChatLiveVideoJob;
exports.composeChatLiveVideo = composeChatLiveVideo;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const liveVideoQaCore_1 = require("./liveVideoQaCore");
Object.defineProperty(exports, "isValidJobId", { enumerable: true, get: function () { return liveVideoQaCore_1.isValidJobId; } });
const sendMessageAuth_1 = require("./sendMessageAuth");
exports.CHAT_LIVE_VIDEO_MAX_SECONDS = 60;
exports.CHAT_LIVE_VIDEO_CHUNK_SECONDS = 2;
// 60 s / 2 s = 30 chunks + margen por chunks parciales al detener.
exports.CHAT_LIVE_VIDEO_MAX_CHUNKS = 40;
// Límite de WhatsApp para video; el MP4 grabado a ~1,4 Mbps + 64 kbps queda en ~11 MB por 60 s.
exports.CHAT_LIVE_VIDEO_MAX_BYTES = 16 * 1024 * 1024;
exports.FFMPEG_TIMEOUT_MS = 30000;
exports.FFMPEG_DEFAULT_BINARY = '/usr/bin/ffmpeg';
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
const chatCombinedFragmentedObjectName = (tenantId, conversationId, uid, jobId) => `${(0, exports.chatJobPrefix)(tenantId, conversationId, uid, jobId)}combined-fragmented.mp4`;
exports.chatCombinedFragmentedObjectName = chatCombinedFragmentedObjectName;
const chatFinalObjectName = (tenantId, conversationId, uid, jobId) => `${(0, exports.chatJobPrefix)(tenantId, conversationId, uid, jobId)}final.mp4`;
exports.chatFinalObjectName = chatFinalObjectName;
const FFMPEG_REMUX_ARGS = (inputPath, outputPath) => [
    '-y',
    '-nostdin',
    '-i',
    inputPath,
    '-map',
    '0',
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    outputPath,
];
exports.FFMPEG_REMUX_ARGS = FFMPEG_REMUX_ARGS;
function resolveFfmpegBinary(customPath) {
    if (customPath && fs.existsSync(customPath))
        return customPath;
    if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH))
        return process.env.FFMPEG_PATH;
    if (fs.existsSync(exports.FFMPEG_DEFAULT_BINARY))
        return exports.FFMPEG_DEFAULT_BINARY;
    if (fs.existsSync('/usr/local/bin/ffmpeg'))
        return '/usr/local/bin/ffmpeg';
    return null;
}
const defaultFfmpegRunner = (binary, args, options) => {
    return new Promise((resolve, reject) => {
        (0, child_process_1.execFile)(binary, args, { timeout: options.timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                reject(err);
            }
            else {
                resolve({ stdout: String(stdout), stderr: String(stderr) });
            }
        });
    });
};
exports.defaultFfmpegRunner = defaultFfmpegRunner;
async function validateRemuxOutput(outputPath) {
    if (!fs.existsSync(outputPath)) {
        throw new LiveVideoError('failed-precondition', 'El archivo de video remuxeado no fue generado.');
    }
    const stat = await fs.promises.stat(outputPath);
    const sizeBytes = stat.size;
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        throw new LiveVideoError('failed-precondition', 'El archivo de video generado está vacío.');
    }
    if (sizeBytes > exports.CHAT_LIVE_VIDEO_MAX_BYTES) {
        throw new LiveVideoError('failed-precondition', 'El video pesa más de 16 MB y WhatsApp no lo acepta. Grabá uno más corto.');
    }
    // Leer cabecera para verificar que las cajas corresponden a un MP4 con faststart
    const headBytesToRead = Math.min(sizeBytes, HEAD_BYTES);
    const fd = await fs.promises.open(outputPath, 'r');
    const headBuf = Buffer.alloc(headBytesToRead);
    await fd.read(headBuf, 0, headBytesToRead, 0);
    await fd.close();
    const summary = (0, liveVideoQaCore_1.summarizeMp4)(headBuf);
    if (summary.container !== 'mp4') {
        throw new LiveVideoError('failed-precondition', 'El video remuxeado no tiene un contenedor MP4 válido.');
    }
    if (summary.fragmented) {
        throw new LiveVideoError('failed-precondition', 'El video remuxeado aún contiene fragmentos (moof).');
    }
    if (summary.moovBeforeMdat !== true) {
        throw new LiveVideoError('failed-precondition', 'El video remuxeado no tiene el atom moov al inicio (faststart no aplicado).');
    }
    return { sizeBytes };
}
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
const deleteFileQuiet = (f) => (f ? f.delete({ ignoreNotFound: true }).catch(() => undefined) : Promise.resolve(undefined));
const deleteLocalQuiet = async (filePath) => {
    if (!filePath)
        return;
    try {
        if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
        }
    }
    catch {
        // ignore
    }
};
/** Descarta todo lo del job (cancelar / descartar el preview). Solo el prefijo del propio uid. */
async function deleteChatLiveVideoJob(bucket, p) {
    const [files] = await bucket.getFiles({ prefix: (0, exports.chatJobPrefix)(p.tenantId, p.conversationId, p.uid, p.jobId) });
    await Promise.all(files.map(deleteFileQuiet));
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
    // Resolver ejecutable de FFmpeg antes de alterar Storage
    const ffmpegBinary = resolveFfmpegBinary(p.ffmpegBinaryPath);
    if (!ffmpegBinary) {
        await Promise.all(Array.from({ length: p.chunkCount }, (_, i) => deleteFileQuiet(chunkFile(i))));
        throw new LiveVideoError('failed-precondition', 'El procesador de video (ffmpeg) no está disponible en el servidor.');
    }
    const combinedName = (0, exports.chatCombinedFragmentedObjectName)(p.tenantId, p.conversationId, p.uid, p.jobId);
    const combinedFile = bucket.file(combinedName);
    const finalName = (0, exports.chatFinalObjectName)(p.tenantId, p.conversationId, p.uid, p.jobId);
    const finalFile = bucket.file(finalName);
    const inputPath = path.join(os.tmpdir(), `live-video-${p.jobId}-combined-fragmented.mp4`);
    const outputPath = path.join(os.tmpdir(), `live-video-${p.jobId}-final.mp4`);
    let success = false;
    try {
        // 1. Combinar chunks a un objeto temporal fragmentado
        for (const step of (0, liveVideoQaCore_1.planComposeBatches)(p.chunkCount)) {
            const sources = [...(step.includesAccumulator ? [combinedFile] : []), ...step.chunkIndexes.map(chunkFile)];
            await bucket.combine(sources, combinedFile);
        }
        const [meta] = await combinedFile.getMetadata();
        const combinedSizeBytes = Number(meta?.size);
        if (!Number.isFinite(combinedSizeBytes) || combinedSizeBytes <= 0) {
            throw new LiveVideoError('failed-precondition', 'No se pudo preparar el video.');
        }
        if (combinedSizeBytes > exports.CHAT_LIVE_VIDEO_MAX_BYTES) {
            throw new LiveVideoError('failed-precondition', 'El video pesa más de 16 MB y WhatsApp no lo acepta. Grabá uno más corto.');
        }
        // 2. Descargar objeto temporal fragmentado a /tmp
        await combinedFile.download({ destination: inputPath });
        // 3. Ejecutar FFmpeg remux (-map 0 -c copy -movflags +faststart)
        const runner = p.ffmpegRunner ?? exports.defaultFfmpegRunner;
        const args = (0, exports.FFMPEG_REMUX_ARGS)(inputPath, outputPath);
        try {
            await runner(ffmpegBinary, args, { timeout: exports.FFMPEG_TIMEOUT_MS });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[chatLiveVideo] Error en ffmpeg remux:', msg);
            throw new LiveVideoError('failed-precondition', 'No se pudo optimizar el video para WhatsApp.');
        }
        // 4. Validar output remuxeado en /tmp antes de subir
        const { sizeBytes } = await validateRemuxOutput(outputPath);
        // 5. Subir REMUX como final.mp4 con metadata y download token
        if (typeof bucket.upload === 'function') {
            await bucket.upload(outputPath, {
                destination: finalFile,
                contentType: 'video/mp4',
                metadata: {
                    contentType: 'video/mp4',
                    metadata: { firebaseStorageDownloadTokens: p.token },
                },
            });
        }
        await finalFile.setMetadata({
            contentType: 'video/mp4',
            metadata: { firebaseStorageDownloadTokens: p.token },
        });
        success = true;
        return { finalName, sizeBytes };
    }
    finally {
        // Limpieza obligatoria:
        // Local /tmp
        await deleteLocalQuiet(inputPath);
        await deleteLocalQuiet(outputPath);
        // Chunks y objeto combinado temporal en Storage
        await Promise.all([
            deleteFileQuiet(combinedFile),
            ...Array.from({ length: p.chunkCount }, (_, i) => deleteFileQuiet(chunkFile(i))),
        ]);
        // En caso de fallo: eliminar final.mp4 si quedó creado parcialmente
        if (!success) {
            await deleteFileQuiet(finalFile);
        }
    }
}
//# sourceMappingURL=chatLiveVideoCore.js.map