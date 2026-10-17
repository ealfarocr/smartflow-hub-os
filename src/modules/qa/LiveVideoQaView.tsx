import { useCallback, useEffect, useRef, useState } from 'react';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { Video, Square, Copy, Trash2, Loader2 } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import {
  AUDIO_BITRATE, CHUNK_MS, ChunkUploadQueue, MAX_RECORD_SECONDS, VIDEO_BITRATE_OPTIONS,
  buildReport, clockMs, newJobId, pickRecorderMime, toMb, uploadRateBps, wallMs,
  type LiveVideoSession, type QueueStats,
} from './liveVideo';
import { LiveVideoWhatsappCard } from './LiveVideoWhatsappCard';

// PROTOTIPO QA "Live Video" — SuperAdmin o UID QA (ver LiveVideoQaGuard). No envía nada a
// WhatsApp, no toca conversaciones ni tenants. Graba con getUserMedia +
// MediaRecorder y sube cada chunk MIENTRAS sigue grabando, para medir cuánto
// tarda en estar listo el archivo después de detener.
type Phase = 'idle' | 'recording' | 'finishing' | 'ready' | 'error';

const EMPTY_STATS: QueueStats = {
  chunksCreated: 0, chunksUploaded: 0, chunksFailed: 0, bytesCreated: 0, bytesUploaded: 0, backlogBytes: 0, backlogChunks: 0,
};

const Row = ({ k, v }: { k: string; v: string | number }) => (
  <div className="flex justify-between gap-3 text-xs py-0.5"><span className="text-slate-500">{k}</span><span className="font-bold tabular-nums text-slate-800 dark:text-slate-100 text-right">{v}</span></div>
);

export const LiveVideoQaView = () => {
  const { addToast } = useUIStore();
  const [videoBps, setVideoBps] = useState<number>(VIDEO_BITRATE_OPTIONS[1]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [stats, setStats] = useState<QueueStats>(EMPTY_STATS);
  const [seconds, setSeconds] = useState(0);
  const [session, setSession] = useState<LiveVideoSession | null>(null);
  const [finalUrl, setFinalUrl] = useState<string | null>(null);
  const [jobIdShown, setJobIdShown] = useState<string | null>(null);
  const [upBps, setUpBps] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const queueRef = useRef<ChunkUploadQueue | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const jobIdRef = useRef('');
  const sessionRef = useRef<LiveVideoSession | null>(null);

  const mimeSupport = typeof MediaRecorder !== 'undefined'
    ? pickRecorderMime(m => MediaRecorder.isTypeSupported(m))
    : { chosen: null, tested: [], mp4H264Aac: false, isMp4: false };

  const cleanupMedia = useCallback(() => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    void wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  useEffect(() => () => {
    try { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); } catch { /* ya detenido */ }
    cleanupMedia();
  }, [cleanupMedia]);

  const patchSession = (patch: Partial<LiveVideoSession>) => {
    sessionRef.current = { ...(sessionRef.current as LiveVideoSession), ...patch };
    setSession(sessionRef.current);
  };

  const start = async () => {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      addToast('Este navegador no soporta grabación (MediaRecorder / cámara).', 'error');
      return;
    }
    setFinalUrl(null);
    setStats(EMPTY_STATS);
    setSeconds(0);
    const jobId = newJobId();
    jobIdRef.current = jobId;
    setJobIdShown(jobId);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 1280 }, frameRate: { ideal: 30, max: 30 } },
        audio: true,
      });
    } catch (e) {
      setPhase('error');
      addToast(`No se pudo abrir la cámara: ${(e as Error).name}`, 'error');
      return;
    }
    streamRef.current = stream;
    if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play().catch(() => {}); }
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
      wakeLockRef.current = (await nav.wakeLock?.request('screen')) ?? null;
    } catch { /* sin wake lock: la pantalla puede apagarse sola */ }

    const settings = stream.getVideoTracks()[0]?.getSettings();
    const options: MediaRecorderOptions = { videoBitsPerSecond: videoBps, audioBitsPerSecond: AUDIO_BITRATE };
    if (mimeSupport.chosen) options.mimeType = mimeSupport.chosen;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, options);
    } catch (e) {
      cleanupMedia();
      setPhase('error');
      addToast(`No se pudo crear el grabador: ${(e as Error).message}`, 'error');
      return;
    }
    recorderRef.current = recorder;

    const { ref, uploadBytes } = await import('firebase/storage');
    const { storage, auth } = await import('@/lib/firebase');
    // El uid de la ruta es el de Firebase Auth (storage.rules exige uid == request.auth.uid).
    const uid = auth.currentUser?.uid;
    if (!uid) {
      cleanupMedia();
      setPhase('error');
      addToast('Sesión no válida para el prototipo QA', 'error');
      return;
    }
    const contentType = (recorder.mimeType || mimeSupport.chosen || 'video/mp4').split(';')[0];
    const queue = new ChunkUploadQueue({
      concurrency: 3,
      upload: async (index, blob) => {
        const name = `live-video-qa/${uid}/${jobId}/c${String(index).padStart(4, '0')}`;
        await uploadBytes(ref(storage, name), blob, { contentType });
      },
    });
    queueRef.current = queue;

    sessionRef.current = {
      device: navigator.userAgent.slice(0, 160), mime: mimeSupport, actualMime: recorder.mimeType || null,
      requestedVideoBps: videoBps, requestedAudioBps: AUDIO_BITRATE,
      trackSettings: settings ? { width: settings.width, height: settings.height, frameRate: settings.frameRate } : null,
      recordedSeconds: 0, stats: EMPTY_STATS, records: [], backlogAtStopBytes: null,
      stopAt: null, uploadsDoneAt: null, readyAt: null, serverResult: null, quality: null, error: null,
    };
    setSession(sessionRef.current);

    let index = 0;
    recorder.ondataavailable = (ev: BlobEvent) => {
      if (ev.data && ev.data.size > 0) queue.add(index++, ev.data);
    };
    recorder.onerror = (ev) => {
      patchSession({ error: `MediaRecorder: ${(ev as unknown as { error?: { name?: string } }).error?.name || 'error'}` });
    };
    recorder.onstop = () => { void finish(index); };

    startedAtRef.current = clockMs();
    recorder.start(CHUNK_MS);
    setPhase('recording');
    timerRef.current = window.setInterval(() => {
      const s = (clockMs() - startedAtRef.current) / 1000;
      setSeconds(s);
      setStats(queue.stats());
      setUpBps(uploadRateBps(queue.records));
      if (s >= MAX_RECORD_SECONDS) stop();
    }, 250);
  };

  const stop = () => {
    const rec = recorderRef.current;
    if (!rec || rec.state !== 'recording') return;
    const stopAt = wallMs();
    const recordedSeconds = (clockMs() - startedAtRef.current) / 1000;
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    setPhase('finishing');
    // El último chunk llega dentro de stop(); el backlog "al detener" se toma
    // cuando ya está en la cola (ver finish).
    patchSession({ stopAt, recordedSeconds });
    rec.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
  };

  const finish = async (chunkCount: number) => {
    const queue = queueRef.current;
    if (!queue) return;
    const jobId = jobIdRef.current;
    // Con el último chunk ya encolado: cuánto de lo grabado NO estaba subido.
    const atStop = queue.stats();
    patchSession({ backlogAtStopBytes: atStop.backlogBytes });
    setStats(atStop);
    try {
      await queue.idle();
      const done = queue.stats();
      patchSession({ uploadsDoneAt: wallMs(), stats: done, records: queue.records.slice() });
      setStats(done);
      setUpBps(uploadRateBps(queue.records));
      if (done.chunksFailed > 0) throw new Error(`${done.chunksFailed} chunk(s) no se pudieron subir`);
      const fn = httpsCallable<
        { action: 'compose'; jobId: string; chunkCount: number; mimeType: string },
        NonNullable<LiveVideoSession['serverResult']> & { url: string }
      >(getFunctions(), 'liveVideoQa');
      const res = await fn({ action: 'compose', jobId, chunkCount, mimeType: recorderRef.current?.mimeType || mimeSupport.chosen || 'video/mp4' });
      patchSession({ readyAt: wallMs(), serverResult: res.data });
      setFinalUrl(res.data.url);
      setPhase('ready');
    } catch (e) {
      const msg = (e as { code?: string; message?: string })?.message || 'error';
      patchSession({ error: msg, records: queue.records.slice(), stats: queue.stats() });
      setPhase('error');
      addToast(`Falló la prueba: ${msg}`, 'error');
    } finally {
      cleanupMedia();
    }
  };

  const copyReport = async () => {
    if (!sessionRef.current) return;
    const text = buildReport({ ...sessionRef.current, records: sessionRef.current.records });
    try { await navigator.clipboard.writeText(text); addToast('Reporte copiado.', 'success'); }
    catch { addToast('No se pudo copiar; seleccioná el texto de abajo.', 'warning'); }
  };

  const deleteTest = async () => {
    const jobId = jobIdRef.current;
    if (!jobId) return;
    try {
      const fn = httpsCallable<{ action: 'delete'; jobId: string }, { deleted: number }>(getFunctions(), 'liveVideoQa');
      const r = await fn({ action: 'delete', jobId });
      addToast(`Prueba borrada (${r.data.deleted} archivos).`, 'success');
      setFinalUrl(null);
    } catch (e) {
      addToast(`No se pudo borrar: ${(e as Error).message}`, 'error');
    }
  };

  const shownSeconds = phase === 'recording' ? seconds : session?.recordedSeconds ?? 0;
  const recBps = shownSeconds > 0 ? (stats.bytesCreated * 8) / shownSeconds : 0;
  const sinceStop = session?.stopAt && session.readyAt ? session.readyAt - session.stopAt : null;
  const reportText = session ? buildReport(session) : '';

  return (
    <div className="max-w-xl mx-auto p-4 space-y-4">
      <div>
        <h1 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2"><Video className="w-5 h-5" /> Live Video — prueba QA</h1>
        <p className="text-xs text-slate-500 mt-1">Prototipo de medición (solo SuperAdmin). Graba hasta {MAX_RECORD_SECONDS} s subiendo cada {CHUNK_MS / 1000} s mientras graba. No envía nada a WhatsApp.</p>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800">
        <Row k="MP4 + H.264 + AAC soportado" v={mimeSupport.mp4H264Aac ? 'SÍ' : 'NO'} />
        <Row k="Formato elegido" v={mimeSupport.chosen || 'ninguno'} />
        <p className="text-[10px] text-slate-400 mt-1 break-all">Probados: {mimeSupport.tested.map(t => `${t.supported ? '✓' : '✗'} ${t.mime}`).join(' · ')}</p>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs font-bold text-slate-600 dark:text-slate-300">Bitrate de video</label>
        <select value={videoBps} onChange={e => setVideoBps(Number(e.target.value))} disabled={phase === 'recording' || phase === 'finishing'}
          className="text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1">
          {VIDEO_BITRATE_OPTIONS.map(b => <option key={b} value={b}>{(b / 1e6).toFixed(1)} Mbps</option>)}
        </select>
      </div>

      <LiveVideoWhatsappCard />

      <video ref={videoRef} muted playsInline className="w-full rounded-2xl bg-black aspect-video object-cover" />

      <div className="flex gap-2">
        {phase !== 'recording' ? (
          <button type="button" onClick={start} disabled={phase === 'finishing'}
            className="flex-1 h-12 rounded-2xl bg-[#1877F2] text-white font-black disabled:opacity-50 flex items-center justify-center gap-2">
            {phase === 'finishing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />} Probar Live Video
          </button>
        ) : (
          <button type="button" onClick={stop} className="flex-1 h-12 rounded-2xl bg-rose-600 text-white font-black flex items-center justify-center gap-2">
            <Square className="w-4 h-4" /> Detener ({Math.floor(seconds)} s)
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800">
        <Row k="Estado" v={phase} />
        {jobIdShown && <Row k="Job" v={jobIdShown} />}
        <Row k="RECORDED_SECONDS" v={shownSeconds.toFixed(1)} />
        <Row k="RECORDED_MB / UPLOADED_MB" v={`${toMb(stats.bytesCreated)} / ${toMb(stats.bytesUploaded)}`} />
        <Row k="UPLOAD_BACKLOG_MB" v={toMb(stats.backlogBytes)} />
        <Row k="CHUNKS_CREATED / UPLOADED" v={`${stats.chunksCreated} / ${stats.chunksUploaded}${stats.chunksFailed ? ` (fallaron ${stats.chunksFailed})` : ''}`} />
        <Row k="Bitrate efectivo grabado" v={`${(recBps / 1e6).toFixed(2)} Mbps`} />
        {upBps !== null && <Row k="Velocidad de subida" v={`${(upBps / 1e6).toFixed(2)} Mbps`} />}
        {sinceStop !== null && <Row k="STOP_TO_READY" v={`${sinceStop} ms`} />}
        {session?.serverResult && <Row k="FINAL_SIZE_MB" v={toMb(session.serverResult.sizeBytes)} />}
        {session?.error && <p className="text-xs text-red-600 mt-1">{session.error}</p>}
      </div>

      {finalUrl && (
        <div className="space-y-2">
          <video src={finalUrl} controls playsInline className="w-full rounded-2xl bg-black" />
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">¿Calidad aceptable?</span>
            <button type="button" onClick={() => patchSession({ quality: 'si' })} className={`px-3 py-1 rounded-lg text-xs font-bold border ${session?.quality === 'si' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-300'}`}>Sí</button>
            <button type="button" onClick={() => patchSession({ quality: 'no' })} className={`px-3 py-1 rounded-lg text-xs font-bold border ${session?.quality === 'no' ? 'bg-rose-600 text-white border-rose-600' : 'border-slate-300'}`}>No</button>
          </div>
        </div>
      )}

      {session && (phase === 'ready' || phase === 'error') && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <button type="button" onClick={copyReport} className="flex-1 h-10 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-bold flex items-center justify-center gap-2"><Copy className="w-4 h-4" /> Copiar reporte</button>
            <button type="button" onClick={deleteTest} className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-bold flex items-center gap-1"><Trash2 className="w-4 h-4" /> Borrar</button>
          </div>
          <pre className="text-[10px] leading-snug whitespace-pre-wrap break-words rounded-xl bg-slate-100 dark:bg-slate-900 p-3 select-all">{reportText}</pre>
        </div>
      )}
    </div>
  );
};
