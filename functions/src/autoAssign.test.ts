import { describe, it, expect } from 'vitest';
import { pickNextAdvisor } from './autoAssign';

// Simula el cursor tal como lo avanza assignConversationAdvisor.
const run = (ids: string[], n: number, cursor: string | null = null) => {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const p = pickNextAdvisor(ids, cursor)!;
    out.push(p.selected);
    cursor = p.selected;
  }
  return out;
};

describe('pickNextAdvisor — round-robin por conversación nueva', () => {
  it('4 agentes: 1→2→3→4→1', () => {
    expect(run(['a1', 'a2', 'a3', 'a4'], 5)).toEqual(['a1', 'a2', 'a3', 'a4', 'a1']);
  });

  it('sin cursor arranca por el primero', () => {
    expect(pickNextAdvisor(['a1', 'a2'], null)?.selected).toBe('a1');
    expect(pickNextAdvisor(['a1', 'a2'], undefined)?.selected).toBe('a1');
  });

  it('agente deshabilitado/fuera de turno no recibe: el cursor viejo ya no está en la lista', () => {
    // a2 era el cursor y salió del pool → vuelve a empezar, nunca devuelve a a2.
    expect(pickNextAdvisor(['a1', 'a3', 'a4'], 'a2')?.selected).toBe('a1');
    expect(run(['a1', 'a3', 'a4'], 4, 'a1')).toEqual(['a3', 'a4', 'a1', 'a3']);
  });

  it('un solo agente recibe todas', () => {
    expect(run(['a1'], 3)).toEqual(['a1', 'a1', 'a1']);
  });

  it('lista vacía: null (queda sin asignar, no inventa a nadie)', () => {
    expect(pickNextAdvisor([], 'a1')).toBeNull();
  });
});
