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
const MAX_EVENTS = 24;

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

// Solo en desarrollo o en el build de QA local (--mode qalocal, contra
// emuladores): el script de QA del puesto del vendedor lee el registro completo,
// no solo lo que entra en el panel. En el build de producción no existe.
if ((import.meta.env?.DEV || import.meta.env?.MODE === 'qalocal') && typeof window !== 'undefined') {
  (window as unknown as { __sfMediaDiag?: () => MediaDiagEvent[] }).__sfMediaDiag = () => events;
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

/**
 * Se llama UNA vez al arrancar la app, antes de cualquier redirección.
 *
 * Antes solo se leía dentro del panel al montarse: si se abría
 * hub.smartflow-suite.com/?qa=1, el aterrizaje redirigía a /conversaciones
 * DESCARTANDO el parámetro, y el panel nunca se activaba. Por eso las
 * instrucciones de prueba terminaban en un panel invisible.
 */
export function captureQaFlagFromUrl(): void {
  isQaModeEnabled();
}

export interface DeviceEnvironment {
  userAgent: string;
  browser: string;
  /** Navegador embebido en otra app (WebView): suele NO abrir selectores de archivo. */
  embedded: string | null;
  standalonePwa: boolean;
  touch: boolean;
  maxTouchPoints: number;
  showPickerApi: boolean;
}

/**
 * Qué navegador está usando realmente el teléfono. Es la pregunta clave cuando
 * un input de archivo no abre NADA sin importar cómo se lo active: dentro de un
 * navegador embebido en otra app (lo que abre un enlace tocado dentro de
 * Facebook, Instagram o Messenger, y a veces WhatsApp), el selector de archivos
 * solo funciona si esa app lo implementa — y muchas no lo hacen.
 */
export function describeEnvironment(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): DeviceEnvironment {
  const embeddedApps: [RegExp, string][] = [
    [/FBAN|FBAV|FB_IAB|FBIOS/i, 'Facebook'],
    [/Instagram/i, 'Instagram'],
    [/Messenger|FBMS/i, 'Messenger'],
    [/WhatsApp/i, 'WhatsApp'],
    [/Line\//i, 'LINE'],
    [/Telegram/i, 'Telegram'],
    [/TikTok|musical_ly|BytedanceWebview/i, 'TikTok'],
  ];
  const app = embeddedApps.find(([re]) => re.test(ua));
  // "; wv)" es la marca de Android WebView en el user agent.
  const genericWebView = /; wv\)/.test(ua) || /Version\/[\d.]+ Chrome\/[\d.]+ Mobile Safari/.test(ua);
  const embedded = app ? app[1] : genericWebView ? 'WebView de Android' : null;

  const browser =
    /SamsungBrowser/i.test(ua) ? 'Samsung Internet'
    : /OPR\/|Opera/i.test(ua) ? 'Opera'
    : /EdgA?\//i.test(ua) ? 'Edge'
    : /Firefox|FxiOS/i.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//i.test(ua) ? 'Chrome'
    : /Safari/i.test(ua) ? 'Safari'
    : 'desconocido';

  let standalonePwa = false;
  let touch = false;
  let maxTouchPoints = 0;
  let showPickerApi = false;
  try {
    standalonePwa = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches;
    touch = typeof window !== 'undefined' && 'ontouchstart' in window;
    maxTouchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;
    showPickerApi = typeof HTMLInputElement !== 'undefined' && 'showPicker' in HTMLInputElement.prototype;
  } catch { /* entorno sin DOM */ }

  return { userAgent: ua, browser, embedded, standalonePwa, touch, maxTouchPoints, showPickerApi };
}
