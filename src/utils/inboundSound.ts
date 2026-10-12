// Aviso sonoro de mensaje entrante. Mismo enfoque que accessSound.ts (Web Audio
// sintetizado, cero archivos, la CSP de producción bloquea media externa) pero
// con firma propia: UNA nota de campana corta y clara (~230 ms), más aguda y
// seca que el chime de acceso (dos notas ascendentes, 420 ms), para que el
// oído las distinga sin mirar la pantalla.
//
// Autoplay: los navegadores dejan el AudioContext en 'suspended' hasta que hay
// un gesto del usuario. Se comparte UN contexto y se reanuda en el primer
// pointerdown/keydown. Mientras no esté 'running' NO se programa nada: un sonido
// agendado en un contexto suspendido se acumularía y saldría en ráfaga al
// reanudar.

const FUNDAMENTAL = 1046.5; // Do6
const PARTIAL = 2093.0;     // Do7, el brillo de campana
const PEAK_GAIN = 0.13;     // moderado: es un aviso, no una alarma
const DURATION = 0.23;      // s
const MIN_GAP_MS = 900;     // nunca dos avisos pegados, aunque entren varios

type CtxFactory = () => AudioContext | null;

let sharedCtx: AudioContext | null = null;
let lastPlayedAt = 0;
let armed = false;

function defaultFactory(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctx = w.AudioContext || w.webkitAudioContext;
  return Ctx ? new Ctx() : null;
}

function ensureContext(factory: CtxFactory): AudioContext | null {
  if (sharedCtx && sharedCtx.state !== 'closed') return sharedCtx;
  try {
    sharedCtx = factory();
  } catch {
    sharedCtx = null;
  }
  return sharedCtx;
}

/**
 * Registra, una sola vez, los listeners que reanudan el audio con el primer
 * gesto. Se quitan cuando el contexto ya está 'running' y vuelven a ponerse si
 * el navegador lo suspende de nuevo. Devuelve la función que los retira.
 */
export function armInboundAudio(factory: CtxFactory = defaultFactory): () => void {
  if (typeof document === 'undefined' || armed) return () => {};
  armed = true;

  const events: Array<keyof DocumentEventMap> = ['pointerdown', 'keydown'];

  const unlock = () => {
    const ctx = ensureContext(factory);
    if (!ctx) return;
    // Si el navegador lo suspende más tarde, volver a esperar un gesto.
    ctx.onstatechange = () => { if (ctx.state !== 'running') attach(); };
    if (ctx.state === 'running') { detach(); return; }
    ctx.resume().then(() => { if (ctx.state === 'running') detach(); }).catch(() => { /* sin gesto válido: se reintenta en el próximo */ });
  };

  const attach = () => events.forEach((e) => document.addEventListener(e, unlock, { capture: true, passive: true }));
  const detach = () => events.forEach((e) => document.removeEventListener(e, unlock, true));

  attach();
  return () => { detach(); armed = false; };
}

export interface InboundBeepOptions {
  audioContextFactory?: CtxFactory;
  now?: () => number;
}

/** true si sonó. Nunca lanza ni bloquea nada si el audio no está disponible. */
export function playInboundBeep(options: InboundBeepOptions = {}): boolean {
  try {
    const now = (options.now || Date.now)();
    if (now - lastPlayedAt < MIN_GAP_MS) return false;

    const ctx = ensureContext(options.audioContextFactory || defaultFactory);
    if (!ctx) return false;
    if (ctx.state !== 'running') {
      ctx.resume().catch(() => { /* sigue suspendido hasta el próximo gesto */ });
      return false;
    }

    const t0 = ctx.currentTime;
    const partial = (freq: number, peak: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    };
    partial(FUNDAMENTAL, PEAK_GAIN, DURATION);
    partial(PARTIAL, PEAK_GAIN * 0.35, DURATION * 0.6);

    lastPlayedAt = now;
    return true;
  } catch {
    return false;
  }
}

/** Solo para pruebas. */
export function __resetInboundSoundForTests(): void {
  sharedCtx = null;
  lastPlayedAt = 0;
  armed = false;
}
