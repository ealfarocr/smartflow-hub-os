// Live Video PRODUCTIVO dentro del chat de WhatsApp. Lógica pura (sin DOM ni
// Firebase) para probarla. La cola de subida y la elección del formato son las
// del prototipo QA ya validado físicamente (src/modules/qa/liveVideo.ts) — acá
// no se reimplementan, solo se fijan los parámetros de producción.
import { pickRecorderMime, type MimeSupport } from '@/modules/qa/liveVideo';

export { AUDIO_BITRATE, CHUNK_MS, ChunkUploadFailedError, ChunkUploadQueue, clockMs, newJobId, pickRecorderMime } from '@/modules/qa/liveVideo';

// V1: 60 s a ~1,4 Mbps de video + 64 kbps de audio (≈11 MB; límite de WhatsApp 16 MB).
// No subir el bitrate: el resultado validado físicamente fue suficiente.
export const CHAT_MAX_SECONDS = 60;
export const CHAT_VIDEO_BITRATE = 1_400_000;
export const CHAT_UPLOAD_CONCURRENCY = 3;

export interface LiveVideoSupport {
  supported: boolean;
  /** Motivo técnico, solo para diagnóstico (nunca se le muestra al vendedor). */
  reason: 'ok' | 'insecure-context' | 'no-media-recorder' | 'no-camera-api' | 'no-mp4-h264-aac';
  mime: MimeSupport;
}

export interface SupportEnv {
  isSecureContext: boolean;
  hasMediaRecorder: boolean;
  isTypeSupported: (mime: string) => boolean;
  hasGetUserMedia: boolean;
}

const NO_MIME: MimeSupport = { chosen: null, tested: [], mp4H264Aac: false, isMp4: false };

/**
 * ¿Se puede usar el fast path validado? Solo si el navegador graba MP4 con
 * H.264 + AAC explícitos (lo que WhatsApp acepta sin transcodificar). Si no,
 * el llamador usa la cámara nativa del teléfono, como antes.
 */
export function detectLiveVideoSupport(env: SupportEnv): LiveVideoSupport {
  if (!env.isSecureContext) return { supported: false, reason: 'insecure-context', mime: NO_MIME };
  if (!env.hasMediaRecorder) return { supported: false, reason: 'no-media-recorder', mime: NO_MIME };
  if (!env.hasGetUserMedia) return { supported: false, reason: 'no-camera-api', mime: NO_MIME };
  const mime = pickRecorderMime(env.isTypeSupported);
  if (!mime.mp4H264Aac) return { supported: false, reason: 'no-mp4-h264-aac', mime };
  return { supported: true, reason: 'ok', mime };
}

export function detectLiveVideoSupportInBrowser(): LiveVideoSupport {
  if (typeof window === 'undefined') return { supported: false, reason: 'no-media-recorder', mime: NO_MIME };
  return detectLiveVideoSupport({
    isSecureContext: window.isSecureContext === true,
    hasMediaRecorder: typeof MediaRecorder !== 'undefined',
    isTypeSupported: (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
    hasGetUserMedia: !!navigator.mediaDevices?.getUserMedia,
  });
}

// Misma forma que chatChunkObjectName del backend y que storage.rules.
export const chatChunkPath = (tenantId: string, conversationId: string, uid: string, jobId: string, index: number): string =>
  `chat-live-video/${tenantId}/${conversationId}/${uid}/${jobId}/c${String(index).padStart(4, '0')}`;

export const formatClock = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** video-20261017-154502.mp4 — siempre termina en .mp4 (el backend de WhatsApp decide el tipo por la extensión). */
export function liveVideoFilename(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `video-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.mp4`;
}

export type FinishingStage = 'uploading' | 'preparing';

/** Texto simple para el vendedor mientras termina; sin chunks, bytes ni jerga. */
export function finishingLabel(stage: FinishingStage): string {
  return stage === 'uploading' ? 'Terminando de cargar video…' : 'Preparando video…';
}

export const shouldAutoStop = (elapsedSeconds: number): boolean => elapsedSeconds >= CHAT_MAX_SECONDS;

/** Mensaje accionable (sin jerga) para un fallo al preparar o enviar. */
export function liveVideoErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code || '';
  const msg = (err as { message?: string } | null)?.message || '';
  if (code === 'functions/failed-precondition' || code === 'functions/invalid-argument') return msg || 'No se pudo preparar el video. Probá grabar de nuevo.';
  if (code === 'functions/permission-denied') return 'No tenés permiso para enviar video en esta conversación.';
  if (code === 'functions/unauthenticated' || code === 'storage/unauthenticated') return 'Tu sesión venció. Entrá de nuevo para enviar el video.';
  if (code === 'storage/unauthorized') return 'No se pudo subir el video con tu usuario. Avisale al administrador.';
  if (code === 'network/offline') return 'Sin conexión. Revisá tu internet y probá de nuevo.';
  // storage/retry-limit-exceeded, storage/canceled, storage/unknown y desconocidos:
  // no se afirma que sea la red; el código técnico se muestra aparte (liveVideoTechCode).
  return 'No se pudo preparar el video.';
}

/**
 * Línea técnica pequeña para QA (captura desde Android). Solo código y número de
 * fragmento: nunca uid, tenant, conversación, rutas, URLs ni tokens.
 * Devuelve null si no hay un código distinguible.
 */
export function liveVideoTechCode(err: unknown): string | null {
  const e = err as { code?: unknown; failure?: { code?: unknown; name?: unknown; chunkIndex?: unknown } } | null;
  const safe = /^[a-z0-9_-]+\/[a-z0-9_-]+$/i;
  const rawCode = typeof e?.code === 'string' ? e.code : typeof e?.failure?.code === 'string' ? e.failure.code : '';
  const rawName = typeof e?.failure?.name === 'string' ? e.failure.name : '';
  let label = '';
  if (safe.test(rawCode)) label = rawCode;
  else if (/^[A-Za-z]+Error$/.test(rawName) && rawName !== 'Error' && rawName !== 'ChunkUploadFailedError') label = rawName;
  if (!label) return null;
  const idx = e?.failure?.chunkIndex;
  return typeof idx === 'number' && Number.isFinite(idx) ? `${label} · fragmento ${idx + 1}` : label;
}
