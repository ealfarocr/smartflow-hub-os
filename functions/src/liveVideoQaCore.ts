// Lógica pura del prototipo QA "Live Video" (sin Firebase): plan de compose y
// resumen de la estructura de un MP4. Se prueba sin red ni Storage.

export const COMPOSE_MAX_SOURCES = 32;

export interface ComposeStep {
  /** Índices de chunks que entran en este compose, en orden. */
  chunkIndexes: number[];
  /** true = el primer origen es el objeto acumulado de los pasos anteriores. */
  includesAccumulator: boolean;
}

/**
 * Cloud Storage permite hasta 32 orígenes por compose. Hasta 32 chunks es un
 * solo paso; más de 32 se encadena: cada paso agrega el acumulado + hasta 31
 * chunks nuevos.
 */
export function planComposeBatches(chunkCount: number, max: number = COMPOSE_MAX_SOURCES): ComposeStep[] {
  if (!Number.isInteger(chunkCount) || chunkCount < 1) return [];
  const steps: ComposeStep[] = [];
  let next = 0;
  const first = Math.min(chunkCount, max);
  steps.push({ chunkIndexes: range(0, first), includesAccumulator: false });
  next = first;
  while (next < chunkCount) {
    const take = Math.min(chunkCount - next, max - 1);
    steps.push({ chunkIndexes: range(next, next + take), includesAccumulator: true });
    next += take;
  }
  return steps;
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i);

export const chunkObjectName = (jobId: string, index: number): string =>
  `admin_attachments/lvqa-${jobId}-c${String(index).padStart(4, '0')}`;
export const finalObjectName = (jobId: string, ext: string): string => `admin_attachments/lvqa-${jobId}-final.${ext}`;
export const jobPrefix = (jobId: string): string => `admin_attachments/lvqa-${jobId}-`;
export const isValidJobId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9]{8,32}$/.test(id);

export interface Mp4Summary {
  container: 'mp4' | 'webm' | 'unknown';
  /** Cantidad de cajas de primer nivel por tipo (ftyp, moov, moof, mdat…). */
  boxCounts: Record<string, number>;
  firstBoxes: string[];
  /** moof presente = MP4 fragmentado (así lo escribe MediaRecorder). */
  fragmented: boolean;
  moovBeforeMdat: boolean | null;
  /** Duración declarada en mvhd (0 o null = el contenedor no la declara). */
  mvhdDurationSec: number | null;
  /** Duración declarada en mehd (solo MP4 fragmentado). */
  mehdDurationSec: number | null;
  truncated: boolean;
}

interface Box { type: string; start: number; headerSize: number; end: number }

function readBox(buf: Buffer, offset: number, limit: number): Box | null {
  if (offset + 8 > limit) return null;
  let size = buf.readUInt32BE(offset);
  const type = buf.toString('latin1', offset + 4, offset + 8);
  let headerSize = 8;
  if (size === 1) {
    if (offset + 16 > limit) return null;
    size = Number(buf.readBigUInt64BE(offset + 8));
    headerSize = 16;
  } else if (size === 0) {
    size = limit - offset;
  }
  if (size < headerSize) return null;
  return { type, start: offset, headerSize, end: Math.min(offset + size, limit) };
}

function children(buf: Buffer, box: Box): Box[] {
  const out: Box[] = [];
  let off = box.start + box.headerSize;
  while (off < box.end) {
    const b = readBox(buf, off, box.end);
    if (!b) break;
    out.push(b);
    off = b.end;
  }
  return out;
}

export function summarizeMp4(buf: Buffer): Mp4Summary {
  const empty: Mp4Summary = {
    container: 'unknown', boxCounts: {}, firstBoxes: [], fragmented: false, moovBeforeMdat: null,
    mvhdDurationSec: null, mehdDurationSec: null, truncated: false,
  };
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return { ...empty, container: 'webm' };

  const top: Box[] = [];
  let off = 0;
  let truncated = false;
  while (off < buf.length) {
    const b = readBox(buf, off, buf.length);
    if (!b) { truncated = true; break; }
    top.push(b);
    if (b.end <= off) break;
    off = b.end;
  }
  if (!top.length || !top.some(b => b.type === 'ftyp' || b.type === 'moov' || b.type === 'moof')) return empty;

  const boxCounts: Record<string, number> = {};
  for (const b of top) boxCounts[b.type] = (boxCounts[b.type] || 0) + 1;

  const moov = top.find(b => b.type === 'moov');
  const firstMdat = top.findIndex(b => b.type === 'mdat');
  const moovIdx = top.findIndex(b => b.type === 'moov');

  let mvhdDurationSec: number | null = null;
  let mehdDurationSec: number | null = null;
  let timescale = 0;
  if (moov) {
    const kids = children(buf, moov);
    const mvhd = kids.find(k => k.type === 'mvhd');
    if (mvhd) {
      const p = mvhd.start + mvhd.headerSize;
      const version = buf[p];
      if (version === 1) {
        timescale = buf.readUInt32BE(p + 20);
        const dur = Number(buf.readBigUInt64BE(p + 24));
        mvhdDurationSec = timescale ? dur / timescale : null;
      } else {
        timescale = buf.readUInt32BE(p + 12);
        const dur = buf.readUInt32BE(p + 16);
        mvhdDurationSec = timescale ? dur / timescale : null;
      }
    }
    const mvex = kids.find(k => k.type === 'mvex');
    const mehd = mvex ? children(buf, mvex).find(k => k.type === 'mehd') : undefined;
    if (mehd && timescale) {
      const p = mehd.start + mehd.headerSize;
      const version = buf[p];
      const dur = version === 1 ? Number(buf.readBigUInt64BE(p + 4)) : buf.readUInt32BE(p + 4);
      mehdDurationSec = dur / timescale;
    }
  }

  return {
    container: 'mp4',
    boxCounts,
    firstBoxes: top.slice(0, 6).map(b => b.type),
    fragmented: (boxCounts.moof || 0) > 0,
    moovBeforeMdat: moovIdx >= 0 && firstMdat >= 0 ? moovIdx < firstMdat : null,
    mvhdDurationSec,
    mehdDurationSec,
    truncated,
  };
}
