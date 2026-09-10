import { describe, it, expect } from 'vitest';
import { primaryActionMeta, accessStateLabel, hasResolvedAccess } from './accessActions';

describe('La acción principal se muestra en lenguaje de negocio', () => {
  it('todas las claves del backend tienen una etiqueta clara', () => {
    const keys = ['generate', 'copy', 'reactivate', 'reactivate-and-generate', 'review'] as const;
    keys.forEach((k) => {
      const meta = primaryActionMeta(k);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.hint.length).toBeGreaterThan(0);
    });
  });

  it('el estado muerto reportado ahora ofrece "Generar acceso"', () => {
    expect(primaryActionMeta('generate').label).toBe('Generar acceso');
  });

  it('al suspendido sin acceso se le ofrece reactivar Y generar en un solo paso', () => {
    expect(primaryActionMeta('reactivate-and-generate').label).toBe('Reactivar y generar acceso');
  });

  it('una clave desconocida del backend no rompe la UI: cae en "Revisar ficha"', () => {
    // @ts-expect-error — a propósito: simula un backend más nuevo que la UI
    expect(primaryActionMeta('algo-que-no-existe-todavia').label).toBe('Revisar ficha');
  });
});

describe('Los estados se nombran sin jerga técnica', () => {
  const cases: [string, string][] = [
    ['no-access', 'Sin acceso'],
    ['pending-first-login', 'Acceso listo, sin usar'],
    ['active-with-access', 'Acceso activo'],
    ['active-without-access', 'Activo, sin acceso'],
    ['suspended', 'Desactivado'],
  ];

  cases.forEach(([state, label]) => {
    it(`${state} -> "${label}"`, () => {
      expect(accessStateLabel(state)).toBe(label);
    });
  });

  it('ninguna etiqueta filtra términos internos (membership, PIN hash, credential, prepared, draft)', () => {
    const all = [...cases.map(([s]) => accessStateLabel(s)), accessStateLabel(undefined)];
    all.forEach((label) => {
      expect(label.toLowerCase()).not.toMatch(/membership|credential|hash|prepared|draft|pending/);
    });
  });

  it('un estado desconocido se muestra como "Por revisar", nunca vacío', () => {
    expect(accessStateLabel(undefined)).toBe('Por revisar');
    expect(accessStateLabel('lo-que-sea')).toBe('Por revisar');
  });
});

describe('Mientras el estado real no llegó, la fila no ofrece acciones de acceso', () => {
  it('undefined no cuenta como resuelto', () => {
    expect(hasResolvedAccess(undefined)).toBe(false);
  });

  it('una entrada del backend sí cuenta como resuelta', () => {
    expect(hasResolvedAccess({
      state: 'active-with-access',
      primaryAction: 'copy',
      canRegenerate: true,
      hasPinAccess: true,
      loginHandle: 'eduardopruebas',
    })).toBe(true);
  });
});
