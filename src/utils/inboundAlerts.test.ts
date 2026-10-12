import { describe, it, expect, beforeEach } from 'vitest';
import type { Conversation } from '@/types';
import {
  AlertViewer, buildTitleWithUnread, countUnreadForViewer, createInboundDetector,
  inboundSoundPrefKey, isConversationForViewer, readInboundSoundEnabled, shouldPlayForFresh,
  stripUnreadPrefix, writeInboundSoundEnabled,
} from './inboundAlerts';
import { __resetInboundSoundForTests, playInboundBeep } from './inboundSound';

const T0 = Date.parse('2026-10-12T10:00:00Z');
const iso = (offsetSec: number) => new Date(T0 + offsetSec * 1000).toISOString();

function conv(id: string, over: Partial<Conversation> = {}): Conversation {
  return {
    id, tenantId: 't-1', advisorId: '', unreadCount: 0, lastInboundDate: iso(0),
    lastMessageDate: iso(0), lastMessageSender: 'lead', ...over,
  } as Conversation;
}

const owner: AlertViewer = { role: 'Owner', identifiers: ['uOwner'], includedUserIds: [] };
const asesorA: AlertViewer = { role: 'Asesor Comercial', identifiers: ['uA'], includedUserIds: ['uA', 'uB'] };
const asesorOut: AlertViewer = { role: 'Asesor Comercial', identifiers: ['uZ'], includedUserIds: ['uA', 'uB'] };

describe('createInboundDetector', () => {
  it('1. el primer snapshot NO suena (fija la base)', () => {
    const d = createInboundDetector('t-1');
    expect(d.ingest([conv('c1'), conv('c2', { unreadCount: 5 })])).toEqual([]);
  });

  it('2-3. cada inbound nuevo se detecta exactamente una vez', () => {
    const d = createInboundDetector('t-1');
    d.ingest([conv('c1')]);
    const second = [conv('c1', { lastInboundDate: iso(10), unreadCount: 1 })];
    expect(d.ingest(second).map((c) => c.id)).toEqual(['c1']);
    // el mismo snapshot otra vez (p. ej. un cambio de otro campo): no repite
    expect(d.ingest(second)).toEqual([]);
    expect(d.ingest([conv('c1', { lastInboundDate: iso(20), unreadCount: 2 })]).map((c) => c.id)).toEqual(['c1']);
  });

  it('4. un outbound (lastInboundDate no cambia) NO suena', () => {
    const d = createInboundDetector('t-1');
    d.ingest([conv('c1')]);
    expect(d.ingest([conv('c1', { lastMessageDate: iso(30), lastMessageSender: 'advisor' })])).toEqual([]);
  });

  it('5. reset de unreadCount NO suena', () => {
    const d = createInboundDetector('t-1');
    d.ingest([conv('c1', { unreadCount: 3 })]);
    expect(d.ingest([conv('c1', { unreadCount: 0 })])).toEqual([]);
  });

  it('una conversación nueva con inbound posterior a la base suena; una vieja que reaparece no', () => {
    const d = createInboundDetector('t-1');
    d.ingest([conv('c1', { lastInboundDate: iso(100) })]);
    expect(d.ingest([conv('c1', { lastInboundDate: iso(100) }), conv('viejo', { lastInboundDate: iso(5) })])).toEqual([]);
    expect(d.ingest([conv('c1', { lastInboundDate: iso(100) }), conv('viejo', { lastInboundDate: iso(5) }), conv('nuevo', { lastInboundDate: iso(150) })]).map((c) => c.id)).toEqual(['nuevo']);
  });

  it('6. recargar = detector nuevo: no hay ráfaga con el historial', () => {
    const history = Array.from({ length: 30 }, (_, i) => conv(`c${i}`, { unreadCount: 2, lastInboundDate: iso(i) }));
    expect(createInboundDetector('t-1').ingest(history)).toEqual([]);
  });

  it('7-8. otro tenant: base propia y nunca mezcla conversaciones ajenas', () => {
    const usaditos = createInboundDetector('t-1');
    const cr = createInboundDetector('t-2');
    const crHistory = [conv('x1', { tenantId: 't-2', lastInboundDate: iso(500) })];
    expect(cr.ingest(crHistory)).toEqual([]); // historial del tenant nuevo: silencio
    usaditos.ingest([conv('c1')]);
    // un doc de t-2 colado en la lista de t-1 se descarta
    expect(usaditos.ingest([conv('c1'), conv('x2', { tenantId: 't-2', lastInboundDate: iso(900) })])).toEqual([]);
    // y un inbound de t-1 no dispara el detector de t-2
    expect(cr.ingest([...crHistory, conv('c1', { lastInboundDate: iso(999) })])).toEqual([]);
  });
});

describe('isConversationForViewer / shouldPlayForFresh', () => {
  it('9. Owner/Admin: cualquier conversación del tenant', () => {
    expect(isConversationForViewer(conv('a', { advisorId: 'uA' }), owner)).toBe(true);
    expect(isConversationForViewer(conv('a', { advisorId: '' }), owner)).toBe(true);
    expect(isConversationForViewer(conv('a'), { ...owner, role: 'Admin' })).toBe(true);
  });

  it('10. Asesor: la suya y las sin asignar que puede reclamar; no las de otro', () => {
    expect(isConversationForViewer(conv('a', { advisorId: 'uA' }), asesorA)).toBe(true);
    expect(isConversationForViewer(conv('a', { advisorId: 'uB' }), asesorA)).toBe(false);
    expect(isConversationForViewer(conv('a', { advisorId: '' }), asesorA)).toBe(true);
    // fuera del equipo Multi-Agente no puede reclamar → no se le avisa de las libres
    expect(isConversationForViewer(conv('a', { advisorId: '' }), asesorOut)).toBe(false);
    expect(isConversationForViewer(conv('a', { advisorId: 'uA' }), asesorOut)).toBe(false);
  });

  const base = { viewer: asesorA, openConversationId: null, onConversationsRoute: false, tabVisible: true };

  it('solo suena si alguna conversación nueva le corresponde', () => {
    expect(shouldPlayForFresh([conv('a', { advisorId: 'uB' })], base)).toBe(false);
    expect(shouldPlayForFresh([conv('a', { advisorId: 'uB' }), conv('b', { advisorId: 'uA' })], base)).toBe(true);
  });

  it('15. conversación abierta + pestaña visible + en /conversaciones: silencio; en segundo plano: suena', () => {
    const c = conv('a', { advisorId: 'uA' });
    const open = { ...base, openConversationId: 'a', onConversationsRoute: true };
    expect(shouldPlayForFresh([c], open)).toBe(false);
    expect(shouldPlayForFresh([c], { ...open, tabVisible: false })).toBe(true);
    expect(shouldPlayForFresh([c], { ...open, onConversationsRoute: false })).toBe(true);
    expect(shouldPlayForFresh([c], { ...open, openConversationId: 'otra' })).toBe(true);
  });
});

describe('título de la pestaña', () => {
  it('16. cuenta solo lo autorizado, incrementa y vuelve a normal', () => {
    const list = [conv('a', { advisorId: 'uA', unreadCount: 2 }), conv('b', { advisorId: 'uB', unreadCount: 7 }), conv('c', { advisorId: '', unreadCount: 1 })];
    expect(countUnreadForViewer(list, asesorA)).toBe(3);
    expect(countUnreadForViewer(list, owner)).toBe(10);
    expect(buildTitleWithUnread('SmartFlow Hub OS', 3)).toBe('(3) SmartFlow Hub OS');
    expect(buildTitleWithUnread('(3) SmartFlow Hub OS', 4)).toBe('(4) SmartFlow Hub OS');
    expect(buildTitleWithUnread('(4) SmartFlow Hub OS', 0)).toBe('SmartFlow Hub OS');
    expect(buildTitleWithUnread('SmartFlow Hub OS', 250)).toBe('(99+) SmartFlow Hub OS');
    expect(stripUnreadPrefix('(12) Otro título')).toBe('Otro título');
  });
});

describe('preferencia "Sonido de mensajes"', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it('por defecto ACTIVADO; se apaga y se enciende', () => {
    const s = mem();
    expect(readInboundSoundEnabled('u1', s)).toBe(true);
    writeInboundSoundEnabled('u1', false, s);
    expect(readInboundSoundEnabled('u1', s)).toBe(false);
    writeInboundSoundEnabled('u1', true, s);
    expect(readInboundSoundEnabled('u1', s)).toBe(true);
  });

  it('no se mezcla entre usuarios del mismo equipo', () => {
    const s = mem();
    writeInboundSoundEnabled('u1', false, s);
    expect(readInboundSoundEnabled('u2', s)).toBe(true);
    expect(inboundSoundPrefKey('u1')).not.toBe(inboundSoundPrefKey('u2'));
  });

  it('sin storage disponible: activado y sin lanzar', () => {
    expect(readInboundSoundEnabled('u1', null)).toBe(true);
    expect(() => writeInboundSoundEnabled('u1', false, null)).not.toThrow();
  });
});

describe('playInboundBeep', () => {
  function fakeCtx(state: 'running' | 'suspended') {
    const started: number[] = [];
    const ctx = {
      state, currentTime: 0, destination: {}, resumed: 0,
      resume() { this.resumed++; return Promise.reject(new Error('sin gesto')); },
      createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }),
      createOscillator: () => ({ type: '', frequency: { setValueAtTime() {} }, connect() {}, start: () => started.push(1), stop() {} }),
    };
    return { ctx, started };
  }

  beforeEach(() => __resetInboundSoundForTests());

  it('12. con el contexto activo suena (2 parciales, una sola vez)', () => {
    const { ctx, started } = fakeCtx('running');
    expect(playInboundBeep({ audioContextFactory: () => ctx as unknown as AudioContext, now: () => 10_000 })).toBe(true);
    expect(started.length).toBe(2);
  });

  it('autoplay: contexto suspendido → no programa nada, intenta resume y no lanza', () => {
    const { ctx, started } = fakeCtx('suspended');
    expect(playInboundBeep({ audioContextFactory: () => ctx as unknown as AudioContext, now: () => 10_000 })).toBe(false);
    expect(started.length).toBe(0);
    expect(ctx.resumed).toBe(1);
  });

  it('nunca dos avisos pegados', () => {
    const { ctx, started } = fakeCtx('running');
    const f = () => ctx as unknown as AudioContext;
    expect(playInboundBeep({ audioContextFactory: f, now: () => 10_000 })).toBe(true);
    expect(playInboundBeep({ audioContextFactory: f, now: () => 10_300 })).toBe(false);
    expect(playInboundBeep({ audioContextFactory: f, now: () => 11_000 })).toBe(true);
    expect(started.length).toBe(4);
  });

  it('sin AudioContext disponible: false, sin error', () => {
    expect(playInboundBeep({ audioContextFactory: () => null, now: () => 10_000 })).toBe(false);
  });
});
