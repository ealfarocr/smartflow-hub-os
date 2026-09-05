// Orden de preferencia: los tres son contenedor MP4 (H.264), el único formato
// que WhatsApp Cloud API acepta para video (verificado contra la documentación
// oficial de Meta — WebM/VP8/VP9, que es lo que Chrome Android graba por
// defecto con MediaRecorder, NO es un formato soportado). Si ninguno de los
// tres pasa isTypeSupported(), el grabador propio no debe activarse.
const CANDIDATE_VIDEO_MIME_TYPES = [
  'video/mp4;codecs=h264,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4',
];

// Único punto de detección — lo usa tanto ConversationsPageView (para decidir
// si abrir el grabador propio o caer directo al <input capture> nativo) como
// VideoRecorderModal (para saber con qué mimeType configurar el MediaRecorder
// real). Un solo lugar evita que ambos lados queden desincronizados.
export function getSupportedVideoMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  for (const mimeType of CANDIDATE_VIDEO_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
  }
  return null;
}
