import { describe, it, expect } from 'vitest';
import {
  CHAT_MAX_SECONDS, CHAT_VIDEO_BITRATE, chatChunkPath, detectLiveVideoSupport, finishingLabel, formatClock,
  liveVideoErrorMessage, liveVideoFilename, liveVideoTechCode, shouldAutoStop,
} from './chatLiveVideo';
import { ChunkUploadFailedError, ChunkUploadQueue } from './chatLiveVideo';

const env = (over: Partial<Parameters<typeof detectLiveVideoSupport>[0]> = {}) => ({
  isSecureContext: true, hasMediaRecorder: true, hasGetUserMedia: true,
  isTypeSupported: (m: string) => m === 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ...over,
});

describe('límites productivos V1', () => {
  it('60 s y ~1,4 Mbps (no se sube el bitrate validado)', () => {
    expect(CHAT_MAX_SECONDS).toBe(60);
    expect(CHAT_VIDEO_BITRATE).toBe(1_400_000);
    // 60 s * (1,4 Mbps + 64 kbps) = ~11 MB, cómodamente < 16 MB
    expect(((CHAT_VIDEO_BITRATE + 64_000) * 60) / 8 / 1048576).toBeLessThan(11.5);
  });
  it('auto-stop exactamente a 60 s', () => {
    expect(shouldAutoStop(59.9)).toBe(false);
    expect(shouldAutoStop(60)).toBe(true);
  });
});

describe('detectLiveVideoSupport — fallback sin romper el chat', () => {
  it('MP4 H.264 + AAC: soportado', () => {
    const r = detectLiveVideoSupport(env());
    expect(r).toMatchObject({ supported: true, reason: 'ok' });
    expect(r.mime.mp4H264Aac).toBe(true);
  });
  it('sin MediaRecorder, sin cámara, o contexto inseguro: no soportado', () => {
    expect(detectLiveVideoSupport(env({ hasMediaRecorder: false })).reason).toBe('no-media-recorder');
    expect(detectLiveVideoSupport(env({ hasGetUserMedia: false })).reason).toBe('no-camera-api');
    expect(detectLiveVideoSupport(env({ isSecureContext: false })).reason).toBe('insecure-context');
  });
  it('solo WebM (o MP4 sin codecs explícitos H.264/AAC): no soportado — no hay transcodificación', () => {
    expect(detectLiveVideoSupport(env({ isTypeSupported: (m) => m.startsWith('video/webm') })).reason).toBe('no-mp4-h264-aac');
    expect(detectLiveVideoSupport(env({ isTypeSupported: (m) => m === 'video/mp4' })).supported).toBe(false);
  });
  it('isTypeSupported que lanza no rompe', () => {
    expect(detectLiveVideoSupport(env({ isTypeSupported: () => { throw new Error('x'); } })).supported).toBe(false);
  });
});

describe('ruta de chunks (idéntica a la del backend y storage.rules)', () => {
  it('chat-live-video/{tenant}/{conversación}/{uid}/{job}/cNNNN', () => {
    expect(chatChunkPath('tA', 'c1', 'u1', 'job', 12)).toBe('chat-live-video/tA/c1/u1/job/c0012');
    expect(chatChunkPath('tA', 'c1', 'u1', 'job', 0)).not.toContain('live-video-qa');
  });
});

describe('textos y nombres', () => {
  it('reloj mm:ss', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(34.9)).toBe('00:34');
    expect(formatClock(60)).toBe('01:00');
    expect(formatClock(-3)).toBe('00:00');
  });
  it('el archivo siempre termina en .mp4', () => {
    expect(liveVideoFilename(new Date(2026, 9, 17, 15, 45, 2))).toBe('video-20261017-154502.mp4');
  });
  it('textos de cierre sin jerga técnica', () => {
    expect(finishingLabel('uploading')).toBe('Terminando de cargar video…');
    expect(finishingLabel('preparing')).toBe('Preparando video…');
    for (const t of [finishingLabel('uploading'), finishingLabel('preparing')]) expect(t).not.toMatch(/chunk|bitrate|ffprobe|storage|codec/i);
  });
  it('errores: muestra el mensaje del servidor o uno genérico accionable', () => {
    expect(liveVideoErrorMessage({ code: 'functions/failed-precondition', message: 'El video pesa más de 16 MB' })).toBe('El video pesa más de 16 MB');
    expect(liveVideoErrorMessage({ code: 'functions/permission-denied' })).toMatch(/permiso/);
    expect(liveVideoErrorMessage(new Error('boom'))).toBe('No se pudo preparar el video.');
  });
});

// Reintentos instantáneos: el comportamiento de la cola no cambia, solo se conserva el error real.
const blob = (n: number) => new Blob([new Uint8Array(n)]);
const fastQueue = (upload: (i: number, b: Blob) => Promise<void>) =>
  new ChunkUploadQueue({ concurrency: 3, upload, delay: async () => {} });
const storageErr = (code: string, message = 'boom') => Object.assign(new Error(message), { code, name: 'FirebaseError' });

describe('diagnóstico de fallo de chunks', () => {
  it('A: storage/unauthorized conserva code, índice y el mensaje visible trae el código técnico', async () => {
    const q = fastQueue(async i => { if (i === 1) throw storageErr('storage/unauthorized'); });
    q.add(0, blob(10)); q.add(1, blob(2048)); q.add(2, blob(10));
    await q.idle();
    const f = q.firstFailure()!;
    expect(f).toMatchObject({ code: 'storage/unauthorized', chunkIndex: 1, chunkSizeBytes: 2048, attempts: 3, name: 'FirebaseError' });
    const err = new ChunkUploadFailedError(f);
    expect(err.code).toBe('storage/unauthorized');
    expect(liveVideoErrorMessage(err)).toMatch(/administrador/);
    expect(liveVideoTechCode(err)).toBe('storage/unauthorized · fragmento 2');
  });

  it('B: storage/retry-limit-exceeded conserva el code y no culpa a la conexión', async () => {
    const q = fastQueue(async () => { throw storageErr('storage/retry-limit-exceeded'); });
    q.add(2, blob(5));
    await q.idle();
    const err = new ChunkUploadFailedError(q.firstFailure()!);
    expect(err.failure.code).toBe('storage/retry-limit-exceeded');
    expect(liveVideoErrorMessage(err)).toBe('No se pudo preparar el video.');
    expect(liveVideoTechCode(err)).toBe('storage/retry-limit-exceeded · fragmento 3');
  });

  it('storage/unauthenticated y network/offline se distinguen; canceled/unknown quedan neutros', () => {
    expect(liveVideoErrorMessage({ code: 'storage/unauthenticated' })).toMatch(/sesión/);
    expect(liveVideoErrorMessage({ code: 'network/offline' })).toMatch(/Sin conexión/);
    expect(liveVideoErrorMessage({ code: 'storage/canceled' })).toBe('No se pudo preparar el video.');
    expect(liveVideoErrorMessage({ code: 'storage/unknown' })).toBe('No se pudo preparar el video.');
    expect(liveVideoTechCode({ code: 'storage/unknown' })).toBe('storage/unknown');
  });

  it('C: error genérico sin code → fallback seguro, sin línea técnica inventada', async () => {
    const q = fastQueue(async () => { throw 'texto plano'; });
    q.add(0, blob(1));
    await q.idle();
    const f = q.firstFailure()!;
    expect(f.code).toBeNull();
    const err = new ChunkUploadFailedError(f);
    expect(liveVideoErrorMessage(err)).toBe('No se pudo preparar el video.');
    expect(liveVideoTechCode(err)).toBeNull();
    expect(liveVideoTechCode(new Error('chunks'))).toBeNull();
    expect(liveVideoTechCode(null)).toBeNull();
  });

  it('D: subida exitosa → sin fallos, mismos reintentos y estadísticas', async () => {
    let calls = 0;
    const q = fastQueue(async i => { calls++; if (i === 0 && calls === 1) throw storageErr('storage/unknown'); });
    q.add(0, blob(10)); q.add(1, blob(10));
    await q.idle();
    expect(q.firstFailure()).toBeNull();
    expect(q.stats()).toMatchObject({ chunksCreated: 2, chunksUploaded: 2, chunksFailed: 0 });
    expect(q.records.find(r => r.index === 0)!.attempts).toBe(2);
    expect(calls).toBe(3);
  });

  it('reintentos intactos: 3 intentos por chunk antes de fallar', async () => {
    let calls = 0;
    const q = fastQueue(async () => { calls++; throw storageErr('storage/unauthorized'); });
    q.add(0, blob(1));
    await q.idle();
    expect(calls).toBe(3);
    expect(q.stats().chunksFailed).toBe(1);
  });

  it('E: datos sensibles no aparecen en el mensaje visible ni en el fallo guardado', async () => {
    const secret = 'https://firebasestorage.googleapis.com/v0/b/x/o/chat-live-video%2Ft-1%2Fconv%2Fuid%2Fjob%2Fc0000?token=abc123 Authorization: Bearer eyJhbGciOi.zzz';
    const q = fastQueue(async () => { throw storageErr('storage/unauthorized', `fallo ${secret} en chat-live-video/t-1791700036682/convX/uidY/job/c0000`); });
    q.add(0, blob(1));
    await q.idle();
    const f = q.firstFailure()!;
    const err = new ChunkUploadFailedError(f);
    const visible = `${liveVideoErrorMessage(err)} ${liveVideoTechCode(err)}`;
    for (const s of ['abc123', 'eyJhbGciOi', 'googleapis', 't-1791700036682', 'convX', 'uidY', 'chat-live-video', 'token=']) {
      expect(visible).not.toContain(s);
      expect(JSON.stringify(f)).not.toContain(s);
    }
  });
});
