// Lógica pura del prototipo QA "Live Video" (sin DOM ni Firebase): elección del
// formato del grabador, cola de subida de chunks con backlog medible y reporte.
// Es un prototipo de medición — no forma parte del envío de WhatsApp.

export const MAX_RECORD_SECONDS = 60;
export const CHUNK_MS = 2000;
export const AUDIO_BITRATE = 64_000;
export const VIDEO_BITRATE_OPTIONS = [1_200_000, 1_400_000, 1_600_000] as const;
export const WHATSAPP_VIDEO_LIMIT_BYTES = 16 * 1024 * 1024;

// En orden de preferencia: MP4 + H.264 + AAC primero (lo que acepta WhatsApp sin
// transcodificar); el resto solo como respaldo para medir qué entrega el equipo.
export const RECORDER_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.4D401F,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=h264,aac',
  'video/mp4',
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const;

export interface MimeSupport {
  chosen: string | null;
  tested: { mime: string; supported: boolean }[];
  /** true solo si el elegido es MP4 con H.264 y AAC explícitos. */
  mp4H264Aac: boolean;
  isMp4: boolean;
}

export function pickRecorderMime(isSupported: (mime: string) => boolean): MimeSupport {
  const tested = RECORDER_MIME_CANDIDATES.map(mime => {
    let supported = false;
    try { supported = !!isSupported(mime); } catch { supported = false; }
    return { mime, supported };
  });
  const chosen = tested.find(t => t.supported)?.mime ?? null;
  const lower = (chosen || '').toLowerCase();
  const isMp4 = lower.startsWith('video/mp4');
  const mp4H264Aac = isMp4 && /(avc1|h264)/.test(lower) && /(mp4a|aac)/.test(lower);
  return { chosen, tested, mp4H264Aac, isMp4 };
}

export function newJobId(rand: () => number = Math.random, now: () => number = Date.now): string {
  const r = Array.from({ length: 6 }, () => Math.floor(rand() * 36).toString(36)).join('');
  return `${now().toString(36)}${r}`.slice(0, 20);
}

export interface ChunkRecord {
  index: number;
  size: number;
  createdAt: number;
  uploadStartedAt: number | null;
  uploadCompletedAt: number | null;
  attempts: number;
  error: string | null;
}

export interface QueueStats {
  chunksCreated: number;
  chunksUploaded: number;
  chunksFailed: number;
  bytesCreated: number;
  bytesUploaded: number;
  backlogBytes: number;
  backlogChunks: number;
}

interface QueueOptions {
  concurrency: number;
  upload: (index: number, blob: Blob) => Promise<void>;
  now?: () => number;
  maxAttempts?: number;
  /** Espera entre reintentos; inyectable para pruebas. */
  delay?: (ms: number) => Promise<void>;
}

/**
 * Sube los chunks MIENTRAS el grabador sigue produciendo. No espera al final:
 * cada chunk entra a la cola apenas llega y se sube con `concurrency` en
 * paralelo. El backlog (creado - subido) es la medida honesta de si la red
 * sigue el ritmo de la grabación.
 */
export class ChunkUploadQueue {
  readonly records: ChunkRecord[] = [];
  private pending: { index: number; blob: Blob }[] = [];
  private active = 0;
  private waiters: (() => void)[] = [];
  private readonly now: () => number;
  private readonly maxAttempts: number;
  private readonly delay: (ms: number) => Promise<void>;

  private readonly opts: QueueOptions;

  constructor(opts: QueueOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.delay = opts.delay ?? (ms => new Promise(r => setTimeout(r, ms)));
  }

  add(index: number, blob: Blob): void {
    this.records.push({ index, size: blob.size, createdAt: this.now(), uploadStartedAt: null, uploadCompletedAt: null, attempts: 0, error: null });
    this.pending.push({ index, blob });
    this.pump();
  }

  private record(index: number): ChunkRecord {
    return this.records.find(r => r.index === index)!;
  }

  private pump(): void {
    while (this.active < this.opts.concurrency && this.pending.length) {
      const job = this.pending.shift()!;
      this.active++;
      void this.run(job.index, job.blob).finally(() => {
        this.active--;
        this.pump();
        this.notify();
      });
    }
  }

  private async run(index: number, blob: Blob): Promise<void> {
    const rec = this.record(index);
    rec.uploadStartedAt = rec.uploadStartedAt ?? this.now();
    while (rec.attempts < this.maxAttempts) {
      rec.attempts++;
      try {
        await this.opts.upload(index, blob);
        rec.uploadCompletedAt = this.now();
        rec.error = null;
        return;
      } catch (e) {
        rec.error = (e as { code?: string; message?: string })?.code || (e as Error)?.message || 'error';
        if (rec.attempts < this.maxAttempts) await this.delay(500 * rec.attempts);
      }
    }
  }

  private notify(): void {
    if (this.active === 0 && this.pending.length === 0) {
      const w = this.waiters;
      this.waiters = [];
      w.forEach(fn => fn());
    }
  }

  /** Resuelve cuando no queda nada subiendo ni en espera (incluidos reintentos). */
  idle(): Promise<void> {
    if (this.active === 0 && this.pending.length === 0) return Promise.resolve();
    return new Promise(resolve => this.waiters.push(resolve));
  }

  stats(): QueueStats {
    const done = this.records.filter(r => r.uploadCompletedAt !== null);
    const failed = this.records.filter(r => r.uploadCompletedAt === null && r.error !== null && r.attempts >= this.maxAttempts);
    const bytesCreated = this.records.reduce((n, r) => n + r.size, 0);
    const bytesUploaded = done.reduce((n, r) => n + r.size, 0);
    return {
      chunksCreated: this.records.length,
      chunksUploaded: done.length,
      chunksFailed: failed.length,
      bytesCreated,
      bytesUploaded,
      backlogBytes: bytesCreated - bytesUploaded,
      backlogChunks: this.records.length - done.length,
    };
  }
}

const mb = (bytes: number): number => +(bytes / 1048576).toFixed(2);
export const toMb = mb;

export interface LiveVideoSession {
  device: string;
  mime: MimeSupport;
  actualMime: string | null;
  requestedVideoBps: number;
  requestedAudioBps: number;
  trackSettings: { width?: number; height?: number; frameRate?: number } | null;
  recordedSeconds: number;
  stats: QueueStats;
  /** Registro por chunk (tamaño y tiempos). */
  records: ChunkRecord[];
  /** Backlog (bytes creados - subidos) en el instante de STOP. */
  backlogAtStopBytes: number | null;
  /** Marca de tiempo (ms) de STOP, de que terminó la última subida y de READY. */
  stopAt: number | null;
  uploadsDoneAt: number | null;
  readyAt: number | null;
  serverResult: {
    sizeBytes: number; under16MB: boolean; composeMs: number; composeSteps: number; downloadMs: number; validationMs: number;
    container: { container: string; fragmented: boolean; mvhdDurationSec: number | null; mehdDurationSec: number | null; moovBeforeMdat: boolean | null; firstBoxes: string[] } | null;
    ffprobe: { formatName?: string; durationSec?: number | null; bitRate?: number | null; video?: { codec?: string; profile?: string; width?: number; height?: number; avgFrameRate?: string } | null; audio?: { codec?: string; channels?: number } | null; error?: string } | null;
  } | null;
  quality: 'si' | 'no' | null;
  error: string | null;
}

/** Reporte de texto copiable (sin secretos), con los nombres que pidió el QA. */
export function buildReport(s: LiveVideoSession): string {
  const sec = Math.max(s.recordedSeconds, 0.001);
  const st = s.stats;
  const recRate = (st.bytesCreated * 8) / sec;
  const upRate = uploadRateBps(s.records);
  const r = s.serverResult;
  const lines: (string | null)[] = [
    'LIVE_VIDEO_QA_REPORT',
    `DEVICE: ${s.device}`,
    `RECORDER_MIME_SUPPORTED: ${s.mime.tested.filter(t => t.supported).map(t => t.mime).join(' | ') || 'ninguno'}`,
    `MP4_H264_AAC_SUPPORTED: ${s.mime.mp4H264Aac ? 'YES' : 'NO'}`,
    `ACTUAL_RECORDER_MIME: ${s.actualMime || 'n/d'}`,
    `REQUESTED_VIDEO_BITRATE: ${(s.requestedVideoBps / 1e6).toFixed(2)} Mbps`,
    `REQUESTED_AUDIO_BITRATE: ${(s.requestedAudioBps / 1e3).toFixed(0)} kbps`,
    `EFFECTIVE_TOTAL_BITRATE (grabado): ${(recRate / 1e6).toFixed(2)} Mbps`,
    `TRACK_SETTINGS: ${s.trackSettings ? `${s.trackSettings.width}x${s.trackSettings.height} @${s.trackSettings.frameRate ?? '?'}fps` : 'n/d'}`,
    `RECORDED_SECONDS: ${s.recordedSeconds.toFixed(1)}`,
    `RECORDED_MB: ${mb(st.bytesCreated)}`,
    `CHUNKS_CREATED: ${st.chunksCreated}`,
    `CHUNKS_UPLOADED: ${st.chunksUploaded}${st.chunksFailed ? ` (FALLARON ${st.chunksFailed})` : ''}`,
    `UPLOADED_MB: ${mb(st.bytesUploaded)}`,
    s.backlogAtStopBytes !== null ? `UPLOAD_BACKLOG_MB_AT_STOP: ${mb(s.backlogAtStopBytes)}` : null,
    `AVERAGE_RECORDING_RATE: ${(recRate / 1e6).toFixed(2)} Mbps`,
    upRate !== null ? `AVERAGE_UPLOAD_RATE: ${(upRate / 1e6).toFixed(2)} Mbps` : null,
    s.stopAt !== null && s.uploadsDoneAt !== null ? `FINAL_CHUNK_UPLOAD_TIME_MS: ${s.uploadsDoneAt - s.stopAt}` : null,
    r ? `COMPOSE_TIME_MS: ${r.composeMs} (pasos: ${r.composeSteps})` : null,
    r ? `VALIDATION_TIME_MS: ${r.validationMs} (descarga ${r.downloadMs})` : null,
    s.stopAt !== null && s.readyAt !== null ? `STOP_TO_READY_MS: ${s.readyAt - s.stopAt}` : null,
    r ? `FINAL_SIZE_MB: ${mb(r.sizeBytes)}` : null,
    r ? `VIDEO_FINAL_UNDER_16MB: ${r.under16MB ? 'YES' : 'NO'}` : null,
    r?.ffprobe && !r.ffprobe.error ? `FFPROBE: ${r.ffprobe.formatName} dur=${r.ffprobe.durationSec ?? 'N/A'}s total=${r.ffprobe.bitRate ? (r.ffprobe.bitRate / 1e6).toFixed(2) + 'Mbps' : 'N/A'}` : null,
    r?.ffprobe && !r.ffprobe.error ? `CODECS: video=${r.ffprobe.video?.codec ?? '-'}(${r.ffprobe.video?.profile ?? '-'}) ${r.ffprobe.video?.width}x${r.ffprobe.video?.height} ${r.ffprobe.video?.avgFrameRate ?? ''} audio=${r.ffprobe.audio?.codec ?? 'sin audio'}` : null,
    r?.ffprobe?.error ? `FFPROBE_ERROR: ${r.ffprobe.error}` : null,
    r?.container ? `CONTAINER: ${r.container.container} fragmentado=${r.container.fragmented} moovAntesDeMdat=${r.container.moovBeforeMdat} mvhd=${r.container.mvhdDurationSec ?? 'N/A'}s mehd=${r.container.mehdDurationSec ?? 'N/A'}s cajas=${r.container.firstBoxes.join(',')}` : null,
    `UPLOAD_KEPT_UP_WITH_RECORDING: ${uploadKeptUp(s.backlogAtStopBytes, st) ? 'YES' : 'NO'}`,
    `QUALITY_ACCEPTABLE: ${s.quality === 'si' ? 'YES' : s.quality === 'no' ? 'NO' : 'sin evaluar'}`,
    s.error ? `ERROR: ${s.error}` : null,
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}

/**
 * Velocidad efectiva de subida: bytes subidos ÷ ventana desde que empezó la
 * primera subida hasta que terminó la última. Si el uso es en ráfagas, mide la
 * velocidad "mientras subía" y no la de la red.
 */
export function uploadRateBps(records: ChunkRecord[]): number | null {
  const done = records.filter(r => r.uploadCompletedAt !== null && r.uploadStartedAt !== null);
  if (!done.length) return null;
  const start = Math.min(...done.map(r => r.uploadStartedAt as number));
  const end = Math.max(...done.map(r => r.uploadCompletedAt as number));
  const seconds = (end - start) / 1000;
  if (seconds <= 0) return null;
  return (done.reduce((n, r) => n + r.size, 0) * 8) / seconds;
}

/** La subida "siguió el ritmo" si al detener quedaba como mucho ~2 chunks o el 5 % del total. */
export function uploadKeptUp(backlogAtStopBytes: number | null, stats: QueueStats): boolean {
  if (backlogAtStopBytes === null) return false;
  const avgChunk = stats.chunksCreated ? stats.bytesCreated / stats.chunksCreated : 0;
  return backlogAtStopBytes <= Math.max(2 * avgChunk, stats.bytesCreated * 0.05);
}

/** Relojes detrás de funciones nombradas: la vista los usa solo desde handlers/eventos. */
export const clockMs = (): number => performance.now();
export const wallMs = (): number => Date.now();
