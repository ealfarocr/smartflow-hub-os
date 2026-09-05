import { useEffect, useRef, useState } from 'react';
import { X, Circle, Square, RotateCcw, Check, Smartphone } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { getSupportedVideoMimeType } from './videoMime';

const MAX_DURATION_SECONDS = 60;
const VIDEO_BITS_PER_SECOND = 1_350_000; // ~1.35 Mbps
const AUDIO_BITS_PER_SECOND = 96_000;    // ~96 kbps, voz — no música

const debugAttach = (tag: string, data?: unknown) => {
  console.log(`[ATTACH] ${tag}`, data ?? '');
};

type Phase = 'live' | 'recording' | 'reviewing';
// 'checking': cargando metadata del blob grabado para confirmar que es reproducible
// ANTES de habilitar "Usar video" — Android/Chrome puede reportar isTypeSupported()
// true para MP4/H.264 y aun así entregar un archivo sin duración/moov finalizado
// (pantalla negra, 0:00). 'invalid' bloquea el envío a addPendingMedia por completo.
type Validity = 'checking' | 'valid' | 'invalid';

const PREVIEW_METADATA_TIMEOUT_MS = 5000;
const UNPLAYABLE_MESSAGE = 'No pudimos finalizar este video correctamente. Intenta grabarlo nuevamente.';

interface VideoRecorderModalProps {
  onClose: () => void;
  onVideoReady: (file: File) => void;
  onFallbackNative: () => void;
}

export const VideoRecorderModal = ({ onClose, onVideoReady, onFallbackNative }: VideoRecorderModalProps) => {
  const { addToast } = useUIStore();
  const [phase, setPhase] = useState<Phase>('live');
  const [seconds, setSeconds] = useState(0);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [validity, setValidity] = useState<Validity>('checking');

  const videoLiveRef      = useRef<HTMLVideoElement>(null);
  const streamRef         = useRef<MediaStream | null>(null);
  const recorderRef       = useRef<MediaRecorder | null>(null);
  const chunksRef         = useRef<Blob[]>([]);
  const chunkIndexRef     = useRef(0);
  const mimeTypeRef       = useRef<string>('video/mp4');      // solicitado
  const actualMimeTypeRef = useRef<string>('video/mp4');      // recorder.mimeType real
  const timerRef          = useRef<ReturnType<typeof setInterval> | null>(null);
  const validationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dimensionsRef     = useRef<{ width?: number; height?: number }>({});
  const recordedBlobRef   = useRef<Blob | null>(null);
  const recordedUrlRef    = useRef<string | null>(null);
  const startedAtRef      = useRef(0);
  // Evita doble-cleanup / doble-fallback si el cierre ya se disparó (p.ej. el
  // usuario cancela mientras getUserMedia todavía estaba resolviendo).
  const closedRef         = useRef(false);

  const clearTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  const clearValidationTimeout = () => { if (validationTimeoutRef.current) { clearTimeout(validationTimeoutRef.current); validationTimeoutRef.current = null; } };

  const stopStreamTracks = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  // Libera cámara/micrófono, detiene el recorder si sigue vivo, limpia el
  // timer y revoca el object URL de preview. Solo lee refs (nunca estado de
  // React) para que funcione igual llamado desde el cleanup de un efecto con
  // deps=[] que desde un handler del render actual — mismo cuidado que ya se
  // aplicó en ConversationsPageView para no liberar un valor stale.
  const cleanup = () => {
    clearTimer();
    clearValidationTimeout();
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch { /* ya inactivo */ }
    }
    recorderRef.current = null;
    stopStreamTracks();
    if (recordedUrlRef.current) { URL.revokeObjectURL(recordedUrlRef.current); recordedUrlRef.current = null; }
  };

  const failToNative = (reason: string, err?: unknown) => {
    if (closedRef.current) return;
    closedRef.current = true;
    debugAttach('VIDEO_RECORDER_ERROR', { reason, err: err instanceof Error ? err.message : err });
    debugAttach('VIDEO_RECORDER_FALLBACK_NATIVE', { reason });
    addToast('No se pudo abrir el grabador. Usando la cámara del teléfono.', 'info');
    cleanup();
    onFallbackNative();
  };

  const handleClose = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    cleanup();
    onClose();
  };

  // Arranca la cámara en vivo apenas se abre el modal.
  useEffect(() => {
    debugAttach('VIDEO_RECORDER_OPEN');
    const mimeType = getSupportedVideoMimeType();
    if (!mimeType) { failToNative('no_supported_mime'); return; }
    mimeTypeRef.current = mimeType;
    debugAttach('VIDEO_RECORDER_MIME_SELECTED', { mimeType });

    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoLiveRef.current) {
          videoLiveRef.current.srcObject = stream;
          await videoLiveRef.current.play().catch(() => {});
        }
        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings?.();
        dimensionsRef.current = { width: settings?.width, height: settings?.height };
        track?.addEventListener('ended', () => failToNative('video_track_ended'));
      } catch (err) {
        failToNative('getUserMedia_failed', err);
      }
    })();

    return () => {
      cancelled = true;
      if (!closedRef.current) cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = () => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    chunkIndexRef.current = 0;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(streamRef.current, {
        mimeType: mimeTypeRef.current,
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
    } catch (err) {
      failToNative('MediaRecorder_construct_failed', err);
      return;
    }
    // recorder.mimeType es lo que el navegador REALMENTE usó — puede diferir del
    // string pedido en el constructor. Se usa este valor (no mimeTypeRef.current)
    // para el Blob/File final, para no mentir sobre el contenido real grabado.
    actualMimeTypeRef.current = recorder.mimeType || mimeTypeRef.current;
    if (actualMimeTypeRef.current !== mimeTypeRef.current) {
      debugAttach('VIDEO_RECORDER_MIME_MISMATCH', { requested: mimeTypeRef.current, actual: actualMimeTypeRef.current });
    }
    recorder.ondataavailable = (e) => {
      debugAttach('VIDEO_CHUNK', { index: chunkIndexRef.current, size: e.data.size, type: e.data.type });
      chunkIndexRef.current += 1;
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onerror = (e: Event) => failToNative('MediaRecorder_onerror', e);
    recorder.onstop = () => {
      debugAttach('VIDEO_RECORDER_ONSTOP', { chunkCount: chunksRef.current.length });
      // Si ya estamos cerrando (cancelar durante la grabación), no mostrar preview.
      if (closedRef.current) return;
      const totalChunkBytes = chunksRef.current.reduce((sum, c) => sum + c.size, 0);
      const blob = new Blob(chunksRef.current, { type: actualMimeTypeRef.current });
      recordedBlobRef.current = blob;
      const url = URL.createObjectURL(blob);
      recordedUrlRef.current = url;
      setRecordedUrl(url);
      debugAttach('VIDEO_FINAL_BLOB', {
        size: blob.size,
        type: blob.type,
        numberOfChunks: chunksRef.current.length,
        totalChunkBytes,
      });
      setValidity('checking');
      setPhase('reviewing');
      // Guarda por si "loadedmetadata"/"error" del <video> de preview nunca llegan
      // (archivo tan roto que el navegador ni siquiera decodifica encabezado) — sin
      // esto el botón "Usar video" quedaría deshabilitado para siempre sin explicación.
      clearValidationTimeout();
      validationTimeoutRef.current = setTimeout(() => {
        debugAttach('VIDEO_PREVIEW_METADATA', { timedOut: true });
        setValidity(v => v === 'checking' ? 'invalid' : v);
        addToast(UNPLAYABLE_MESSAGE, 'error');
      }, PREVIEW_METADATA_TIMEOUT_MS);
    };
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    recorder.start();
    setSeconds(0);
    setPhase('recording');
    debugAttach('VIDEO_RECORDING_STARTED', {
      requestedMimeType: mimeTypeRef.current,
      recorderMimeType: recorder.mimeType,
    });
    timerRef.current = setInterval(() => {
      setSeconds(s => {
        if (s + 1 >= MAX_DURATION_SECONDS) { stopRecording(); return s; }
        return s + 1;
      });
    }, 1000);
  };

  const stopRecording = () => {
    clearTimer();
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      debugAttach('VIDEO_RECORDER_STOP_REQUESTED', { seconds });
      recorderRef.current.stop();
      debugAttach('VIDEO_RECORDING_STOPPED', { seconds });
    }
  };

  // Valida que el blob grabado sea REALMENTE reproducible antes de dejar
  // habilitado "Usar video" — isTypeSupported() solo confirma que el navegador
  // PUEDE codificar en ese formato, no que el archivo resultante tenga
  // duración/dimensiones finalizadas correctamente (síntoma real de QA física:
  // preview en negro con 0:00).
  const handlePreviewLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    const meta = {
      duration: video.duration,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      readyState: video.readyState,
      errorCode: video.error?.code,
      errorMessage: video.error?.message,
    };
    debugAttach('VIDEO_PREVIEW_METADATA', meta);
    clearValidationTimeout();
    const isPlayable = Number.isFinite(video.duration) && video.duration > 0
      && video.videoWidth > 0 && video.videoHeight > 0 && !video.error;
    if (isPlayable) {
      setValidity('valid');
    } else {
      setValidity('invalid');
      addToast(UNPLAYABLE_MESSAGE, 'error');
    }
  };

  const handlePreviewError = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    debugAttach('VIDEO_PREVIEW_METADATA', { errorCode: video.error?.code, errorMessage: video.error?.message });
    clearValidationTimeout();
    setValidity('invalid');
    addToast(UNPLAYABLE_MESSAGE, 'error');
  };

  const handleRetake = () => {
    clearValidationTimeout();
    if (recordedUrlRef.current) { URL.revokeObjectURL(recordedUrlRef.current); recordedUrlRef.current = null; }
    setRecordedUrl(null);
    recordedBlobRef.current = null;
    setValidity('checking');
    setSeconds(0);
    setPhase('live');
  };

  const handleConfirm = () => {
    // Nunca debe llegar acá con validity !== 'valid' (el botón queda deshabilitado),
    // pero se guarda igual como última barrera antes de tocar addPendingMedia.
    if (!recordedBlobRef.current || validity !== 'valid') return;
    // Type limpio "video/mp4" (sin ";codecs=...") para el File final — el
    // MediaRecorder necesitaba el string completo con codecs, pero lo que
    // sube a Storage/llega a Meta debe ser un content-type MP4 simple.
    const file = new File([recordedBlobRef.current], `video-${Date.now()}.mp4`, { type: 'video/mp4' });
    debugAttach('VIDEO_FINAL_FILE', { size: file.size, type: file.type, name: file.name });
    closedRef.current = true;
    cleanup();
    onVideoReady(file);
  };

  const handleCancel = () => {
    debugAttach('VIDEO_RECORDER_CANCELLED', { phase });
    handleClose();
  };

  // Salida manual cuando el video quedó inválido: mismo cleanup que cualquier
  // otro cierre (stream, recorder, objectURL) y el mismo fallback nativo que
  // ya usan los caminos de error automáticos — el vendedor no queda varado
  // esperando que el grabador propio "se arregle solo".
  const handleUseNativeFallback = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    debugAttach('VIDEO_RECORDER_FALLBACK_NATIVE', { reason: 'invalid_video_manual_fallback' });
    cleanup();
    onFallbackNative();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-md bg-slate-900/60 animate-in fade-in duration-200">
      <div className="bg-black w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 relative">
        <button type="button" onClick={handleCancel} title="Cancelar"
          className="absolute top-3 right-3 z-20 w-9 h-9 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded-full transition-colors">
          <X className="w-4 h-4" />
        </button>

        <div className="relative aspect-[9/16] max-h-[70vh] bg-black">
          {phase === 'reviewing' && recordedUrl ? (
            <video src={recordedUrl} controls playsInline
              onLoadedMetadata={handlePreviewLoadedMetadata}
              onError={handlePreviewError}
              className="w-full h-full object-contain" />
          ) : (
            <video ref={videoLiveRef} muted autoPlay playsInline className="w-full h-full object-cover" />
          )}
          {phase === 'reviewing' && validity === 'checking' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
              <span className="text-white text-xs font-bold bg-black/60 rounded-full px-3 py-1.5">Verificando video…</span>
            </div>
          )}
          {phase === 'recording' && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/50 rounded-full px-3 py-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-white text-xs font-bold tabular-nums">
                {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}
              </span>
            </div>
          )}
        </div>

        <div className="p-4 flex items-center justify-center gap-4 bg-slate-900">
          {phase === 'live' && (
            <button type="button" onClick={startRecording} title="Grabar"
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors">
              <Circle className="w-6 h-6 text-white fill-white" />
            </button>
          )}
          {phase === 'recording' && (
            <button type="button" onClick={stopRecording} title="Detener"
              className="w-16 h-16 rounded-full bg-white flex items-center justify-center transition-colors">
              <Square className="w-6 h-6 text-red-500 fill-red-500" />
            </button>
          )}
          {phase === 'reviewing' && (
            <div className="w-full flex flex-col gap-2">
              {validity === 'invalid' && (
                <p className="text-rose-400 text-xs font-bold text-center px-2">{UNPLAYABLE_MESSAGE}</p>
              )}
              <div className="flex items-center gap-3 w-full">
                <button type="button" onClick={handleRetake}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-bold transition-colors">
                  <RotateCcw className="w-4 h-4" /> Regrabar
                </button>
                {validity === 'invalid' ? (
                  <button type="button" onClick={handleUseNativeFallback}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold transition-colors">
                    <Smartphone className="w-4 h-4" /> Usar cámara del teléfono
                  </button>
                ) : (
                  <button type="button" onClick={handleConfirm} disabled={validity !== 'valid'}
                    title={validity === 'checking' ? 'Verificando video…' : undefined}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-[#1877F2] hover:bg-blue-600 disabled:opacity-40 disabled:hover:bg-[#1877F2] text-white text-sm font-bold transition-colors">
                    <Check className="w-4 h-4" /> Usar video
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
