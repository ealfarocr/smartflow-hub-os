import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile as nodeExecFile } from 'child_process';
import { planComposeBatches, summarizeMp4, isValidJobId } from './liveVideoQaCore';
import { checkConversationTenantMatch, checkMembershipAuth, type MembershipForSend } from './sendMessageAuth';

export { isValidJobId };

export const CHAT_LIVE_VIDEO_MAX_SECONDS = 60;
export const CHAT_LIVE_VIDEO_CHUNK_SECONDS = 2;
// 60 s / 2 s = 30 chunks + margen por chunks parciales al detener.
export const CHAT_LIVE_VIDEO_MAX_CHUNKS = 40;
// Límite de WhatsApp para video; el MP4 grabado a ~1,4 Mbps + 64 kbps queda en ~11 MB por 60 s.
export const CHAT_LIVE_VIDEO_MAX_BYTES = 16 * 1024 * 1024;
export const FFMPEG_TIMEOUT_MS = 30_000;
export const FFMPEG_DEFAULT_BINARY = '/usr/bin/ffmpeg';
const HEAD_BYTES = 64 * 1024;

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const isSafePathId = (v: unknown): v is string => typeof v === 'string' && SAFE_ID.test(v);

// chat-live-video/{tenantId}/{conversationId}/{uid}/{jobId}/ — aislado por tenant,
// conversación Y usuario (storage.rules replica esta forma: uid == request.auth.uid).
export const chatJobPrefix = (tenantId: string, conversationId: string, uid: string, jobId: string): string =>
  `chat-live-video/${tenantId}/${conversationId}/${uid}/${jobId}/`;
export const chatChunkObjectName = (tenantId: string, conversationId: string, uid: string, jobId: string, index: number): string =>
  `${chatJobPrefix(tenantId, conversationId, uid, jobId)}c${String(index).padStart(4, '0')}`;
export const chatCombinedFragmentedObjectName = (tenantId: string, conversationId: string, uid: string, jobId: string): string =>
  `${chatJobPrefix(tenantId, conversationId, uid, jobId)}combined-fragmented.mp4`;
export const chatFinalObjectName = (tenantId: string, conversationId: string, uid: string, jobId: string): string =>
  `${chatJobPrefix(tenantId, conversationId, uid, jobId)}final.mp4`;

export const FFMPEG_REMUX_ARGS = (inputPath: string, outputPath: string): string[] => [
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

export function resolveFfmpegBinary(customPath?: string): string | null {
  if (customPath && fs.existsSync(customPath)) return customPath;
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  if (fs.existsSync(FFMPEG_DEFAULT_BINARY)) return FFMPEG_DEFAULT_BINARY;
  if (fs.existsSync('/usr/local/bin/ffmpeg')) return '/usr/local/bin/ffmpeg';
  return null;
}

export type FfmpegRunner = (
  binary: string,
  args: string[],
  options: { timeout: number }
) => Promise<{ stdout: string; stderr: string }>;

export const defaultFfmpegRunner: FfmpegRunner = (binary, args, options) => {
  return new Promise((resolve, reject) => {
    nodeExecFile(binary, args, { timeout: options.timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(err);
      } else {
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    });
  });
};

export async function validateRemuxOutput(outputPath: string): Promise<{ sizeBytes: number }> {
  if (!fs.existsSync(outputPath)) {
    throw new LiveVideoError('failed-precondition', 'El archivo de video remuxeado no fue generado.');
  }
  const stat = await fs.promises.stat(outputPath);
  const sizeBytes = stat.size;
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new LiveVideoError('failed-precondition', 'El archivo de video generado está vacío.');
  }
  if (sizeBytes > CHAT_LIVE_VIDEO_MAX_BYTES) {
    throw new LiveVideoError('failed-precondition', 'El video pesa más de 16 MB y WhatsApp no lo acepta. Grabá uno más corto.');
  }

  // Leer cabecera para verificar que las cajas corresponden a un MP4 con faststart
  const headBytesToRead = Math.min(sizeBytes, HEAD_BYTES);
  const fd = await fs.promises.open(outputPath, 'r');
  const headBuf = Buffer.alloc(headBytesToRead);
  await fd.read(headBuf, 0, headBytesToRead, 0);
  await fd.close();

  const summary = summarizeMp4(headBuf);
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
  download(opts?: { start?: number; end?: number; destination?: string }): Promise<[Buffer] | unknown>;
}
export interface BucketLike {
  file(name: string): FileLike;
  combine(sources: FileLike[], destination: FileLike): Promise<unknown>;
  getFiles(opts: { prefix: string }): Promise<[FileLike[], ...unknown[]]>;
  upload?(localPath: string, opts?: { destination?: string | FileLike; contentType?: string; metadata?: Record<string, unknown> }): Promise<unknown>;
}

export interface ComposeParams {
  tenantId: string; conversationId: string; uid: string; jobId: string;
  chunkCount: number; mimeType: string | undefined; token: string;
  ffmpegBinaryPath?: string;
  ffmpegRunner?: FfmpegRunner;
}

const deleteFileQuiet = (f: FileLike | undefined) => (f ? f.delete({ ignoreNotFound: true }).catch(() => undefined) : Promise.resolve(undefined));
const deleteLocalQuiet = async (filePath: string | undefined) => {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  } catch {
    // ignore
  }
};

/** Descarta todo lo del job (cancelar / descartar el preview). Solo el prefijo del propio uid. */
export async function deleteChatLiveVideoJob(bucket: BucketLike, p: Omit<ComposeParams, 'chunkCount' | 'mimeType' | 'token'>): Promise<number> {
  const [files] = await bucket.getFiles({ prefix: chatJobPrefix(p.tenantId, p.conversationId, p.uid, p.jobId) });
  await Promise.all(files.map(deleteFileQuiet));
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

  // Resolver ejecutable de FFmpeg antes de alterar Storage
  const ffmpegBinary = resolveFfmpegBinary(p.ffmpegBinaryPath);
  if (!ffmpegBinary) {
    await Promise.all(Array.from({ length: p.chunkCount }, (_, i) => deleteFileQuiet(chunkFile(i))));
    throw new LiveVideoError('failed-precondition', 'El procesador de video (ffmpeg) no está disponible en el servidor.');
  }

  const combinedName = chatCombinedFragmentedObjectName(p.tenantId, p.conversationId, p.uid, p.jobId);
  const combinedFile = bucket.file(combinedName);
  const finalName = chatFinalObjectName(p.tenantId, p.conversationId, p.uid, p.jobId);
  const finalFile = bucket.file(finalName);

  const inputPath = path.join(os.tmpdir(), `live-video-${p.jobId}-combined-fragmented.mp4`);
  const outputPath = path.join(os.tmpdir(), `live-video-${p.jobId}-final.mp4`);

  let success = false;
  try {
    // 1. Combinar chunks a un objeto temporal fragmentado
    for (const step of planComposeBatches(p.chunkCount)) {
      const sources = [...(step.includesAccumulator ? [combinedFile] : []), ...step.chunkIndexes.map(chunkFile)];
      await bucket.combine(sources, combinedFile);
    }

    const [meta] = await combinedFile.getMetadata();
    const combinedSizeBytes = Number(meta?.size);
    if (!Number.isFinite(combinedSizeBytes) || combinedSizeBytes <= 0) {
      throw new LiveVideoError('failed-precondition', 'No se pudo preparar el video.');
    }
    if (combinedSizeBytes > CHAT_LIVE_VIDEO_MAX_BYTES) {
      throw new LiveVideoError('failed-precondition', 'El video pesa más de 16 MB y WhatsApp no lo acepta. Grabá uno más corto.');
    }

    // 2. Descargar objeto temporal fragmentado a /tmp
    await combinedFile.download({ destination: inputPath });

    // 3. Ejecutar FFmpeg remux (-map 0 -c copy -movflags +faststart)
    const runner = p.ffmpegRunner ?? defaultFfmpegRunner;
    const args = FFMPEG_REMUX_ARGS(inputPath, outputPath);
    try {
      await runner(ffmpegBinary, args, { timeout: FFMPEG_TIMEOUT_MS });
    } catch (err: unknown) {
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
  } finally {
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

