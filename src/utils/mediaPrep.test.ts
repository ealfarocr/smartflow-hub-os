import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safeFileName, mimeFor, fitWithin, extensionOf } from './mediaPrep';

describe('Nombre seguro para Storage y para la URL que descarga Meta', () => {
  it('espacios, acentos y símbolos quedan como "_"', () => {
    expect(safeFileName('Foto del sofá #2 (final).jpg', 'image/jpeg')).toBe('Foto_del_sofa_2_final.jpg');
  });

  it('sin extensión (Android a veces devuelve "1000012345") la toma del MIME', () => {
    expect(safeFileName('1000012345', 'image/jpeg')).toBe('1000012345.jpg');
    expect(safeFileName('video', 'video/mp4')).toBe('video.mp4');
  });

  it('nombre vacío o solo símbolos → "archivo"', () => {
    expect(safeFileName('###.png', 'image/png')).toBe('archivo.png');
  });

  it('limita el largo', () => {
    expect(safeFileName(`${'a'.repeat(200)}.jpg`, 'image/jpeg').length).toBeLessThanOrEqual(64);
  });
});

describe('Tipo MIME de respaldo cuando el selector no lo trae', () => {
  it('usa el del archivo si viene', () => {
    expect(mimeFor({ name: 'x.bin', type: 'video/mp4' })).toBe('video/mp4');
  });

  it('si viene vacío, lo deduce de la extensión', () => {
    expect(mimeFor({ name: 'IMG_1.JPG', type: '' })).toBe('image/jpeg');
    expect(mimeFor({ name: 'VID_1.mp4', type: '' })).toBe('video/mp4');
    expect(mimeFor({ name: 'nota.ogg', type: '' })).toBe('audio/ogg');
    expect(extensionOf('IMG_1.JPEG')).toBe('jpeg');
  });
});

describe('Reducción de fotos de cámara', () => {
  it('lleva el lado mayor a 2048 conservando la proporción', () => {
    expect(fitWithin(4000, 3000, 2048)).toEqual({ w: 2048, h: 1536 });
    expect(fitWithin(3000, 4000, 2048)).toEqual({ w: 1536, h: 2048 });
  });

  it('nunca agranda una foto chica', () => {
    expect(fitWithin(800, 600, 2048)).toEqual({ w: 800, h: 600 });
  });
});

describe('El registro QA sobrevive a una recarga de la página', () => {
  beforeEach(() => {
    vi.resetModules();
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
  });

  it('los eventos se recuperan al volver a cargar el módulo', async () => {
    const a = await import('./mediaDiag');
    a.recordMediaDiag('PHOTO_TAP');
    vi.resetModules();
    const b = await import('./mediaDiag');
    expect(b.getMediaDiag().map((e) => e.step)).toContain('PHOTO_TAP');
  });

  it('si la página se recargó con la cámara abierta, se registra y se avisa una sola vez', async () => {
    const a = await import('./mediaDiag');
    a.markPickerOpen('PHOTO');
    vi.resetModules();
    const b = await import('./mediaDiag');
    b.captureQaFlagFromUrl();
    expect(b.getMediaDiag()[0].step).toBe('PAGE_RELOADED_WHILE_PICKER_OPEN');
    expect(b.consumePickerReload()?.control).toBe('PHOTO');
    expect(b.consumePickerReload()).toBeNull();
  });

  it('si el archivo volvió, no hay aviso', async () => {
    const a = await import('./mediaDiag');
    a.markPickerOpen('CLIP');
    a.clearPickerOpen();
    vi.resetModules();
    const b = await import('./mediaDiag');
    b.captureQaFlagFromUrl();
    expect(b.consumePickerReload()).toBeNull();
  });
});
