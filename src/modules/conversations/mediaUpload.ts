// Lógica pura de los adjuntos del chat (fotos, videos, audio, documentos): qué
// tipo es, cuánto puede pesar, por qué se rechaza, cómo se explica un fallo y
// en qué estado está cada adjunto. La vista solo la conecta — así se prueba sin
// montar React y el comportamiento que ya funciona (fotos, videos < 16 MB) no
// cambia: los límites y la ruta de Storage son exactamente los de antes.

export type PendingMediaKind = 'image' | 'video' | 'audio' | 'document';
export type PendingMediaStatus = 'uploading' | 'ready' | 'sending' | 'sent' | 'error';

export interface PendingMediaItem {
  id: string;
  localPreviewUrl: string;
  filename: string;
  kind: PendingMediaKind;
  status: PendingMediaStatus;
  remoteUrl: string | null;
  /** 0-100, solo mientras sube. */
  progress: number;
  /** Motivo concreto cuando status === 'error'. */
  errorMessage?: string;
  /** Huella para no agregar dos veces el mismo archivo mientras todavía sube. */
  fileKey?: string;
}

// Límites de WhatsApp Cloud API por tipo (sin cambios).
export const MEDIA_SIZE_LIMITS: Record<PendingMediaKind, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

const MB = 1024 * 1024;

export function classifyFile(file: { name: string; type: string }): PendingMediaKind {
  if (file.type.startsWith('video/') || /\.(mp4|mov|3gp|webm)$/i.test(file.name)) return 'video';
  if (file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name)) return 'image';
  if (file.type.startsWith('audio/') || /\.(ogg|mp3|m4a|aac|wav|opus)$/i.test(file.name)) return 'audio';
  return 'document';
}

export const formatMb = (bytes: number): string => (bytes / MB).toFixed(1);

export interface RejectionNotice { title: string; detail: string }

/**
 * Aviso persistente cuando un archivo no puede enviarse por tamaño. Dice cuánto
 * pesa, cuál es el límite y qué hacer. El texto del video es el acordado.
 */
export function oversizeNotice(kind: PendingMediaKind, sizeBytes: number): RejectionNotice {
  const size = formatMb(sizeBytes);
  const limit = (MEDIA_SIZE_LIMITS[kind] / MB).toFixed(0);
  const advice: Record<PendingMediaKind, string> = {
    video: 'Grabe un video más corto o reduzca la calidad.',
    image: 'Elegí una foto más liviana.',
    audio: 'Grabá un audio más corto.',
    document: 'Usá un archivo más liviano.',
  };
  const noun: Record<PendingMediaKind, string> = {
    video: 'Este video', image: 'Esta imagen', audio: 'Este audio', document: 'Este documento',
  };
  return {
    title: 'No se pudo enviar el archivo',
    detail: `${noun[kind]} pesa ${size} MB. WhatsApp permite máximo ${limit} MB. ${advice[kind]}`,
  };
}

export type MediaValidation =
  | { ok: true; kind: PendingMediaKind }
  | { ok: false; kind: PendingMediaKind; notice: RejectionNotice };

/**
 * Validación previa a la subida. Las fotos NO se rechazan acá: se miden
 * después de comprimir (una foto de 6 MB queda en menos de 1 MB). Un MIME
 * desconocido entra como documento, igual que antes.
 */
export function validateMediaFile(file: { name: string; type: string; size: number }): MediaValidation {
  const kind = classifyFile(file);
  if (kind !== 'image' && file.size > MEDIA_SIZE_LIMITS[kind]) {
    return { ok: false, kind, notice: oversizeNotice(kind, file.size) };
  }
  return { ok: true, kind };
}

/** Ruta de Storage del adjunto: siempre bajo el tenant activo (aislamiento). */
export function buildChatAttachmentPath(tenantId: string, safeName: string, now: number = Date.now()): string {
  return `chat-attachments/${tenantId}/${now}-${safeName}`;
}

export function progressPercent(bytesTransferred: number, totalBytes: number): number {
  if (!totalBytes || totalBytes <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((bytesTransferred / totalBytes) * 100)));
}

const codeOf = (err: unknown): string =>
  err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';

/**
 * Motivo concreto de un fallo de subida, para mostrarlo en el propio adjunto.
 * Nunca "unknown error": si no hay causa conocida, se muestra el código.
 */
export function describeUploadFailure(err: unknown): string {
  const code = codeOf(err);
  const lower = code.toLowerCase();
  if (lower.includes('retry-limit') || lower.includes('canceled') || lower.includes('network')) {
    return 'Se cortó la subida. Revisá tu conexión y reintentá.';
  }
  if (lower.includes('no-current-user')) return 'Tu sesión se cerró. Entrá de nuevo.';
  if (lower.includes('unauthorized') || lower.includes('unauthenticated')) {
    return 'No tenés permiso para subir este archivo. Probá de nuevo o avisale a tu administrador.';
  }
  if (lower.includes('quota')) return 'El almacenamiento no tiene espacio. Avisale a tu administrador.';
  if (lower.includes('object-not-found') || lower.includes('invalid')) {
    return `El archivo no se pudo leer o es inválido (${code}).`;
  }
  return `No se pudo subir el archivo (${code || 'sin código'}). Intentá nuevamente.`;
}

/** Huella barata de un File para detectar el mismo archivo agregado dos veces. */
export function fileKeyOf(file: { name: string; size: number; lastModified?: number }): string {
  return `${file.name}|${file.size}|${file.lastModified ?? 0}`;
}

export type PendingMediaAction =
  | { type: 'add'; item: PendingMediaItem }
  | { type: 'progress'; id: string; pct: number }
  | { type: 'ready'; id: string; url: string; filename: string }
  | { type: 'fail'; id: string; message: string }
  | { type: 'sending'; ids: string[] }
  | { type: 'sent'; id: string }
  | { type: 'unlock-sending' }
  | { type: 'remove'; id: string }
  | { type: 'clear' };

/** Estado de los adjuntos: transiciones permitidas y nada más. */
export function pendingMediaReducer(items: PendingMediaItem[], a: PendingMediaAction): PendingMediaItem[] {
  switch (a.type) {
    case 'add':
      // El mismo archivo mientras todavía sube = doble disparo del selector.
      if (a.item.fileKey && items.some(m => m.fileKey === a.item.fileKey && m.status === 'uploading')) return items;
      return [...items, a.item];
    case 'progress':
      return items.map(m => (m.id === a.id && m.status === 'uploading'
        ? { ...m, progress: Math.max(m.progress, Math.max(0, Math.min(100, a.pct))) }
        : m));
    case 'ready':
      return items.map(m => (m.id === a.id ? { ...m, status: 'ready', progress: 100, remoteUrl: a.url, filename: a.filename } : m));
    case 'fail':
      return items.map(m => (m.id === a.id ? { ...m, status: 'error', errorMessage: a.message } : m));
    case 'sending':
      return items.map(m => (a.ids.includes(m.id) && m.status === 'ready' ? { ...m, status: 'sending' } : m));
    case 'sent':
      return items.map(m => (m.id === a.id && m.status === 'sending' ? { ...m, status: 'sent' } : m));
    case 'unlock-sending':
      // Si el envío falló a medio camino, lo que no salió vuelve a 'ready' para
      // poder reintentar; lo que ya salió queda 'sent' y NO se manda otra vez.
      return items.map(m => (m.status === 'sending' ? { ...m, status: 'ready' } : m));
    case 'remove':
      return items.filter(m => m.id !== a.id);
    case 'clear':
      return [];
  }
}

/** Hay algo subiendo o enviándose: el botón de enviar debe quedar bloqueado. */
export const isMediaBusy = (items: PendingMediaItem[]): boolean =>
  items.some(m => m.status === 'uploading' || m.status === 'sending');

/** Adjuntos que se pueden mandar ahora (los 'sent' nunca se reenvían). */
export const readyToSend = (items: PendingMediaItem[]): PendingMediaItem[] =>
  items.filter(m => m.status === 'ready' && !!m.remoteUrl);

const KIND_LABEL: Record<PendingMediaKind, string> = { image: 'foto', video: 'video', audio: 'audio', document: 'archivo' };

/** Línea de estado visible bajo los adjuntos ("Subiendo… 37%"). */
export function statusLine(items: PendingMediaItem[]): { text: string; tone: 'info' | 'error' } | null {
  const failed = items.find(m => m.status === 'error');
  if (failed) return { text: `${KIND_LABEL[failed.kind][0].toUpperCase()}${KIND_LABEL[failed.kind].slice(1)}: ${failed.errorMessage || 'no se pudo subir.'}`, tone: 'error' };
  const uploading = items.filter(m => m.status === 'uploading');
  if (uploading.length) {
    const pct = Math.min(...uploading.map(m => m.progress));
    return { text: `Subiendo… ${pct}%`, tone: 'info' };
  }
  if (items.some(m => m.status === 'sending')) return { text: 'Enviando…', tone: 'info' };
  return null;
}
