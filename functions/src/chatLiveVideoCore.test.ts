import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import {
  CHAT_LIVE_VIDEO_MAX_BYTES, LiveVideoError, authorizeLiveVideoCall, chatChunkObjectName, chatCombinedFragmentedObjectName,
  chatFinalObjectName, chatJobPrefix, composeChatLiveVideo, deleteChatLiveVideoJob, isSafePathId,
  type BucketLike, type FileLike, type FfmpegRunner,
} from './chatLiveVideoCore';

const P = { tenantId: 'tA', conversationId: 'conv1', uid: 'u1', jobId: 'abcdefgh12' };
const MP4_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(16)]);
const WEBM_HEAD = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);

function makeBox(type: string, len = 16): Buffer {
  const b = Buffer.alloc(len);
  b.writeUInt32BE(len, 0);
  b.write(type, 4, 4, 'latin1');
  return b;
}

const VALID_REMUX_MP4 = Buffer.concat([
  makeBox('ftyp', 24),
  makeBox('moov', 32),
  makeBox('mdat', 64),
]);

const FRAGMENTED_MP4 = Buffer.concat([
  makeBox('ftyp', 24),
  makeBox('moov', 32),
  makeBox('moof', 32),
  makeBox('mdat', 64),
]);

const MDAT_BEFORE_MOOV_MP4 = Buffer.concat([
  makeBox('ftyp', 24),
  makeBox('mdat', 64),
  makeBox('moov', 32),
]);

// Bucket en memoria: combine suma tamaños y toma la cabecera del primer origen.
function namedBucket(opts: { chunks?: number; missing?: number[]; sizePerChunk?: number; head?: Buffer } = {}) {
  const { chunks = 3, missing = [], sizePerChunk = 1000, head = MP4_HEAD } = opts;
  const store = new Map<string, { size: number; head: Buffer; meta?: Record<string, unknown> }>();
  for (let i = 0; i < chunks; i++) {
    if (!missing.includes(i)) {
      store.set(chatChunkObjectName(P.tenantId, P.conversationId, P.uid, P.jobId, i), {
        size: sizePerChunk,
        head: i === 0 ? head : Buffer.alloc(8),
      });
    }
  }
  const combineCalls: string[][] = [];
  type Named = FileLike & { n: string };
  const mk = (n: string): Named => ({
    n,
    exists: async () => [store.has(n)],
    delete: async () => { store.delete(n); },
    getMetadata: async () => [{ size: store.get(n)?.size }],
    setMetadata: async (m) => { const f = store.get(n); if (f) f.meta = { ...f.meta, ...m }; },
    download: async (options) => {
      const data = store.get(n)?.head ?? Buffer.alloc(8);
      if (options?.destination) {
        await fs.promises.writeFile(options.destination, data);
        return [];
      }
      return [data];
    },
  });
  const bucket: BucketLike = {
    file: mk,
    combine: async (sources, dest) => {
      const src = (sources as Named[]).map(s => s.n);
      combineCalls.push(src);
      const total = src.reduce((n, s) => n + (store.get(s)?.size ?? 0), 0);
      store.set((dest as Named).n, { size: total, head: store.get(src[0])?.head ?? Buffer.alloc(8) });
    },
    getFiles: async ({ prefix }) => [[...store.keys()].filter(k => k.startsWith(prefix)).map(mk)],
    upload: async (localPath, options) => {
      const destName = typeof options?.destination === 'string'
        ? options.destination
        : ((options?.destination as Named)?.n ?? (options?.destination as FileLike & { n?: string })?.n);
      const stat = await fs.promises.stat(localPath);
      const head = await fs.promises.readFile(localPath);
      if (destName) {
        store.set(destName, { size: stat.size, head, meta: options?.metadata });
      }
    },
  };
  return { bucket, store, combineCalls };
}

function createMockRunner(opts: {
  outputBuffer?: Buffer;
  shouldError?: boolean;
  errorMessage?: string;
  isTimeout?: boolean;
  noOutputFile?: boolean;
} = {}) {
  const calls: { binary: string; args: string[]; options: { timeout: number } }[] = [];
  const runner: FfmpegRunner = async (binary, args, options) => {
    calls.push({ binary, args, options });
    if (opts.isTimeout) {
      const err = new Error('Command timed out');
      (err as unknown as { killed: boolean }).killed = true;
      throw err;
    }
    if (opts.shouldError) {
      throw new Error(opts.errorMessage || 'FFmpeg process exited with code 1');
    }
    if (!opts.noOutputFile) {
      const outputPath = args[args.length - 1];
      const buf = opts.outputBuffer ?? VALID_REMUX_MP4;
      await fs.promises.writeFile(outputPath, buf);
    }
    return { stdout: 'remux success', stderr: '' };
  };
  return { runner, calls };
}

describe('rutas productivas — aisladas por tenant, conversación y usuario', () => {
  it('nunca usa live-video-qa/ y lleva tenant/conversación/uid/job', () => {
    expect(chatJobPrefix('tA', 'c1', 'u1', 'job')).toBe('chat-live-video/tA/c1/u1/job/');
    expect(chatChunkObjectName('tA', 'c1', 'u1', 'job', 7)).toBe('chat-live-video/tA/c1/u1/job/c0007');
    expect(chatCombinedFragmentedObjectName('tA', 'c1', 'u1', 'job')).toBe('chat-live-video/tA/c1/u1/job/combined-fragmented.mp4');
    expect(chatFinalObjectName('tA', 'c1', 'u1', 'job')).toBe('chat-live-video/tA/c1/u1/job/final.mp4');
  });
  it('rechaza ids con path traversal', () => {
    expect(isSafePathId('tenant-1_a')).toBe(true);
    for (const bad of ['../x', 'a/b', '', 'a b', 'a'.repeat(129), null, 5]) expect(isSafePathId(bad)).toBe(false);
  });
});

describe('authorizeLiveVideoCall — mismo criterio que sendWhatsappMessage', () => {
  const ok = { isSuperAdmin: false, membership: { status: 'active', role: 'Asesor Comercial' }, conversationTenantId: 'tA', requestedTenantId: 'tA' };
  it('miembro activo con conversación del tenant: permitido', () => expect(authorizeLiveVideoCall(ok).ok).toBe(true));
  it('sin membresía, inactiva o solo lectura: denegado', () => {
    expect(authorizeLiveVideoCall({ ...ok, membership: null })).toMatchObject({ ok: false, code: 'permission-denied' });
    expect(authorizeLiveVideoCall({ ...ok, membership: { status: 'suspended', role: 'Owner' } })).toMatchObject({ ok: false });
    expect(authorizeLiveVideoCall({ ...ok, membership: { status: 'active', role: 'Solo lectura' } })).toMatchObject({ ok: false });
  });
  it('tenant isolation: conversación de OTRO tenant denegada, incluso para SuperAdmin', () => {
    expect(authorizeLiveVideoCall({ ...ok, conversationTenantId: 'tB' })).toMatchObject({ ok: false, code: 'permission-denied' });
    expect(authorizeLiveVideoCall({ isSuperAdmin: true, membership: null, conversationTenantId: 'tB', requestedTenantId: 'tA' })).toMatchObject({ ok: false });
  });
  it('conversación inexistente: not-found', () => {
    expect(authorizeLiveVideoCall({ ...ok, conversationTenantId: null })).toMatchObject({ ok: false, code: 'not-found' });
  });
});

describe('composeChatLiveVideo — remux FFmpeg productivo', () => {
  const MOCK_FFMPEG_PATH = path.join(os.tmpdir(), 'mock-ffmpeg-test-bin');
  if (!fs.existsSync(MOCK_FFMPEG_PATH)) fs.writeFileSync(MOCK_FFMPEG_PATH, '');

  const base = {
    ...P,
    mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    token: 'tok',
    ffmpegBinaryPath: MOCK_FFMPEG_PATH,
  };

  it('remux se ejecuta con los argumentos exactos: -map 0, -c copy, -movflags +faststart, sin transcode', async () => {
    const { bucket, store, combineCalls } = namedBucket({ chunks: 3 });
    const { runner, calls } = createMockRunner();

    const r = await composeChatLiveVideo(bucket, { ...base, chunkCount: 3, ffmpegRunner: runner });

    expect(calls).toHaveLength(1);
    const { binary, args, options } = calls[0];
    expect(binary).toBe(MOCK_FFMPEG_PATH);
    expect(options.timeout).toBe(30_000);

    // Verificación exhaustiva de argumentos
    expect(args).toContain('-nostdin');
    expect(args).toContain('-y');

    const mapIdx = args.indexOf('-map');
    expect(mapIdx).toBeGreaterThan(-1);
    expect(args[mapIdx + 1]).toBe('0');

    const cIdx = args.indexOf('-c');
    expect(cIdx).toBeGreaterThan(-1);
    expect(args[cIdx + 1]).toBe('copy');

    const movIdx = args.indexOf('-movflags');
    expect(movIdx).toBeGreaterThan(-1);
    expect(args[movIdx + 1]).toBe('+faststart');

    // Sin transcodificación de video ni de audio
    expect(args).not.toContain('libx264');
    expect(args).not.toContain('aac');
    expect(args).not.toContain('-b:v');
    expect(args).not.toContain('-b:a');

    // Chunks combinados a objeto temporal fragmentado
    expect(combineCalls).toHaveLength(1);
    expect(combineCalls[0].map(n => n.slice(-5))).toEqual(['c0000', 'c0001', 'c0002']);

    // Éxito: final.mp4 es el resultado del remux y tiene metadata adecuada
    expect(r.finalName).toBe('chat-live-video/tA/conv1/u1/abcdefgh12/final.mp4');
    expect(r.sizeBytes).toBe(VALID_REMUX_MP4.length);
    expect([...store.keys()]).toEqual([r.finalName]);
    expect(store.get(r.finalName)!.meta).toMatchObject({
      contentType: 'video/mp4',
      metadata: { firebaseStorageDownloadTokens: 'tok' },
    });
  });

  it('más de 32 chunks: encadena el acumulado sobre combined-fragmented.mp4', async () => {
    const { bucket, combineCalls } = namedBucket({ chunks: 40, sizePerChunk: 10 });
    const { runner } = createMockRunner();
    await composeChatLiveVideo(bucket, { ...base, chunkCount: 40, ffmpegRunner: runner });
    expect(combineCalls).toHaveLength(2);
    expect(combineCalls[0]).toHaveLength(32);
    expect(combineCalls[1][0]).toContain('combined-fragmented.mp4');
    expect(combineCalls[1]).toHaveLength(9);
  });

  it('FFmpeg unavailable → fail seguro y cleanup de chunks', async () => {
    const { bucket, store } = namedBucket({ chunks: 3 });
    // Ruta inexistente para forzar fallo de resolución
    await expect(
      composeChatLiveVideo(bucket, { ...base, chunkCount: 3, ffmpegBinaryPath: '/non/existent/ffmpeg_binary' }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    // Chunks eliminados de Storage
    expect(store.size).toBe(0);
  });

  it('FFmpeg error → cleanup completo de Storage y /tmp', async () => {
    const { bucket, store } = namedBucket({ chunks: 3 });
    const { runner } = createMockRunner({ shouldError: true, errorMessage: 'ffmpeg failed to remux' });

    const inputTmp = path.join(os.tmpdir(), `live-video-${P.jobId}-combined-fragmented.mp4`);
    const outputTmp = path.join(os.tmpdir(), `live-video-${P.jobId}-final.mp4`);

    await expect(
      composeChatLiveVideo(bucket, { ...base, chunkCount: 3, ffmpegRunner: runner }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    // Cleanup: Chunks, temporal remoto y final parcial eliminados
    expect(store.size).toBe(0);
    // Cleanup: archivos en /tmp eliminados
    expect(fs.existsSync(inputTmp)).toBe(false);
    expect(fs.existsSync(outputTmp)).toBe(false);
  });

  it('FFmpeg timeout → cleanup completo', async () => {
    const { bucket, store } = namedBucket({ chunks: 3 });
    const { runner } = createMockRunner({ isTimeout: true });

    const inputTmp = path.join(os.tmpdir(), `live-video-${P.jobId}-combined-fragmented.mp4`);
    const outputTmp = path.join(os.tmpdir(), `live-video-${P.jobId}-final.mp4`);

    await expect(
      composeChatLiveVideo(bucket, { ...base, chunkCount: 3, ffmpegRunner: runner }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(store.size).toBe(0);
    expect(fs.existsSync(inputTmp)).toBe(false);
    expect(fs.existsSync(outputTmp)).toBe(false);
  });

  it('output vacío → fail y cleanup', async () => {
    const { bucket, store } = namedBucket({ chunks: 3 });
    const { runner } = createMockRunner({ outputBuffer: Buffer.alloc(0) });

    await expect(
      composeChatLiveVideo(bucket, { ...base, chunkCount: 3, ffmpegRunner: runner }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(store.size).toBe(0);
  });

  it('output demasiado grande (> 16MB) → fail y cleanup', async () => {
    const { bucket, store } = namedBucket({ chunks: 3 });
    const { runner } = createMockRunner({ outputBuffer: Buffer.alloc(CHAT_LIVE_VIDEO_MAX_BYTES + 100) });

    await expect(
      composeChatLiveVideo(bucket, { ...base, chunkCount: 3, ffmpegRunner: runner }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(store.size).toBe(0);
  });

  it('output fragmentado (con moof) → fail y cleanup', async () => {
    const { bucket, store } = namedBucket({ chunks: 3 });
    const { runner } = createMockRunner({ outputBuffer: FRAGMENTED_MP4 });

    await expect(
      composeChatLiveVideo(bucket, { ...base, chunkCount: 3, ffmpegRunner: runner }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(store.size).toBe(0);
  });

  it('output con mdat antes de moov (sin faststart) → fail y cleanup', async () => {
    const { bucket, store } = namedBucket({ chunks: 3 });
    const { runner } = createMockRunner({ outputBuffer: MDAT_BEFORE_MOOV_MP4 });

    await expect(
      composeChatLiveVideo(bucket, { ...base, chunkCount: 3, ffmpegRunner: runner }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(store.size).toBe(0);
  });

  it('falta un chunk: rechaza sin componer ni ejecutar FFmpeg', async () => {
    const { bucket, combineCalls } = namedBucket({ chunks: 3, missing: [1] });
    const { runner, calls } = createMockRunner();
    await expect(
      composeChatLiveVideo(bucket, { ...base, chunkCount: 3, ffmpegRunner: runner }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(combineCalls).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('chunkCount fuera de rango o no entero', async () => {
    const { bucket } = namedBucket();
    const { runner } = createMockRunner();
    for (const n of [0, -1, 41, 1.5, NaN]) {
      await expect(
        composeChatLiveVideo(bucket, { ...base, chunkCount: n, ffmpegRunner: runner }),
      ).rejects.toBeInstanceOf(LiveVideoError);
    }
  });

  it('webm: no hay fast path, rechaza sin tocar Storage ni FFmpeg', async () => {
    const { bucket, combineCalls } = namedBucket();
    const { runner, calls } = createMockRunner();
    await expect(
      composeChatLiveVideo(bucket, { ...base, mimeType: 'video/webm;codecs=vp8,opus', chunkCount: 3, ffmpegRunner: runner }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(combineCalls).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});

describe('deleteChatLiveVideoJob', () => {
  it('borra solo el prefijo del job propio (mismo tenant, conversación, uid y job)', async () => {
    const { bucket, store } = namedBucket({ chunks: 3 });
    const otherUid = 'chat-live-video/tA/conv1/OTRO_UID/abcdefgh12/c0000';
    const otherTenant = 'chat-live-video/tB/conv1/u1/abcdefgh12/c0000';
    store.set(otherUid, { size: 1, head: Buffer.alloc(8) });
    store.set(otherTenant, { size: 1, head: Buffer.alloc(8) });
    expect(await deleteChatLiveVideoJob(bucket, P)).toBe(3);
    expect([...store.keys()].sort()).toEqual([otherUid, otherTenant].sort());
  });
});
