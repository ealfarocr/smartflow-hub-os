import { describe, it, expect } from 'vitest';
import {
  CHAT_LIVE_VIDEO_MAX_BYTES, LiveVideoError, authorizeLiveVideoCall, chatChunkObjectName, chatFinalObjectName, chatJobPrefix,
  composeChatLiveVideo, deleteChatLiveVideoJob, isSafePathId, type BucketLike, type FileLike,
} from './chatLiveVideoCore';

const P = { tenantId: 'tA', conversationId: 'conv1', uid: 'u1', jobId: 'abcdefgh12' };
const MP4_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(16)]);
const WEBM_HEAD = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);

// Bucket en memoria: combine suma tamaños y toma la cabecera del primer origen.
function namedBucket(opts: { chunks?: number; missing?: number[]; sizePerChunk?: number; head?: Buffer } = {}) {
  const { chunks = 3, missing = [], sizePerChunk = 1000, head = MP4_HEAD } = opts;
  const store = new Map<string, { size: number; head: Buffer; meta?: Record<string, unknown> }>();
  for (let i = 0; i < chunks; i++) {
    if (!missing.includes(i)) {
      store.set(chatChunkObjectName(P.tenantId, P.conversationId, P.uid, P.jobId, i), { size: sizePerChunk, head: i === 0 ? head : Buffer.alloc(8) });
    }
  }
  const combineCalls: string[][] = [];
  type Named = FileLike & { n: string };
  const mk = (n: string): Named => ({
    n,
    exists: async () => [store.has(n)],
    delete: async () => { store.delete(n); },
    getMetadata: async () => [{ size: store.get(n)?.size }],
    setMetadata: async (m) => { const f = store.get(n); if (f) f.meta = m; },
    download: async () => [store.get(n)!.head],
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
  };
  return { bucket, store, combineCalls };
}

describe('rutas productivas — aisladas por tenant, conversación y usuario', () => {
  it('nunca usa live-video-qa/ y lleva tenant/conversación/uid/job', () => {
    expect(chatJobPrefix('tA', 'c1', 'u1', 'job')).toBe('chat-live-video/tA/c1/u1/job/');
    expect(chatChunkObjectName('tA', 'c1', 'u1', 'job', 7)).toBe('chat-live-video/tA/c1/u1/job/c0007');
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

describe('composeChatLiveVideo', () => {
  const base = { ...P, mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', token: 'tok' };

  it('compone, publica con token y borra los chunks', async () => {
    const { bucket, store, combineCalls } = namedBucket({ chunks: 3 });
    const r = await composeChatLiveVideo(bucket, { ...base, chunkCount: 3 });
    expect(r.sizeBytes).toBe(3000);
    expect(r.finalName).toBe('chat-live-video/tA/conv1/u1/abcdefgh12/final.mp4');
    expect(combineCalls).toHaveLength(1);
    expect(combineCalls[0].map(n => n.slice(-5))).toEqual(['c0000', 'c0001', 'c0002']);
    expect([...store.keys()]).toEqual([r.finalName]);
    expect(store.get(r.finalName)!.meta).toMatchObject({ contentType: 'video/mp4', metadata: { firebaseStorageDownloadTokens: 'tok' } });
  });

  it('más de 32 chunks: encadena el acumulado (límite de compose)', async () => {
    const { bucket, combineCalls } = namedBucket({ chunks: 40, sizePerChunk: 10 });
    await composeChatLiveVideo(bucket, { ...base, chunkCount: 40 });
    expect(combineCalls).toHaveLength(2);
    expect(combineCalls[0]).toHaveLength(32);
    expect(combineCalls[1][0]).toContain('final.mp4');
    expect(combineCalls[1]).toHaveLength(9);
  });

  it('falta un chunk: rechaza sin componer', async () => {
    const { bucket, combineCalls } = namedBucket({ chunks: 3, missing: [1] });
    await expect(composeChatLiveVideo(bucket, { ...base, chunkCount: 3 })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(combineCalls).toHaveLength(0);
  });

  it('chunkCount fuera de rango o no entero', async () => {
    const { bucket } = namedBucket();
    for (const n of [0, -1, 41, 1.5, NaN]) {
      await expect(composeChatLiveVideo(bucket, { ...base, chunkCount: n })).rejects.toBeInstanceOf(LiveVideoError);
    }
  });

  it('webm: no hay fast path, rechaza sin tocar Storage', async () => {
    const { bucket, combineCalls } = namedBucket();
    await expect(composeChatLiveVideo(bucket, { ...base, mimeType: 'video/webm;codecs=vp8,opus', chunkCount: 3 })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(combineCalls).toHaveLength(0);
  });

  it('más de 16 MB: rechaza y limpia final y chunks', async () => {
    const { bucket, store } = namedBucket({ chunks: 3, sizePerChunk: CHAT_LIVE_VIDEO_MAX_BYTES });
    await expect(composeChatLiveVideo(bucket, { ...base, chunkCount: 3 })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(store.size).toBe(0);
  });

  it('el resultado no es MP4 (cabecera webm): rechaza y limpia', async () => {
    const { bucket, store } = namedBucket({ chunks: 2, head: WEBM_HEAD });
    await expect(composeChatLiveVideo(bucket, { ...base, chunkCount: 2 })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(store.size).toBe(0);
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
