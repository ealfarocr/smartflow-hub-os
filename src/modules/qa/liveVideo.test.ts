import { describe, it, expect } from 'vitest';
import {
  ChunkUploadQueue, buildReport, newJobId, pickRecorderMime, uploadKeptUp, uploadRateBps,
  type LiveVideoSession,
} from './liveVideo';

const blob = (n: number) => new Blob([new Uint8Array(n)]);
const noDelay = () => Promise.resolve();
const tick = () => new Promise(r => setTimeout(r, 0));

describe('pickRecorderMime', () => {
  it('prefiere MP4 + H.264 + AAC cuando el equipo lo soporta', () => {
    const r = pickRecorderMime(m => m.startsWith('video/mp4'));
    expect(r.chosen).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2');
    expect(r.mp4H264Aac).toBe(true);
    expect(r.isMp4).toBe(true);
  });
  it('solo "video/mp4" genérico: MP4 pero sin garantía de H.264/AAC', () => {
    const r = pickRecorderMime(m => m === 'video/mp4');
    expect(r.chosen).toBe('video/mp4');
    expect(r.isMp4).toBe(true);
    expect(r.mp4H264Aac).toBe(false);
  });
  it('sin MP4: cae a WebM y lo marca como no compatible con WhatsApp directo', () => {
    const r = pickRecorderMime(m => m.startsWith('video/webm'));
    expect(r.chosen).toBe('video/webm;codecs=h264,opus');
    expect(r.isMp4).toBe(false);
    expect(r.mp4H264Aac).toBe(false);
  });
  it('nada soportado, o isTypeSupported que lanza => sin formato', () => {
    expect(pickRecorderMime(() => false).chosen).toBeNull();
    expect(pickRecorderMime(() => { throw new Error('x'); }).chosen).toBeNull();
  });
  it('registra qué se probó, en orden', () => {
    const r = pickRecorderMime(() => false);
    expect(r.tested[0].mime).toContain('video/mp4');
    expect(r.tested.length).toBeGreaterThanOrEqual(8);
  });
});

describe('newJobId', () => {
  it('cumple el formato que valida el servidor (a-z0-9, 8-32)', () => {
    for (let i = 0; i < 50; i++) expect(newJobId()).toMatch(/^[a-z0-9]{8,32}$/);
  });
});

describe('ChunkUploadQueue: sube mientras se graba', () => {
  it('empieza a subir los primeros chunks sin esperar a que termine la grabación', () => {
    const started: number[] = [];
    const q = new ChunkUploadQueue({ concurrency: 3, upload: (i) => { started.push(i); return new Promise(() => {}); }, delay: noDelay });
    q.add(0, blob(100));
    q.add(1, blob(100));
    expect(started).toEqual([0, 1]);
  });
  it('respeta la concurrencia y despacha el siguiente al liberarse un lugar', async () => {
    const resolvers: (() => void)[] = [];
    const started: number[] = [];
    const q = new ChunkUploadQueue({ concurrency: 2, upload: (i) => { started.push(i); return new Promise<void>(r => resolvers.push(r)); }, delay: noDelay });
    [0, 1, 2, 3].forEach(i => q.add(i, blob(10)));
    expect(started).toEqual([0, 1]);
    resolvers[0]();
    await tick();
    expect(started).toEqual([0, 1, 2]);
  });
  it('backlog = creado - subido, y baja a 0 al terminar', async () => {
    const resolvers: (() => void)[] = [];
    const q = new ChunkUploadQueue({ concurrency: 1, upload: () => new Promise<void>(r => resolvers.push(r)), delay: noDelay });
    q.add(0, blob(300));
    q.add(1, blob(200));
    expect(q.stats()).toMatchObject({ chunksCreated: 2, chunksUploaded: 0, bytesCreated: 500, backlogBytes: 500, backlogChunks: 2 });
    resolvers[0]();
    await tick();
    expect(q.stats()).toMatchObject({ chunksUploaded: 1, bytesUploaded: 300, backlogBytes: 200 });
    resolvers[1]();
    await q.idle();
    expect(q.stats()).toMatchObject({ chunksUploaded: 2, backlogBytes: 0, backlogChunks: 0 });
  });
  it('idle() espera a los reintentos y termina cuando el chunk por fin sube', async () => {
    let calls = 0;
    const q = new ChunkUploadQueue({
      concurrency: 1,
      upload: async () => { calls++; if (calls < 3) throw Object.assign(new Error('red'), { code: 'storage/retry-limit-exceeded' }); },
      delay: noDelay,
    });
    q.add(0, blob(50));
    await q.idle();
    expect(calls).toBe(3);
    expect(q.records[0]).toMatchObject({ attempts: 3, error: null });
    expect(q.stats().chunksFailed).toBe(0);
  });
  it('tras agotar los reintentos el chunk queda como fallido (no se oculta)', async () => {
    const q = new ChunkUploadQueue({
      concurrency: 1, maxAttempts: 2, delay: noDelay,
      upload: async () => { throw Object.assign(new Error('x'), { code: 'storage/unauthorized' }); },
    });
    q.add(0, blob(50));
    await q.idle();
    expect(q.stats()).toMatchObject({ chunksFailed: 1, chunksUploaded: 0, backlogBytes: 50 });
    expect(q.records[0].error).toBe('storage/unauthorized');
  });
  it('idle() sin trabajo resuelve de inmediato', async () => {
    await new ChunkUploadQueue({ concurrency: 1, upload: async () => {} }).idle();
  });
  it('registra index, size y tiempos por chunk', async () => {
    let t = 1000;
    const q = new ChunkUploadQueue({ concurrency: 1, now: () => (t += 10), upload: async () => {}, delay: noDelay });
    q.add(0, blob(123));
    await q.idle();
    const r = q.records[0];
    expect(r).toMatchObject({ index: 0, size: 123 });
    expect(r.createdAt).toBeLessThan(r.uploadStartedAt as number);
    expect(r.uploadStartedAt as number).toBeLessThan(r.uploadCompletedAt as number);
  });
});

describe('velocidades y ritmo', () => {
  const rec = (size: number, start: number, end: number) => ({ index: 0, size, createdAt: 0, uploadStartedAt: start, uploadCompletedAt: end, attempts: 1, error: null });
  it('uploadRateBps: bytes por 8 sobre la ventana de subida', () => {
    expect(uploadRateBps([rec(125_000, 0, 1000), rec(125_000, 1000, 2000)])).toBeCloseTo(1_000_000);
    expect(uploadRateBps([])).toBeNull();
  });
  it('uploadKeptUp: poco backlog al detener = siguió el ritmo; mucho = no', () => {
    const stats = { chunksCreated: 30, chunksUploaded: 29, chunksFailed: 0, bytesCreated: 10_000_000, bytesUploaded: 9_700_000, backlogBytes: 300_000, backlogChunks: 1 };
    expect(uploadKeptUp(300_000, stats)).toBe(true);
    expect(uploadKeptUp(6_000_000, stats)).toBe(false);
    expect(uploadKeptUp(null, stats)).toBe(false);
  });
});

describe('buildReport', () => {
  it('incluye los campos que pide el QA y no inventa lo que no se midió', () => {
    const s: LiveVideoSession = {
      device: 'Android test',
      mime: pickRecorderMime(m => m.startsWith('video/mp4')),
      actualMime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      requestedVideoBps: 1_400_000,
      requestedAudioBps: 64_000,
      trackSettings: { width: 720, height: 1280, frameRate: 30 },
      recordedSeconds: 60,
      stats: { chunksCreated: 30, chunksUploaded: 30, chunksFailed: 0, bytesCreated: 11_000_000, bytesUploaded: 11_000_000, backlogBytes: 0, backlogChunks: 0 },
      records: [],
      backlogAtStopBytes: 200_000,
      stopAt: 1000,
      uploadsDoneAt: 1800,
      readyAt: 3200,
      serverResult: {
        sizeBytes: 11_000_000, under16MB: true, composeMs: 600, composeSteps: 1, downloadMs: 300, validationMs: 900,
        container: { container: 'mp4', fragmented: true, mvhdDurationSec: 0, mehdDurationSec: null, moovBeforeMdat: true, firstBoxes: ['ftyp', 'moov'] },
        ffprobe: null,
      },
      quality: 'si',
      error: null,
    };
    const text = buildReport(s);
    for (const k of ['MP4_H264_AAC_SUPPORTED: YES', 'STOP_TO_READY_MS: 2200', 'FINAL_CHUNK_UPLOAD_TIME_MS: 800', 'VIDEO_FINAL_UNDER_16MB: YES',
      'UPLOAD_BACKLOG_MB_AT_STOP', 'AVERAGE_RECORDING_RATE', 'QUALITY_ACCEPTABLE: YES', 'fragmentado=true']) {
      expect(text).toContain(k);
    }
    expect(text).toContain('UPLOAD_KEPT_UP_WITH_RECORDING: YES');
    expect(text).not.toMatch(/token|secret|password/i);
  });
});
