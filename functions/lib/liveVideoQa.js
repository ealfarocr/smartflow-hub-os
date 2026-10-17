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
exports.liveVideoQa = void 0;
const admin = __importStar(require("firebase-admin"));
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const https_1 = require("firebase-functions/v2/https");
const liveVideoQaCore_1 = require("./liveVideoQaCore");
// PROTOTIPO QA "Live Video" — SuperAdmin o el UID QA explícito (liveVideoQaCore). No toca tenants, conversaciones,
// WhatsApp ni Meta. Los chunks y el archivo final viven en
// live-video-qa/{uid}/{jobId}/ (ruta dedicada; ver storage.rules).
const MAX_CHUNKS = 120;
const MAX_FINAL_BYTES_TO_INSPECT = 40 * 1024 * 1024;
function runFfprobe(file) {
    return new Promise((resolve) => {
        let binary;
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            binary = require('@ffprobe-installer/ffprobe').path;
        }
        catch (e) {
            resolve({ ok: false, error: `ffprobe no disponible: ${e.message}` });
            return;
        }
        (0, child_process_1.execFile)(binary, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                resolve({ ok: false, error: `${err.message}`.slice(0, 300) + (stderr ? ` | ${String(stderr).slice(0, 300)}` : '') });
                return;
            }
            try {
                resolve({ ok: true, data: JSON.parse(stdout) });
            }
            catch (e) {
                resolve({ ok: false, error: `salida de ffprobe ilegible: ${e.message}` });
            }
        });
    });
}
exports.liveVideoQa = (0, https_1.onCall)({ maxInstances: 2, memory: '512MiB', timeoutSeconds: 120 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Usuario no autenticado');
    const db = admin.firestore();
    const userSnap = await db.collection('users').doc(request.auth.uid).get();
    if (!(0, liveVideoQaCore_1.isLiveVideoQaAllowed)(request.auth.uid, userSnap.data()?.isSuperAdmin === true)) {
        throw new https_1.HttpsError('permission-denied', 'No autorizado para el prototipo QA.');
    }
    const uid = request.auth.uid;
    const { action, jobId, chunkCount, mimeType } = request.data;
    if (!(0, liveVideoQaCore_1.isValidJobId)(jobId))
        throw new https_1.HttpsError('invalid-argument', 'jobId inválido');
    const bucket = admin.storage().bucket();
    if (action === 'delete') {
        const [files] = await bucket.getFiles({ prefix: (0, liveVideoQaCore_1.jobPrefix)(uid, jobId) });
        await Promise.all(files.map(f => f.delete({ ignoreNotFound: true })));
        return { ok: true, deleted: files.length };
    }
    if (action !== 'compose')
        throw new https_1.HttpsError('invalid-argument', 'action inválida');
    if (!Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > MAX_CHUNKS) {
        throw new https_1.HttpsError('invalid-argument', `chunkCount debe estar entre 1 y ${MAX_CHUNKS}`);
    }
    const count = chunkCount;
    const isWebm = typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('video/webm');
    const ext = isWebm ? 'webm' : 'mp4';
    const contentType = isWebm ? 'video/webm' : 'video/mp4';
    // Todos los chunks deben existir antes de componer: un hueco produciría un
    // archivo "válido" pero con un salto, y el prototipo debe decirlo claro.
    const tCompose0 = Date.now();
    const exists = await Promise.all(Array.from({ length: count }, (_, i) => bucket.file((0, liveVideoQaCore_1.chunkObjectName)(uid, jobId, i)).exists().then(([e]) => e)));
    const missing = exists.map((e, i) => (e ? -1 : i)).filter(i => i >= 0);
    if (missing.length) {
        throw new https_1.HttpsError('failed-precondition', `Faltan chunks: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`);
    }
    const finalName = (0, liveVideoQaCore_1.finalObjectName)(uid, jobId, ext);
    const finalFile = bucket.file(finalName);
    const steps = (0, liveVideoQaCore_1.planComposeBatches)(count);
    for (const step of steps) {
        const sources = [
            ...(step.includesAccumulator ? [finalFile] : []),
            ...step.chunkIndexes.map(i => bucket.file((0, liveVideoQaCore_1.chunkObjectName)(uid, jobId, i))),
        ];
        await bucket.combine(sources, finalFile);
    }
    const token = crypto.randomUUID();
    await finalFile.setMetadata({ contentType, metadata: { firebaseStorageDownloadTokens: token } });
    const composeMs = Date.now() - tCompose0;
    // Validación: descarga + estructura del contenedor + ffprobe.
    const tVal0 = Date.now();
    const [meta] = await finalFile.getMetadata();
    const sizeBytes = Number(meta.size);
    const tmp = path.join(os.tmpdir(), `lvqa-${uid}-${jobId}.${ext}`);
    let downloadMs = 0;
    let container = null;
    let ffprobe = null;
    try {
        if (sizeBytes <= MAX_FINAL_BYTES_TO_INSPECT) {
            const tDl = Date.now();
            await finalFile.download({ destination: tmp });
            downloadMs = Date.now() - tDl;
            container = (0, liveVideoQaCore_1.summarizeMp4)(fs.readFileSync(tmp));
            const probe = await runFfprobe(tmp);
            if (probe.ok) {
                const streams = probe.data.streams || [];
                const video = streams.find(s => s.codec_type === 'video');
                const audio = streams.find(s => s.codec_type === 'audio');
                const fmt = probe.data.format || {};
                ffprobe = {
                    formatName: fmt.format_name, durationSec: fmt.duration !== undefined ? Number(fmt.duration) : null,
                    bitRate: fmt.bit_rate !== undefined ? Number(fmt.bit_rate) : null,
                    video: video ? {
                        codec: video.codec_name, profile: video.profile, width: video.width, height: video.height,
                        rFrameRate: video.r_frame_rate, avgFrameRate: video.avg_frame_rate,
                        bitRate: video.bit_rate ? Number(video.bit_rate) : null,
                        rotation: video.side_data_list?.find(d => d.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? null,
                    } : null,
                    audio: audio ? { codec: audio.codec_name, channels: audio.channels, sampleRate: audio.sample_rate, bitRate: audio.bit_rate ? Number(audio.bit_rate) : null } : null,
                    streamCount: streams.length,
                };
            }
            else {
                ffprobe = { error: probe.error };
            }
        }
    }
    finally {
        try {
            fs.unlinkSync(tmp);
        }
        catch { /* no existía */ }
    }
    const validationMs = Date.now() - tVal0;
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(finalName)}?alt=media&token=${token}`;
    console.log('LIVE_VIDEO_QA_COMPOSED', { jobId, count, sizeBytes, composeMs, validationMs, steps: steps.length });
    return {
        ok: true, url, finalName, sizeBytes, under16MB: sizeBytes < 16 * 1024 * 1024,
        composeMs, composeSteps: steps.length, downloadMs, validationMs, container, ffprobe,
    };
});
//# sourceMappingURL=liveVideoQa.js.map