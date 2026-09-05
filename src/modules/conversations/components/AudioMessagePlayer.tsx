import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Download } from 'lucide-react';

// El transporte del audio ya funciona (WhatsApp lo recibe y reproduce bien);
// lo que faltaba era una experiencia de reproducción directa dentro de
// SmartFlow — el <audio controls> nativo del navegador se veía como una
// barra genérica dentro de la burbuja del chat y pasaba desapercibido, así
// que el vendedor terminaba usando el link de descarga en su lugar. Este
// componente usa el mismo <audio> nativo como motor (sin librería nueva),
// solo con controles propios (Play/Pause, progreso, tiempo) estilo WhatsApp.
interface AudioMessagePlayerProps {
  src: string;
}

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

export const AudioMessagePlayer = ({ src }: AudioMessagePlayerProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onEnded = () => setCurrentTime(0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    setCurrentTime(audio.currentTime);
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-2 w-full min-w-[200px]">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <button type="button" onClick={togglePlay} title={isPlaying ? 'Pausar' : 'Reproducir'}
        className="w-9 h-9 shrink-0 rounded-full bg-[#1877F2] hover:bg-blue-600 flex items-center justify-center text-white transition-colors">
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div onClick={handleSeek} title="Buscar"
          className="h-1.5 bg-black/10 dark:bg-white/15 rounded-full cursor-pointer relative overflow-hidden">
          <div className="h-full bg-[#1877F2] rounded-full" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">{formatTime(currentTime)}</span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">{formatTime(duration)}</span>
        </div>
      </div>
      <a href={src} target="_blank" rel="noopener noreferrer" title="Descargar audio"
        className="w-7 h-7 shrink-0 flex items-center justify-center text-slate-400 hover:text-[#1877F2] transition-colors">
        <Download className="w-3.5 h-3.5" />
      </a>
    </div>
  );
};
