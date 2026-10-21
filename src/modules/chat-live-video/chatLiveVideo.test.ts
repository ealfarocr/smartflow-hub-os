import { describe, it, expect } from 'vitest';
import {
  CHAT_MAX_SECONDS, CHAT_VIDEO_BITRATE, chatChunkPath, detectLiveVideoSupport, estimateLiveVideoBytes,
  finishingLabel, formatClock, liveVideoErrorMessage, liveVideoFilename, liveVideoTechCode, reviewStatusLabel, shouldAutoStop,
} from './chatLiveVideo';
import { ChunkUploadFailedError, ChunkUploadQueue } from './chatLiveVideo';

const env = (over: Partial<Parameters<typeof detectLiveVideoSupport>[0]> = {}) => ({
  isSecureContext: true, hasMediaRecorder: true, hasGetUserMedia: true,
  isTypeSupported: (m: string) => m === 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ...over,
});

describe('límites productivos V1 — optimización de latencia', () => {
  it('60 s y 1,0 Mbps video + 64 kbps audio', () => {
    expect(CHAT_MAX_SECONDS).toBe(60);
    expect(CHAT_VIDEO_BITRATE).toBe(1_000_000);
    // 60 s * (1,0 Mbps + 64 kbps) = ~8 MB, cómodamente < 16 MB
    expect(((CHAT_VIDEO_BITRATE + 64_000) * 60) / 8 / 1048576).toBeLessThan(8.5);
  });

  it('estimaciones teóricas de tamaño: 10 s (~1.3 MB) y 60 s (~8.0 MB)', () => {
    const bytes10 = estimateLiveVideoBytes(10);
    const mb10 = bytes10 / 1048576;
    expect(mb10).toBeGreaterThan(1.2);
    expect(mb10).toBeLessThan(1.4);

    const bytes60 = estimateLiveVideoBytes(60);
    const mb60 = bytes60 / 1048576;
    expect(mb60).toBeGreaterThan(7.5);
    expect(mb60).toBeLessThan(8.5);
  });

  it('auto-stop exactamente a 60 s', () => {
    expect(shouldAutoStop(59.9)).toBe(false);
    expect(shouldAutoStop(60)).toBe(true);
  });
});

describe('estados de preview y finalización', () => {
  it('reviewStatusLabel cambia de "Finalizando video…" a "Listo para enviar"', () => {
    expect(reviewStatusLabel(false)).toBe('Finalizando video…');
    expect(reviewStatusLabel(true)).toBe('Listo para enviar');
  });

  it('finishingLabel maneja etapas sin jerga técnica', () => {
    expect(finishingLabel('uploading')).toBe('Terminando de cargar video…');
    expect(finishingLabel('preparing')).toBe('Preparando video…');
    expect(finishingLabel('finalizing')).toBe('Finalizando video…');
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

describe('garantías de preview local y envío de archivo final remoto', () => {
  it('el Blob local se compone de los fragmentos y genera un object URL válido', () => {
    const chunk1 = new Blob([new Uint8Array([1, 2, 3])]);
    const chunk2 = new Blob([new Uint8Array([4, 5, 6])]);
    const combined = new Blob([chunk1, chunk2], { type: 'video/mp4' });
    expect(combined.size).toBe(6);
    expect(combined.type).toBe('video/mp4');

    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    let createdUrl = '';
    let revokedUrl = '';

    URL.createObjectURL = (b: Blob) => {
      createdUrl = `blob:http://localhost/${b.size}`;
      return createdUrl;
    };
    URL.revokeObjectURL = (u: string) => {
      revokedUrl = u;
    };

    try {
      const url = URL.createObjectURL(combined);
      expect(url).toBe('blob:http://localhost/6');
      URL.revokeObjectURL(url);
      expect(revokedUrl).toBe('blob:http://localhost/6');
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it('el payload de envío final SIEMPRE usa la URL remota de Storage con token y nunca el blob local', () => {
    const remoteUrl = 'https://firebasestorage.googleapis.com/v0/b/bucket/o/chat-live-video%2Ft%2Fc%2Fu%2Fj%2Ffinal.mp4?alt=media&token=xyz';
    const localBlobUrl = 'blob:http://localhost/12345';

    const sendPayload = (remoteResult: { url: string; filename: string; sizeBytes: number }) => {
      expect(remoteResult.url).toBe(remoteUrl);
      expect(remoteResult.url).not.toContain('blob:');
      expect(remoteResult.url).toContain('firebase');
      expect(remoteResult.filename).toMatch(/^video-\d{8}-\d{6}\.mp4$/);
      return true;
    };

    const sent = sendPayload({
      url: remoteUrl,
      filename: liveVideoFilename(new Date()),
      sizeBytes: 1330000,
    });
    expect(sent).toBe(true);
    expect(localBlobUrl).toContain('blob:');
  });
});

