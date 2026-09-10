// Firma sonora de SmartFlow y feedback háptico — se disparan SOLO después de
// una entrada exitosa, nunca al pulsar ni al fallar.
//
// El sonido se sintetiza con Web Audio en vez de cargar un archivo: pesa cero,
// no depende de ningún CDN (la CSP de producción bloquea media externa) y no
// suma una request al arranque. Son dos notas cortas ascendentes con una
// envolvente suave — discreto, sin voz y sin picos estridentes.

const NOTE_A = 587.33; // Re5
const NOTE_B = 880.0;  // La5
const PEAK_GAIN = 0.16; // deliberadamente bajo: es una confirmación, no una alarma

export interface AccessFeedbackOptions {
  /** Inyectable para poder testear sin un AudioContext real. */
  audioContextFactory?: () => AudioContext | null;
  vibrate?: (pattern: number | number[]) => boolean;
  prefersReducedMotion?: () => boolean;
}

function defaultAudioContextFactory(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctx ? new Ctx() : null;
}

function defaultPrefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Duración total ~420 ms (dentro de los 300-600 ms buscados). Devuelve false si
 * no se pudo reproducir — no hay forma de leer el silenciador del sistema desde
 * la web, así que se mantiene el volumen bajo y NUNCA se bloquea la navegación
 * por el audio: si el navegador lo rechaza, la entrada sigue igual.
 */
export function playAccessChime(options: AccessFeedbackOptions = {}): boolean {
  const factory = options.audioContextFactory || defaultAudioContextFactory;
  try {
    const ctx = factory();
    if (!ctx) return false;

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);

    const note = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      // Triangular: más cuerpo que una senoidal pura, sin los armónicos duros
      // de una cuadrada o de un diente de sierra.
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + start);
      // Ataque y caída suaves: sin clics en los bordes.
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, now + start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now + start);
      osc.stop(now + start + duration + 0.02);
    };

    note(NOTE_A, 0, 0.16);
    note(NOTE_B, 0.12, 0.3);

    // Cierra el contexto cuando terminó, para no dejar audio abierto.
    // setTimeout global (no window.setTimeout): así el módulo no depende de que
    // exista `window`, que es lo que rompía bajo el entorno de tests.
    setTimeout(() => { try { ctx.close(); } catch { /* ya cerrado */ } }, 700);
    return true;
  } catch {
    return false;
  }
}

/**
 * Vibración corta de confirmación. No existe en iOS Safari (navigator.vibrate
 * no está implementado) — devuelve false y no pasa nada más. Se respeta
 * "reducir movimiento": quien lo activó no quiere feedback físico extra.
 */
export function triggerAccessHaptic(options: AccessFeedbackOptions = {}): boolean {
  const reduced = (options.prefersReducedMotion || defaultPrefersReducedMotion)();
  if (reduced) return false;
  const vibrate = options.vibrate
    || (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
      ? navigator.vibrate.bind(navigator)
      : null);
  if (!vibrate) return false;
  try {
    return vibrate([12, 40, 22]);
  } catch {
    return false;
  }
}

/** Sonido + háptico juntos. Nunca lanza: el acceso no depende de esto. */
export function playAccessFeedback(options: AccessFeedbackOptions = {}): { sound: boolean; haptic: boolean } {
  return {
    sound: playAccessChime(options),
    haptic: triggerAccessHaptic(options),
  };
}
