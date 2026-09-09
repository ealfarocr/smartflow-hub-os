import { describe, it, expect } from 'vitest';
import { formatLastSeen } from './formatLastSeen';

const NOW = new Date('2026-09-09T12:00:00.000Z');

describe('formatLastSeen — nunca debe mostrar Invalid Date', () => {
  it('undefined -> fallback seguro, no "Invalid Date"', () => {
    expect(formatLastSeen(undefined, NOW)).toBe('Sin actividad registrada');
  });

  it('null -> fallback seguro', () => {
    expect(formatLastSeen(null, NOW)).toBe('Sin actividad registrada');
  });

  it('string vacío -> fallback seguro (Date("") es Invalid Date)', () => {
    expect(formatLastSeen('', NOW)).toBe('Sin actividad registrada');
  });

  it('string no parseable -> fallback seguro', () => {
    expect(formatLastSeen('no-es-una-fecha', NOW)).toBe('Sin actividad registrada');
  });

  it('objeto sin toDate() (no es un Timestamp real) -> fallback seguro', () => {
    // @ts-expect-error simula un valor con forma inesperada, exactamente lo
    // que se quiere blindar
    expect(formatLastSeen({ foo: 'bar' }, NOW)).toBe('Sin actividad registrada');
  });

  it('string ISO válido, hace 30 segundos -> "Activo ahora"', () => {
    expect(formatLastSeen(new Date(NOW.getTime() - 30_000).toISOString(), NOW)).toBe('Activo ahora');
  });

  it('string ISO válido, hace 10 minutos -> "Visto hace 10 min"', () => {
    expect(formatLastSeen(new Date(NOW.getTime() - 10 * 60_000).toISOString(), NOW)).toBe('Visto hace 10 min');
  });

  it('string ISO válido, hace 3 horas -> "Visto hace 3h"', () => {
    expect(formatLastSeen(new Date(NOW.getTime() - 3 * 60 * 60_000).toISOString(), NOW)).toBe('Visto hace 3h');
  });

  it('string ISO válido, hace 2 días -> fecha formateada, no relativa', () => {
    const result = formatLastSeen(new Date(NOW.getTime() - 2 * 24 * 60 * 60_000).toISOString(), NOW);
    expect(result.startsWith('Visto el ')).toBe(true);
  });

  it('Firestore Timestamp-like (con toDate()) -> se parsea igual que un Date', () => {
    const fakeTimestamp = { toDate: () => new Date(NOW.getTime() - 5 * 60_000) };
    expect(formatLastSeen(fakeTimestamp, NOW)).toBe('Visto hace 5 min');
  });

  it('reloj del cliente ligeramente adelantado (diff negativo) -> "Activo ahora", nunca "hace -1 min"', () => {
    const future = new Date(NOW.getTime() + 5_000).toISOString(); // 5s en el "futuro"
    expect(formatLastSeen(future, NOW)).toBe('Activo ahora');
  });
});
