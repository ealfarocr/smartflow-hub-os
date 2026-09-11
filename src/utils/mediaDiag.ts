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
// El panel muestra los últimos 10; "Copiar diagnóstico" copia todos estos.
const MAX_EVENTS = 80;

export interface MediaDiagEvent {
  at: string;
  step: string;
  data?: Record<string, unknown>;
}

// El registro se guarda también en sessionStorage (solo esta pestaña, solo
// metadatos): si Android cierra la página mientras la cámara está abierta —pasa
// en teléfonos con poca memoria— el diagnóstico sobrevive a la recarga.
const STORE_KEY = 'smartflow_media_diag';
const PICKER_KEY = 'smartflow_picker_open';

function loadStored(): MediaDiagEvent[] {
  try {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORE_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_EVENTS) : [];
  } catch {
    return [];
  }
}

function persist(): void {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(events)); } catch { /* sin almacenamiento: queda en memoria */ }
}

let events: MediaDiagEvent[] = loadStored();
const listeners = new Set<() => void>();

export function recordMediaDiag(step: string, data?: Record<string, unknown>): void {
  const at = new Date().toLocaleTimeString('es-CR', { hour12: false });
  events = [{ at, step, data }, ...events].slice(0, MAX_EVENTS);
  persist();
  listeners.forEach((l) => l());
}

/**
 * Selector o cámara abiertos: se anota en sessionStorage y se borra cuando
 * vuelve el archivo o se cancela. Si al arrancar la app la marca sigue ahí, la
 * página se recargó mientras el selector estaba abierto: Android la cerró
 * (falta de memoria) y ese archivo no va a llegar.
 */
export function markPickerOpen(control: string): void {
  try { sessionStorage.setItem(PICKER_KEY, JSON.stringify({ control, at: Date.now() })); } catch { /* sin almacenamiento */ }
}

export function clearPickerOpen(): void {
  try { sessionStorage.removeItem(PICKER_KEY); } catch { /* sin almacenamiento */ }
}

let reloadedDuringPicker: { control: string; segundos: number } | null = null;

function detectReloadDuringPicker(): void {
  try {
    const raw = sessionStorage.getItem(PICKER_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PICKER_KEY);
    const { control, at } = JSON.parse(raw) as { control: string; at: number };
    reloadedDuringPicker = { control, segundos: Math.round((Date.now() - at) / 1000) };
    recordMediaDiag('PAGE_RELOADED_WHILE_PICKER_OPEN', reloadedDuringPicker);
  } catch { /* marca ilegible: se ignora */ }
}

/** Una sola vez: el chat avisa al vendedor que la cámara cerró la página. */
export function consumePickerReload(): { control: string; segundos: number } | null {
  const r = reloadedDuringPicker;
  reloadedDuringPicker = null;
  return r;
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
  persist();
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
  detectReloadDuringPicker();
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
  /** display-mode que reporta el navegador: browser, standalone, minimal-ui, fullscreen. */
  displayMode: string;
  /** Marcas de Client Hints (userAgentData.brands). Un WebView dice "Android WebView"
   *  aunque su user agent se haga pasar por Chrome. */
  brands: string;
  /** android-app://<paquete> cuando la abre una TWA (app de Android que envuelve el sitio). */
  referrerApp: string | null;
  /** En qué corre realmente la página, en palabras. */
  container: string;
}

export interface ContainerSignals {
  ua: string;
  brands: string[];
  displayMode: string;
  referrer: string;
}

/**
 * Dónde corre de verdad la página. La app NO tiene manifest de PWA, así que un
 * "display-mode: standalone" significa que la abrió otra cosa que una pestaña de
 * Chrome: un acceso directo en modo app, una TWA o el WebView de otra app. Eso
 * importa porque en un WebView el selector de archivos solo aparece si la app que
 * lo envuelve lo implementa; si no, el input recibe el toque y se cancela solo.
 */
export function describeContainer(s: ContainerSignals): string {
  if (s.brands.some((b) => /Android WebView/i.test(b)) || /; wv\)/.test(s.ua)) return 'WebView dentro de otra app';
  if (s.referrer.startsWith('android-app://')) return `app de Android (TWA ${s.referrer.replace('android-app://', '').split('/')[0]})`;
  if (s.displayMode !== 'browser') return `app instalada / acceso directo (${s.displayMode})`;
  return 'pestaña del navegador';
}

function currentDisplayMode(): string {
  try {
    for (const m of ['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay']) {
      if (window.matchMedia?.(`(display-mode: ${m})`).matches) return m;
    }
  } catch { /* sin matchMedia */ }
  return 'browser';
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
  let displayMode = 'browser';
  let brands: string[] = [];
  let referrer = '';
  try {
    standalonePwa = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches;
    touch = typeof window !== 'undefined' && 'ontouchstart' in window;
    maxTouchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;
    showPickerApi = typeof HTMLInputElement !== 'undefined' && 'showPicker' in HTMLInputElement.prototype;
    if (typeof window !== 'undefined') {
      displayMode = currentDisplayMode();
      referrer = document.referrer || '';
      const uaData = (navigator as unknown as { userAgentData?: { brands?: { brand: string; version: string }[] } }).userAgentData;
      brands = (uaData?.brands || []).map((b) => `${b.brand} ${b.version}`).filter((b) => !/Not.?A.?Brand/i.test(b));
    }
  } catch { /* entorno sin DOM */ }

  const webviewByBrand = brands.some((b) => /Android WebView/i.test(b));
  return {
    userAgent: ua, browser,
    embedded: embedded ?? (webviewByBrand ? 'WebView de Android' : null),
    standalonePwa, touch, maxTouchPoints, showPickerApi,
    displayMode,
    brands: brands.join(', ') || '(sin Client Hints)',
    referrerApp: referrer.startsWith('android-app://') ? referrer.split('/').slice(0, 3).join('/') : null,
    container: describeContainer({ ua, brands, displayMode, referrer }),
  };
}
