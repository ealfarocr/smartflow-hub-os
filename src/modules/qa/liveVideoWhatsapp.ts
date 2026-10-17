// Prueba de compatibilidad WhatsApp del video Live Video QA. Constantes y lógica pura
// (sin Firebase) para poder testearlas. El envío real reutiliza
// ConversationService.sendMessage -> sendWhatsappMessage; nada de esto crea otro pipeline.

export const WA_QA_TENANT_ID = 't-1791700036682';
export const WA_QA_TENANT_LABEL = 'USADITOS CR';
export const WA_QA_CONVERSATION_ID = 'J8qU4lmvYkuRMjYxtvRy';
export const WA_QA_FILENAME = 'live-video-qa.mp4';
// Video ya validado (job mvc0dj5ddmsvu0). No se borra.
export const WA_QA_VIDEO_PATH = 'live-video-qa/Bw4GC41RiSQ1s3pw4RpypL2eEcz1/mvc0dj5ddmsvu0/final.mp4';
export const WA_QA_VIDEO_LABEL = '57.7 s · 10.64 MB';

const WINDOW_MS = 24 * 60 * 60 * 1000;

export const isWindow24hActive = (lastInboundMs: number | null, nowMs: number): boolean =>
  lastInboundMs !== null && nowMs - lastInboundMs <= WINDOW_MS;

export interface WaQaFailure {
  http: string; code: string; subcode: string; type: string; message: string; fbtraceId: string;
}

interface MetaErrorDoc { httpStatus?: number | null; code?: number | null; subcode?: number | null; type?: string | null; fbtraceId?: string | null }

const show = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : String(v));

// Solo campos de diagnóstico de Meta; jamás tokens ni teléfonos.
export const buildWaQaFailure = (message: string | null | undefined, meta: MetaErrorDoc | null | undefined): WaQaFailure => ({
  http: show(meta?.httpStatus), code: show(meta?.code), subcode: show(meta?.subcode),
  type: show(meta?.type), message: show(message), fbtraceId: show(meta?.fbtraceId),
});
