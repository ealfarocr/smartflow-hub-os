// Live Video PRODUCTIVO (grabar video desde SmartFlow y enviarlo por WhatsApp).
// Lógica pura / inyectable (sin firebase-admin) para probar rutas, autorización
// y el compose con un bucket falso: bucket.combine NO existe en el emulador de
// Storage, así que el orquestador recibe el bucket por parámetro.
//
// Fast path validado físicamente (MP4 H.264 + AAC grabado por MediaRecorder,
// ~57 s / 10.6 MB, Meta lo aceptó y el receptor lo reprodujo completo): sin
// transcodificar y sin ffprobe. El servidor solo compone los chunks, exige que
// el resultado sea un MP4 de <16 MB y publica el archivo final.
import { planComposeBatches, summarizeMp4, isValidJobId } from './liveVideoQaCore';
import { checkConversationTenantMatch, checkMembershipAuth, type MembershipForSend } from './sendMessageAuth';

export { isValidJobId };

export const CHAT_LIVE_VIDEO_MAX_SECONDS = 60;
export const CHAT_LIVE_VIDEO_CHUNK_SECONDS = 2;
// 60 s / 2 s = 30 chunks + margen por chunks parciales al detener.
export const CHAT_LIVE_VIDEO_MAX_CHUNKS = 40;
// Límite de WhatsApp para video; el MP4 grabado a ~1,4 Mbps + 64 kbps queda en ~11 MB por 60 s.
export const CHAT_LIVE_VIDEO_MAX_BYTES = 16 * 1024 * 1024;
const HEAD_BYTES = 64 * 1024;

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const isSafePathId = (v: unknown): v is string => typeof v === 'string' && SAFE_ID.test(v);

// chat-live-video/{tenantId}/{conversationId}/{uid}/{jobId}/ — aislado por tenant,
// conversación Y usuario (storage.rules replica esta forma: uid == request.auth.uid).
export const chatJobPrefix = (tenantId: string, conversationId: string, uid: string, jobId: string): string =>
  `chat-live-video/${tenantId}/${conversationId}/${uid}/${jobId}/`;
export const chatChunkObjectName = (tenantId: string, conversationId: string, uid: string, jobId: string, index: number): string =>
  `${chatJobPrefix(tenantId, conversationId, uid, jobId)}c${String(index).padStart(4, '0')}`;
export const chatFinalObjectName = (tenantId: string, conversationId: string, uid: string, jobId: string): string =>
  `${chatJobPrefix(tenantId, conversationId, uid, jobId)}final.mp4`;

export type LiveVideoErrorCode = 'invalid-argument' | 'failed-precondition' | 'permission-denied' | 'not-found';
export class LiveVideoError extends Error {
  constructor(readonly code: LiveVideoErrorCode, message: string) { super(message); }
}

export interface LiveVideoAuthInput {
  isSuperAdmin: boolean;
  membership: MembershipForSend | null;
  /** tenantId guardado en la conversación; null si la conversación no existe. */
  conversationTenantId: string | null;
  requestedTenantId: string;
}

/**
 * Mismo criterio que sendWhatsappMessage (el video termina enviándose por ahí):
 * membresía activa y rol distinto de "Solo lectura" (SuperAdmin exento), y la
 * conversación debe pertenecer EXACTAMENTE al tenant pedido — incluso para
 * SuperAdmin. La app no restringe conversaciones por asesor, así que tampoco
 * se restringe acá (sería más estricto que enviar el mensaje).
 */
export function authorizeLiveVideoCall(i: LiveVideoAuthInput): { ok: true } | { ok: false; code: LiveVideoErrorCode; message: string } {
  const m = checkMembershipAuth({ isSuperAdmin: i.isSuperAdmin, membership: i.membership });
  if (!m.allowed) {
    return { ok: false, code: 'permission-denied', message: m.reason === 'read-only-role' ? 'Tu rol es de solo lectura.' : 'No tenés una membresía activa en este negocio.' };
  }
  if (i.conversationTenantId === null) return { ok: false, code: 'not-found', message: 'Conversación no encontrada.' };
  if (!checkConversationTenantMatch(i.conversationTenantId, i.requestedTenantId)) {
    return { ok: false, code: 'permission-denied', message: 'La conversación no pertenece a este negocio.' };
  }
  return { ok: true };
}

export interface FileLike {
  exists(): Promise<[boolean]>;
  delete(opts?: { ignoreNotFound?: boolean }): Promise<unknown>;
  getMetadata(): Promise<[{ size?: string | number }]>;
  setMetadata(meta: Record<string, unknown>): Promise<unknown>;
  download(opts: { start: number; end: number }): Promise<[Buffer]>;
}
export interface BucketLike {
  file(name: string): FileLike;
  combine(sources: FileLike[], destination: FileLike): Promise<unknown>;
  getFiles(opts: { prefix: string }): Promise<[FileLike[], ...unknown[]]>;
}

export interface ComposeParams {
  tenantId: string; conversationId: string; uid: string; jobId: string;
  chunkCount: number; mimeType: string | undefined; token: string;
}

const deleteQuiet = (f: FileLike) => f.delete({ ignoreNotFound: true }).catch(() => undefined);

/** Descarta todo lo del job (cancelar / descartar el preview). Solo el prefijo del propio uid. */
export async function deleteChatLiveVideoJob(bucket: BucketLike, p: Omit<ComposeParams, 'chunkCount' | 'mimeType' | 'token'>): Promise<number> {
  const [files] = await bucket.getFiles({ prefix: chatJobPrefix(p.tenantId, p.conversationId, p.uid, p.jobId) });
  await Promise.all(files.map(deleteQuiet));
  return files.length;
}

export async function composeChatLiveVideo(bucket: BucketLike, p: ComposeParams): Promise<{ finalName: string; sizeBytes: number }> {
  if (!Number.isInteger(p.chunkCount) || p.chunkCount < 1 || p.chunkCount > CHAT_LIVE_VIDEO_MAX_CHUNKS) {
    throw new LiveVideoError('invalid-argument', 'La grabación no es válida (duración fuera de rango).');
  }
  // Solo el fast path validado: MP4. WebM no lo acepta WhatsApp y no se transcodifica.
  if (typeof p.mimeType === 'string' && p.mimeType.toLowerCase().startsWith('video/webm')) {
    throw new LiveVideoError('invalid-argument', 'Este teléfono graba en un formato que WhatsApp no acepta.');
  }

  const chunkFile = (i: number) => bucket.file(chatChunkObjectName(p.tenantId, p.conversationId, p.uid, p.jobId, i));
  // Un hueco produciría un MP4 "válido" con un salto: se rechaza antes de componer.
  const exists = await Promise.all(Array.from({ length: p.chunkCount }, (_, i) => chunkFile(i).exists().then(([e]) => e)));
  if (exists.some(e => !e)) {
    throw new LiveVideoError('failed-precondition', 'El video no terminó de subir. Probá grabar de nuevo.');
  }

  const finalName = chatFinalObjectName(p.tenantId, p.conversationId, p.uid, p.jobId);
  const finalFile = bucket.file(finalName);
  const cleanupAll = async () => {
    await deleteQuiet(finalFile);
    await Promise.all(Array.from({ length: p.chunkCount }, (_, i) => deleteQuiet(chunkFile(i))));
  };

  for (const step of planComposeBatches(p.chunkCount)) {
    const sources = [...(step.includesAccumulator ? [finalFile] : []), ...step.chunkIndexes.map(chunkFile)];
    await bucket.combine(sources, finalFile);
  }

  const [meta] = await finalFile.getMetadata();
  const sizeBytes = Number(meta.size);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    await cleanupAll();
    throw new LiveVideoError('failed-precondition', 'No se pudo preparar el video.');
  }
  if (sizeBytes > CHAT_LIVE_VIDEO_MAX_BYTES) {
    await cleanupAll();
    throw new LiveVideoError('failed-precondition', 'El video pesa más de 16 MB y WhatsApp no lo acepta. Grabá uno más corto.');
  }
  // Solo la cabecera: basta para confirmar que el contenedor es MP4 (ftyp/moov/moof).
  const [head] = await finalFile.download({ start: 0, end: HEAD_BYTES - 1 });
  if (summarizeMp4(head).container !== 'mp4') {
    await cleanupAll();
    throw new LiveVideoError('failed-precondition', 'El video no quedó en un formato compatible con WhatsApp.');
  }

  await finalFile.setMetadata({ contentType: 'video/mp4', metadata: { firebaseStorageDownloadTokens: p.token } });
  // El final ya está publicado: los chunks sobran (el QA los dejaba; acá no).
  await Promise.all(Array.from({ length: p.chunkCount }, (_, i) => deleteQuiet(chunkFile(i))));
  return { finalName, sizeBytes };
}
