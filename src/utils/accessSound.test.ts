import { describe, it, expect, vi } from 'vitest';
import { playAccessChime, triggerAccessHaptic, playAccessFeedback } from './accessSound';

// AudioContext falso: registra qué se programó, sin reproducir nada.
function makeFakeCtx() {
  const scheduled: { freq: number; start: number; stop: number; type: string }[] = [];
  const gains: { peak: number }[] = [];
  let closed = false;
  const ctx = {
    currentTime: 0,
    destination: {},
    createGain: () => {
      const g = { peak: 0 };
      gains.push(g);
      return {
        gain: {
          value: 1,
          setValueAtTime: () => {},
          exponentialRampToValueAtTime: (v: number) => { if (v > g.peak) g.peak = v; },
        },
        connect: () => {},
      };
    },
    createOscillator: () => {
      const entry = { freq: 0, start: 0, stop: 0, type: '' };
      scheduled.push(entry);
      return {
        set type(t: string) { entry.type = t; },
        get type() { return entry.type; },
        frequency: { setValueAtTime: (f: number) => { entry.freq = f; } },
        connect: () => {},
        start: (t: number) => { entry.start = t; },
        stop: (t: number) => { entry.stop = t; },
      };
    },
    close: () => { closed = true; },
  };
  return { ctx, scheduled, gains, isClosed: () => closed };
}

describe('Firma sonora de acceso', () => {
  it('suena y programa dos notas ascendentes', () => {
    const fake = makeFakeCtx();
    const ok = playAccessChime({ audioContextFactory: () => fake.ctx as unknown as AudioContext });
    expect(ok).toBe(true);
    expect(fake.scheduled).toHaveLength(2);
    expect(fake.scheduled[1].freq).toBeGreaterThan(fake.scheduled[0].freq);
  });

  it('dura entre 300 y 600 ms, como se pidió', () => {
    const fake = makeFakeCtx();
    playAccessChime({ audioContextFactory: () => fake.ctx as unknown as AudioContext });
    const total = Math.max(...fake.scheduled.map((s) => s.stop));
    expect(total).toBeGreaterThanOrEqual(0.3);
    expect(total).toBeLessThanOrEqual(0.6);
  });

  it('es discreto: no se acerca al volumen máximo', () => {
    const fake = makeFakeCtx();
    playAccessChime({ audioContextFactory: () => fake.ctx as unknown as AudioContext });
    const peaks = fake.gains.map((g) => g.peak).filter((p) => p > 0);
    expect(Math.max(...peaks)).toBeLessThanOrEqual(0.2);
  });

  it('usa una onda triangular, no cuadrada ni diente de sierra (sin armónicos duros)', () => {
    const fake = makeFakeCtx();
    playAccessChime({ audioContextFactory: () => fake.ctx as unknown as AudioContext });
    fake.scheduled.forEach((s) => expect(s.type).toBe('triangle'));
  });

  it('si el navegador no permite audio, devuelve false sin lanzar — la entrada no depende del sonido', () => {
    expect(playAccessChime({ audioContextFactory: () => null })).toBe(false);
    expect(playAccessChime({ audioContextFactory: () => { throw new Error('bloqueado'); } })).toBe(false);
  });
});

describe('Feedback háptico', () => {
  it('vibra corto cuando el dispositivo lo soporta', () => {
    const vibrate = vi.fn((_pattern: number | number[]) => true);
    expect(triggerAccessHaptic({ vibrate, prefersReducedMotion: () => false })).toBe(true);
    expect(vibrate).toHaveBeenCalledOnce();
    const pattern = vibrate.mock.calls[0][0] as number[];
    expect(Math.max(...pattern)).toBeLessThanOrEqual(50);
  });

  it('respeta "reducir movimiento": no vibra', () => {
    const vibrate = vi.fn(() => true);
    expect(triggerAccessHaptic({ vibrate, prefersReducedMotion: () => true })).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('sin soporte de vibración (iOS) devuelve false sin lanzar', () => {
    expect(triggerAccessHaptic({ vibrate: undefined, prefersReducedMotion: () => false })).toBe(false);
  });

  it('si vibrate lanza, no rompe nada', () => {
    expect(triggerAccessHaptic({ vibrate: () => { throw new Error('x'); }, prefersReducedMotion: () => false })).toBe(false);
  });
});

describe('Feedback combinado', () => {
  it('nunca lanza, aunque fallen las dos cosas', () => {
    const r = playAccessFeedback({
      audioContextFactory: () => null,
      vibrate: undefined,
      prefersReducedMotion: () => true,
    });
    expect(r).toEqual({ sound: false, haptic: false });
  });
});
