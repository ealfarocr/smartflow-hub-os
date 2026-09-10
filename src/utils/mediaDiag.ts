// Diagnóstico de controles multimedia VISIBLE EN PANTALLA, para QA en teléfono.
//
// Los console.log no alcanzan: quien prueba lo hace desde el teléfono y no debe
// necesitar chrome://inspect en cada ronda. Esto guarda los últimos eventos en
// memoria y un panel flotante los muestra.
//
// Solo se ve con el modo QA activado (?qa=1 en la URL, que queda recordado en
// este navegador) o para SuperAdmin. Nunca registra contenido: solo el nombre
// del paso y metadatos no sensibles (si el input existe, cuántos archivos).

const QA_KEY = 'smartflow_qa';
const MAX_EVENTS = 14;

export interface MediaDiagEvent {
  at: string;
  step: string;
  data?: Record<string, unknown>;
}

let events: MediaDiagEvent[] = [];
const listeners = new Set<() => void>();

export function recordMediaDiag(step: string, data?: Record<string, unknown>): void {
  const at = new Date().toLocaleTimeString('es-CR', { hour12: false });
  events = [{ at, step, data }, ...events].slice(0, MAX_EVENTS);
  listeners.forEach((l) => l());
}

export function getMediaDiag(): MediaDiagEvent[] {
  return events;
}

export function subscribeMediaDiag(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function clearMediaDiag(): void {
  events = [];
  listeners.forEach((l) => l());
}

/** ?qa=1 activa el modo y lo recuerda; ?qa=0 lo apaga. */
export function isQaModeEnabled(search: string = typeof window !== 'undefined' ? window.location.search : ''): boolean {
  try {
    const param = new URLSearchParams(search).get('qa');
    if (param === '1') localStorage.setItem(QA_KEY, '1');
    if (param === '0') localStorage.removeItem(QA_KEY);
    return localStorage.getItem(QA_KEY) === '1';
  } catch {
    return false;
  }
}
