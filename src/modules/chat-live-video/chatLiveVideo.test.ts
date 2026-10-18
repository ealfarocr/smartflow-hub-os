import { describe, it, expect } from 'vitest';
import {
  CHAT_MAX_SECONDS, CHAT_VIDEO_BITRATE, chatChunkPath, detectLiveVideoSupport, finishingLabel, formatClock,
  liveVideoErrorMessage, liveVideoFilename, shouldAutoStop,
} from './chatLiveVideo';

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
    expect(liveVideoErrorMessage(new Error('boom'))).toMatch(/conexión/);
  });
});
