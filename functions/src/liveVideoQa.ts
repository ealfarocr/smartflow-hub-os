import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  chunkObjectName, finalObjectName, isLiveVideoQaAllowed, isValidJobId, jobPrefix, planComposeBatches, summarizeMp4,
} from './liveVideoQaCore';

// PROTOTIPO QA "Live Video" — SuperAdmin o el UID QA explícito (liveVideoQaCore). No toca tenants, conversaciones,
// WhatsApp ni Meta. Los chunks y el archivo final viven en
// live-video-qa/{uid}/{jobId}/ (ruta dedicada; ver storage.rules).
const MAX_CHUNKS = 120;
const MAX_FINAL_BYTES_TO_INSPECT = 40 * 1024 * 1024;

interface FfprobeStream {
  codec_type?: string; codec_name?: string; profile?: string; width?: number; height?: number;
  r_frame_rate?: string; avg_frame_rate?: string; bit_rate?: string; channels?: number; sample_rate?: string;
  side_data_list?: { rotation?: number }[]; tags?: { rotate?: string };
}

function runFfprobe(file: string): Promise<{ ok: true; data: { format?: Record<string, unknown>; streams?: FfprobeStream[] } } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    let binary: string;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      binary = require('@ffprobe-installer/ffprobe').path as string;
    } catch (e) {
      resolve({ ok: false, error: `ffprobe no disponible: ${(e as Error).message}` });
      return;
    }
    execFile(binary, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { resolve({ ok: false, error: `${err.message}`.slice(0, 300) + (stderr ? ` | ${String(stderr).slice(0, 300)}` : '') }); return; }
      try { resolve({ ok: true, data: JSON.parse(stdout) }); } catch (e) { resolve({ ok: false, error: `salida de ffprobe ilegible: ${(e as Error).message}` }); }
    });
  });
}

export const liveVideoQa = onCall({ maxInstances: 2, memory: '512MiB', timeoutSeconds: 120 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  const db = admin.firestore();
  const userSnap = await db.collection('users').doc(request.auth.uid).get();
  if (!isLiveVideoQaAllowed(request.auth.uid, userSnap.data()?.isSuperAdmin === true)) {
    throw new HttpsError('permission-denied', 'No autorizado para el prototipo QA.');
  }
  const uid = request.auth.uid;

  const { action, jobId, chunkCount, mimeType } = request.data as {
    action?: string; jobId?: string; chunkCount?: number; mimeType?: string;
  };
  if (!isValidJobId(jobId)) throw new HttpsError('invalid-argument', 'jobId inválido');
  const bucket = admin.storage().bucket();

  if (action === 'delete') {
    const [files] = await bucket.getFiles({ prefix: jobPrefix(uid, jobId) });
    await Promise.all(files.map(f => f.delete({ ignoreNotFound: true })));
    return { ok: true, deleted: files.length };
  }

  if (action !== 'compose') throw new HttpsError('invalid-argument', 'action inválida');
  if (!Number.isInteger(chunkCount) || (chunkCount as number) < 1 || (chunkCount as number) > MAX_CHUNKS) {
    throw new HttpsError('invalid-argument', `chunkCount debe estar entre 1 y ${MAX_CHUNKS}`);
  }
  const count = chunkCount as number;
  const isWebm = typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('video/webm');
  const ext = isWebm ? 'webm' : 'mp4';
  const contentType = isWebm ? 'video/webm' : 'video/mp4';

  // Todos los chunks deben existir antes de componer: un hueco produciría un
  // archivo "válido" pero con un salto, y el prototipo debe decirlo claro.
  const tCompose0 = Date.now();
  const exists = await Promise.all(
    Array.from({ length: count }, (_, i) => bucket.file(chunkObjectName(uid, jobId, i)).exists().then(([e]) => e)),
  );
  const missing = exists.map((e, i) => (e ? -1 : i)).filter(i => i >= 0);
  if (missing.length) {
    throw new HttpsError('failed-precondition', `Faltan chunks: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`);
  }

  const finalName = finalObjectName(uid, jobId, ext);
  const finalFile = bucket.file(finalName);
  const steps = planComposeBatches(count);
  for (const step of steps) {
    const sources = [
      ...(step.includesAccumulator ? [finalFile] : []),
      ...step.chunkIndexes.map(i => bucket.file(chunkObjectName(uid, jobId, i))),
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
  let container: ReturnType<typeof summarizeMp4> | null = null;
  let ffprobe: unknown = null;
  try {
    if (sizeBytes <= MAX_FINAL_BYTES_TO_INSPECT) {
      const tDl = Date.now();
      await finalFile.download({ destination: tmp });
      downloadMs = Date.now() - tDl;
      container = summarizeMp4(fs.readFileSync(tmp));
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
      } else {
        ffprobe = { error: probe.error };
      }
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* no existía */ }
  }
  const validationMs = Date.now() - tVal0;

  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(finalName)}?alt=media&token=${token}`;
  console.log('LIVE_VIDEO_QA_COMPOSED', { jobId, count, sizeBytes, composeMs, validationMs, steps: steps.length });
  return {
    ok: true, url, finalName, sizeBytes, under16MB: sizeBytes < 16 * 1024 * 1024,
    composeMs, composeSteps: steps.length, downloadMs, validationMs, container, ffprobe,
  };
});
