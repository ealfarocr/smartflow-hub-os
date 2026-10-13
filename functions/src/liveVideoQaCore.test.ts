import { describe, it, expect } from 'vitest';
import { chunkObjectName, finalObjectName, isValidJobId, jobPrefix, planComposeBatches, summarizeMp4 } from './liveVideoQaCore';

function box(type: string, payload: Buffer = Buffer.alloc(0)): Buffer {
  const b = Buffer.alloc(8 + payload.length);
  b.writeUInt32BE(8 + payload.length, 0);
  b.write(type, 4, 'latin1');
  payload.copy(b, 8);
  return b;
}
function mvhd(timescale: number, duration: number): Buffer {
  const p = Buffer.alloc(100);
  p.writeUInt32BE(timescale, 12);
  p.writeUInt32BE(duration, 16);
  return box('mvhd', p);
}
function mehd(duration: number): Buffer {
  const p = Buffer.alloc(8);
  p.writeUInt32BE(duration, 4);
  return box('mehd', p);
}

describe('planComposeBatches (límite de 32 orígenes por compose)', () => {
  it('30 chunks (60 s a 2 s) = un solo compose', () => {
    const steps = planComposeBatches(30);
    expect(steps).toHaveLength(1);
    expect(steps[0].chunkIndexes).toHaveLength(30);
    expect(steps[0].includesAccumulator).toBe(false);
  });
  it('32 exactos = un paso; 33 = dos pasos', () => {
    expect(planComposeBatches(32)).toHaveLength(1);
    const s = planComposeBatches(33);
    expect(s).toHaveLength(2);
    expect(s[1]).toEqual({ chunkIndexes: [32], includesAccumulator: true });
  });
  it('100 chunks: ninguno supera 32 orígenes y se usan todos en orden sin repetir', () => {
    const steps = planComposeBatches(100);
    const used: number[] = [];
    for (const s of steps) {
      expect(s.chunkIndexes.length + (s.includesAccumulator ? 1 : 0)).toBeLessThanOrEqual(32);
      used.push(...s.chunkIndexes);
    }
    expect(used).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });
  it('entradas inválidas => sin pasos', () => {
    expect(planComposeBatches(0)).toEqual([]);
    expect(planComposeBatches(-3)).toEqual([]);
    expect(planComposeBatches(2.5)).toEqual([]);
  });
});

describe('nombres y job ids', () => {
  it('rutas bajo admin_attachments con prefijo del job', () => {
    expect(chunkObjectName('abc12345', 7)).toBe('admin_attachments/lvqa-abc12345-c0007');
    expect(finalObjectName('abc12345', 'mp4')).toBe('admin_attachments/lvqa-abc12345-final.mp4');
    expect(chunkObjectName('abc12345', 7).startsWith(jobPrefix('abc12345'))).toBe(true);
  });
  it('job id: solo minúsculas/dígitos de 8 a 32 (sin barras ni puntos)', () => {
    expect(isValidJobId('abc12345')).toBe(true);
    expect(isValidJobId('../x')).toBe(false);
    expect(isValidJobId('ABC12345')).toBe(false);
    expect(isValidJobId('a/b/c/d/e/f')).toBe(false);
    expect(isValidJobId(undefined)).toBe(false);
  });
});

describe('summarizeMp4', () => {
  it('MP4 clásico (moov antes de mdat, duración declarada)', () => {
    const buf = Buffer.concat([box('ftyp', Buffer.from('isom0000', 'latin1')), box('moov', mvhd(1000, 12000)), box('mdat', Buffer.alloc(32))]);
    const s = summarizeMp4(buf);
    expect(s.container).toBe('mp4');
    expect(s.fragmented).toBe(false);
    expect(s.moovBeforeMdat).toBe(true);
    expect(s.mvhdDurationSec).toBe(12);
  });
  it('MP4 fragmentado de MediaRecorder: moof presentes y duración 0 en mvhd', () => {
    const moov = box('moov', Buffer.concat([mvhd(1000, 0), box('mvex', mehd(0))]));
    const frag = Buffer.concat([box('moof', Buffer.alloc(16)), box('mdat', Buffer.alloc(64))]);
    const buf = Buffer.concat([box('ftyp', Buffer.from('iso50000', 'latin1')), moov, frag, frag, frag]);
    const s = summarizeMp4(buf);
    expect(s.fragmented).toBe(true);
    expect(s.boxCounts.moof).toBe(3);
    expect(s.mvhdDurationSec).toBe(0);
    expect(s.mehdDurationSec).toBe(0);
  });
  it('MP4 fragmentado con mehd declarado', () => {
    const moov = box('moov', Buffer.concat([mvhd(1000, 0), box('mvex', mehd(60000))]));
    const s = summarizeMp4(Buffer.concat([box('ftyp', Buffer.alloc(8)), moov, box('moof'), box('mdat')]));
    expect(s.mehdDurationSec).toBe(60);
  });
  it('WebM se reconoce por su cabecera EBML', () => {
    expect(summarizeMp4(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])).container).toBe('webm');
  });
  it('basura o vacío => unknown, sin lanzar', () => {
    expect(summarizeMp4(Buffer.alloc(0)).container).toBe('unknown');
    expect(summarizeMp4(Buffer.from('esto no es un video')).container).toBe('unknown');
  });
  it('archivo cortado a la mitad de una caja => truncated', () => {
    const full = Buffer.concat([box('ftyp', Buffer.alloc(8)), box('moov', mvhd(1000, 1000)), box('mdat', Buffer.alloc(200))]);
    const cut = full.subarray(0, full.length - 120);
    const s = summarizeMp4(cut);
    expect(s.container).toBe('mp4');
    expect(s.mvhdDurationSec).toBe(1);
  });
});
