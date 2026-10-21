import { useCallback, useEffect, useRef, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { ref, uploadBytes } from 'firebase/storage';
import { Circle, Cloud, Loader2, Send, Square, Trash2, X } from 'lucide-react';
import { auth, storage } from '@/lib/firebase';
import {
  AUDIO_BITRATE, CHAT_MAX_SECONDS, CHAT_UPLOAD_CONCURRENCY, CHAT_VIDEO_BITRATE, CHUNK_MS, ChunkUploadFailedError, ChunkUploadQueue,
  chatChunkPath, clockMs, finishingLabel, formatClock, liveVideoErrorMessage, liveVideoFilename, liveVideoTechCode, newJobId, shouldAutoStop,
  type LiveVideoSupport,
} from './chatLiveVideo';

// Grabador productivo de video del chat de WhatsApp (Live Video). Graba con
// MediaRecorder y sube cada chunk MIENTRAS sigue grabando; al detener, el
// backend (chatLiveVideo) los compone y queda listo en ~3 s. NO envía solo: el
// vendedor revisa el video y pulsa Enviar, y el envío lo hace el padre por el
// pipeline normal (ConversationService.sendMessage → sendWhatsappMessage).
// El vendedor nunca ve chunks, bitrate, codecs ni Storage.
type Phase = 'opening' | 'idle' | 'recording' | 'finishing' | 'review' | 'error';

export interface LiveVideoResult { url: string; filename: string; sizeBytes: number }

interface Props {
  tenantId: string;
  conversationId: string;
  support: LiveVideoSupport;
  onClose: () => void;
  /** La cámara o el grabador no arrancaron: el padre vuelve a la cámara nativa del teléfono. */
  onFallback: (reason: string) => void;
  /** Devuelve true si el mensaje se envió (el padre ya mostró cualquier error). */
  onSend: (result: LiveVideoResult) => Promise<boolean>;
  /** Diagnóstico de compatibilidad (nunca se le muestra al vendedor). */
  onDiag?: (step: string, data?: Record<string, unknown>) => void;
}

type ComposeReq = { action: 'compose' | 'delete'; tenantId: string; conversationId: string; jobId: string; chunkCount?: number; mimeType?: string };

export const ChatLiveVideoRecorder = ({ tenantId, conversationId, support, onClose, onFallback, onSend, onDiag }: Props) => {
  const [phase, setPhase] = useState<Phase>('opening');
  const [seconds, setSeconds] = useState(0);
  const [backlogChunks, setBacklogChunks] = useState(0);
  const [errorText, setErrorText] = useState('');
  const [errorTech, setErrorTech] = useState<string | null>(null);
  const [result, setResult] = useState<LiveVideoResult | null>(null);
  const [remoteReady, setRemoteReady] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [sending, setSending] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const queueRef = useRef<ChunkUploadQueue | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const stopTimeRef = useRef(0);
  const stopToLocalPreviewMsRef = useRef(0);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const jobIdRef = useRef('');
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);
  const localChunksRef = useRef<Blob[]>([]);
  const localPreviewUrlRef = useRef<string | null>(null);
  const diag = useCallback((step: string, data?: Record<string, unknown>) => onDiag?.(`LIVE_VIDEO_${step}`, data), [onDiag]);

  const revokeLocalPreview = useCallback(() => {
    if (localPreviewUrlRef.current) {
      try {
        URL.revokeObjectURL(localPreviewUrlRef.current);
      } catch {
        /* noop */
      }
      localPreviewUrlRef.current = null;
    }
    localChunksRef.current = [];
    setLocalPreviewUrl(null);
  }, []);

  const callBackend = useCallback(
    (req: Omit<ComposeReq, 'tenantId' | 'conversationId' | 'jobId'>) =>
      httpsCallable<ComposeReq, { ok: boolean; url?: string; sizeBytes?: number; remuxMs?: number; deleted?: number }>(getFunctions(), 'chatLiveVideo')(
        { ...req, tenantId, conversationId, jobId: jobIdRef.current },
      ),
    [tenantId, conversationId],
  );

  const releaseMedia = useCallback(() => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    void wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  // Abre la cámara apenas se monta. Si falla, el chat NO se rompe: el padre
  // vuelve a la cámara nativa con un aviso.
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 1280 }, frameRate: { ideal: 30, max: 30 } },
          audio: true,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play().catch(() => {}); }
        const s = stream.getVideoTracks()[0]?.getSettings();
        diag('CAMERA_OK', { width: s?.width, height: s?.height, frameRate: s?.frameRate, mime: support.mime.chosen });
        setPhase('idle');
      } catch (e) {
        diag('CAMERA_FAILED', { name: (e as Error).name });
        if (!cancelled) onFallback(`camera:${(e as Error).name}`);
      }
    })();
    return () => {
      cancelled = true;
      mountedRef.current = false;
      cancelledRef.current = true;
      try { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); } catch { /* ya detenido */ }
      releaseMedia();
      revokeLocalPreview();
    };
    // Una sola vez al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fail = (text: string, tech: string | null = null) => { if (mountedRef.current) { setErrorText(text); setErrorTech(tech); setPhase('error'); } };

  const discardRemote = useCallback(async () => {
    try { await callBackend({ action: 'delete' }); } catch { /* best effort: lo huérfano lo limpia el ciclo de vida del bucket */ }
  }, [callBackend]);

  const finish = async (chunkCount: number) => {
    const queue = queueRef.current;
    if (!queue) return;
    if (cancelledRef.current) { await queue.idle(); await discardRemote(); return; }
    try {
      if (chunkCount < 1) throw Object.assign(new Error('corta'), { code: 'functions/failed-precondition', message: 'La grabación es muy corta. Probá de nuevo.' });
      await queue.idle();
      const stopToUploadIdleMs = clockMs() - stopTimeRef.current;
      diag('STOP_TO_UPLOAD_IDLE', { ms: Math.round(stopToUploadIdleMs) });
      const done = queue.stats();
      diag('UPLOADS_DONE', { chunks: done.chunksCreated, failed: done.chunksFailed, backlogAtStop: done.backlogChunks });
      if (done.chunksFailed > 0) {
        // Se conserva el error REAL del primer chunk terminal (code/mensaje saneados); solo si no hay, fallback genérico.
        const failure = queue.firstFailure();
        throw failure ? new ChunkUploadFailedError(failure) : new Error('chunks');
      }
      const t0 = clockMs();
      const res = await callBackend({ action: 'compose', chunkCount, mimeType: recorderRef.current?.mimeType || support.mime.chosen || 'video/mp4' });
      if (!res.data.url) throw new Error('sin url');
      const functionCallMs = clockMs() - t0;
      const stopToRemoteReadyMs = clockMs() - stopTimeRef.current;
      const remuxMs = typeof res.data.remuxMs === 'number' ? res.data.remuxMs : 0;
      diag('LATENCY_METRICS', {
        STOP_TO_LOCAL_PREVIEW_MS: Math.round(stopToLocalPreviewMsRef.current),
        STOP_TO_UPLOAD_IDLE_MS: Math.round(stopToUploadIdleMs),
        FUNCTION_CALL_MS: Math.round(functionCallMs),
        REMUX_MS: Math.round(remuxMs),
        STOP_TO_REMOTE_READY_MS: Math.round(stopToRemoteReadyMs),
      });
      diag('COMPOSE_OK', { ms: Math.round(functionCallMs), sizeMB: +((res.data.sizeBytes ?? 0) / 1048576).toFixed(2) });
      if (!mountedRef.current) return;
      setResult({ url: res.data.url, filename: liveVideoFilename(new Date()), sizeBytes: res.data.sizeBytes ?? 0 });
      setRemoteReady(true);
      setPhase('review');
    } catch (e) {
      const failure = e instanceof ChunkUploadFailedError ? e.failure : null;
      diag('FINISH_FAILED', failure
        ? {
          stage: 'chunk-upload', code: failure.code, name: failure.name, message: failure.message,
          chunkIndex: failure.chunkIndex, chunkSizeBytes: failure.chunkSizeBytes, attempts: failure.attempts,
          hasAuthenticatedUser: !!auth.currentUser, hasTenantId: !!tenantId, hasConversationId: !!conversationId,
        }
        : { stage: 'compose-or-other', code: (e as { code?: string })?.code, message: (e as Error)?.message });
      // Un intento fallido no deja chunks huérfanos en Storage (best effort).
      void discardRemote();
      revokeLocalPreview();
      fail(liveVideoErrorMessage(e), liveVideoTechCode(e));
    } finally {
      releaseMedia();
    }
  };

  const start = async () => {
    const stream = streamRef.current;
    const uid = auth.currentUser?.uid;
    if (!stream || !uid) { fail('Tu sesión venció. Entrá de nuevo para grabar.'); return; }
    cancelledRef.current = false;
    revokeLocalPreview();
    setRemoteReady(false);
    setResult(null);
    setPreviewFailed(false);
    localChunksRef.current = [];
    const jobId = newJobId();
    jobIdRef.current = jobId;

    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
      wakeLockRef.current = (await nav.wakeLock?.request('screen')) ?? null;
    } catch { /* sin wake lock: la pantalla puede apagarse sola */ }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: support.mime.chosen as string, videoBitsPerSecond: CHAT_VIDEO_BITRATE, audioBitsPerSecond: AUDIO_BITRATE,
      });
    } catch (e) {
      diag('RECORDER_FAILED', { message: (e as Error).message });
      releaseMedia();
      onFallback('recorder');
      return;
    }
    recorderRef.current = recorder;

    const contentType = (recorder.mimeType || support.mime.chosen || 'video/mp4').split(';')[0];
    const queue = new ChunkUploadQueue({
      concurrency: CHAT_UPLOAD_CONCURRENCY,
      upload: async (index, blob) => { await uploadBytes(ref(storage, chatChunkPath(tenantId, conversationId, uid, jobId, index)), blob, { contentType }); },
    });
    queueRef.current = queue;

    let index = 0;
    recorder.ondataavailable = (ev: BlobEvent) => {
      if (ev.data && ev.data.size > 0) {
        localChunksRef.current.push(ev.data);
        queue.add(index++, ev.data);
      }
    };
    recorder.onerror = () => { diag('RECORDER_ERROR'); };
    recorder.onstop = () => {
      if (localChunksRef.current.length > 0 && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        try {
          const localBlob = new Blob(localChunksRef.current, {
            type: recorder.mimeType || support.mime.chosen || 'video/mp4',
          });
          const localUrl = URL.createObjectURL(localBlob);
          localPreviewUrlRef.current = localUrl;
          setLocalPreviewUrl(localUrl);
          const stopToLocalPreviewMs = clockMs() - stopTimeRef.current;
          stopToLocalPreviewMsRef.current = stopToLocalPreviewMs;
          diag('STOP_TO_LOCAL_PREVIEW', { ms: Math.round(stopToLocalPreviewMs) });
          setPhase('review');
        } catch (err) {
          diag('LOCAL_PREVIEW_FAILED', { error: String(err) });
        }
      }
      void finish(index);
    };

    startedAtRef.current = clockMs();
    recorder.start(CHUNK_MS);
    diag('RECORDING_START', { mime: recorder.mimeType });
    setSeconds(0);
    setPhase('recording');
    timerRef.current = window.setInterval(() => {
      const s = (clockMs() - startedAtRef.current) / 1000;
      setSeconds(s);
      if (shouldAutoStop(s)) stop();
    }, 250);
  };

  const stop = () => {
    const rec = recorderRef.current;
    if (!rec || rec.state !== 'recording') return;
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    stopTimeRef.current = clockMs();
    setSeconds(Math.min((clockMs() - startedAtRef.current) / 1000, CHAT_MAX_SECONDS));
    setPhase('finishing');
    rec.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    // Mientras termina, se mide el backlog para decir "Terminando de cargar" solo si de verdad falta subir.
    timerRef.current = window.setInterval(() => { setBacklogChunks(queueRef.current?.stats().backlogChunks ?? 0); }, 250);
  };

  // Cancelar mientras graba: se descarta todo (lo subido se borra cuando termina la cola).
  const cancelRecording = () => {
    cancelledRef.current = true;
    revokeLocalPreview();
    try { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); } catch { /* ya detenido */ }
    releaseMedia();
    onClose();
  };

  const discard = () => {
    cancelledRef.current = true;
    revokeLocalPreview();
    void discardRemote();
    onClose();
  };

  const send = async () => {
    if (!result || !remoteReady || sending) return;
    setSending(true);
    // El archivo que se envía es SIEMPRE el final.mp4 remoto remuxeado
    const ok = await onSend(result);
    if (!mountedRef.current) return;
    if (ok) {
      revokeLocalPreview();
      onClose();
    } else {
      setSending(false);
    }
  };

  const recording = phase === 'recording';
  const showLive = phase === 'opening' || phase === 'idle' || phase === 'recording';

  return (
    <div role="dialog" aria-modal="true" aria-label="Grabar video" className="fixed inset-0 z-[70] bg-black flex flex-col text-white">
      <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2">
        <span className="text-sm font-black tabular-nums" aria-live="off">
          {phase === 'error' ? '' : `${formatClock(seconds)} / ${formatClock(CHAT_MAX_SECONDS)}`}
        </span>
        {recording ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-sky-300"><Cloud className="w-4 h-4" aria-hidden="true" /> Sincronizando…</span>
        ) : null}
        {phase === 'review' ? (
          remoteReady ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400" role="status">Listo para enviar</span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-300" role="status">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Finalizando video…
            </span>
          )
        ) : null}
        {phase !== 'finishing' && !sending ? (
          <button type="button" onClick={recording ? cancelRecording : (phase === 'review' ? discard : onClose)}
            aria-label={recording ? 'Cancelar grabación' : 'Cerrar'} className="w-11 h-11 -mr-2 flex items-center justify-center rounded-full text-white/80 hover:bg-white/10">
            <X className="w-6 h-6" />
          </button>
        ) : <span className="w-11 h-11" />}
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center">
        {showLive ? (
          <video ref={videoRef} muted playsInline autoPlay className="max-w-full max-h-full w-full h-full object-contain bg-black" />
        ) : null}
        {phase === 'finishing' ? (
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <Loader2 className="w-8 h-8 animate-spin" aria-hidden="true" />
            <p className="text-base font-bold" role="status">{finishingLabel(backlogChunks > 0 ? 'uploading' : 'preparing')}</p>
          </div>
        ) : null}
        {phase === 'review' && (localPreviewUrl || result) ? (
          previewFailed ? (
            <div className="px-6 text-center space-y-1">
              <p className="text-base font-bold">Video listo</p>
              <p className="text-sm text-white/70">{formatClock(seconds)} {result ? `· ${(result.sizeBytes / 1048576).toFixed(1)} MB` : ''}</p>
            </div>
          ) : (
            <video src={localPreviewUrl || result?.url} controls playsInline preload="auto" onError={() => setPreviewFailed(true)}
              className="max-w-full max-h-full w-full h-full object-contain bg-black" />
          )
        ) : null}
        {phase === 'error' ? (
          <div className="px-6 text-center space-y-3 max-w-sm">
            <p className="text-base font-bold" role="alert">{errorText}</p>
            {errorTech ? (
              <p className="text-xs text-white/60" data-testid="live-video-tech-code">Código técnico:<br />{errorTech}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="px-6 pt-3 pb-[max(env(safe-area-inset-bottom),20px)] flex items-center justify-center gap-4">
        {phase === 'idle' ? (
          <button type="button" onClick={() => { void start(); }} aria-label="Grabar"
            className="flex items-center gap-2 bg-rose-600 hover:bg-rose-500 text-white font-black rounded-full px-8 py-4 text-base">
            <Circle className="w-5 h-5 fill-current" aria-hidden="true" /> Grabar
          </button>
        ) : null}
        {recording ? (
          <button type="button" onClick={stop} disabled={seconds < 1} aria-label="Detener grabación"
            className="flex items-center gap-2 bg-white text-black font-black rounded-full px-8 py-4 text-base disabled:opacity-40">
            <Square className="w-5 h-5 fill-current" aria-hidden="true" /> Detener
          </button>
        ) : null}
        {phase === 'review' ? (
          <>
            <button type="button" onClick={discard} disabled={sending}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white font-bold rounded-full px-6 py-4 text-base disabled:opacity-40">
              <Trash2 className="w-5 h-5" aria-hidden="true" /> Descartar
            </button>
            <button type="button" onClick={() => { void send(); }} disabled={!remoteReady || sending} aria-label={!remoteReady ? 'Finalizando video' : 'Enviar video'}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-black rounded-full px-8 py-4 text-base disabled:opacity-50 disabled:cursor-not-allowed">
              {sending ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : (!remoteReady ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : <Send className="w-5 h-5" aria-hidden="true" />)} {sending ? 'Enviando…' : (!remoteReady ? 'Finalizando…' : 'Enviar')}
            </button>
          </>
        ) : null}
        {phase === 'error' ? (
          <button type="button" onClick={onClose} className="bg-white text-black font-black rounded-full px-8 py-4 text-base">Cerrar</button>
        ) : null}
      </div>
    </div>
  );
};

export default ChatLiveVideoRecorder;
