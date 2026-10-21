import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safeFileName, mimeFor, fitWithin, extensionOf, TARGET_MAX_SIDE } from './mediaPrep';

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

describe('Reducción de fotos de cámara (TARGET_MAX_SIDE = 1600, JPEG_QUALITY = 0.82)', () => {
  it('lleva el lado mayor a 1600 conservando la proporción', () => {
    expect(fitWithin(4000, 3000, TARGET_MAX_SIDE)).toEqual({ w: 1600, h: 1200 });
    expect(fitWithin(3000, 4000, TARGET_MAX_SIDE)).toEqual({ w: 1200, h: 1600 });
  });

  it('2448x3264 (muestra real de producción de 8 MP) se reduce a lado mayor 1600', () => {
    expect(fitWithin(2448, 3264, TARGET_MAX_SIDE)).toEqual({ w: 1200, h: 1600 });
  });

  it('4032x3024 (muestra de 12 MP) se reduce a lado mayor 1600', () => {
    expect(fitWithin(4032, 3024, TARGET_MAX_SIDE)).toEqual({ w: 1600, h: 1200 });
  });

  it('nunca agranda una foto chica', () => {
    expect(fitWithin(800, 600, TARGET_MAX_SIDE)).toEqual({ w: 800, h: 600 });
    expect(fitWithin(1200, 900, TARGET_MAX_SIDE)).toEqual({ w: 1200, h: 900 });
  });
});

describe('prepareImage: optimización fotográfica inteligente', () => {
  let createdCanvas: any = null;
  let toBlobCalls: Array<{ mime: string; quality?: number }> = [];

  beforeEach(() => {
    createdCanvas = null;
    toBlobCalls = [];
    vi.restoreAllMocks();

    vi.stubGlobal('document', {
      createElement: (tagName: string) => {
        if (tagName === 'canvas') {
          createdCanvas = {
            width: 0,
            height: 0,
            getContext: vi.fn().mockReturnValue({
              drawImage: vi.fn(),
            }),
            toBlob: vi.fn().mockImplementation((cb: (b: Blob) => void, mime: string, quality?: number) => {
              toBlobCalls.push({ mime, quality });
              cb(new Blob([new Uint8Array(200 * 1024)], { type: mime }));
            }),
          };
          return createdCanvas;
        }
        return {};
      },
    });
  });

  it('A. 2448x3264 JPEG / 1.46 MB -> resize -> max side 1600, quality 0.82', async () => {
    const origBytes = 1462593;
    const fakeFile = new File([new Uint8Array(origBytes)], 'camera_photo.jpg', { type: 'image/jpeg' });
    const mockBitmap = { width: 2448, height: 3264, close: vi.fn() };
    const createBitmapSpy = vi.fn().mockResolvedValue(mockBitmap);
    vi.stubGlobal('createImageBitmap', createBitmapSpy);

    const { prepareImage } = await import('./mediaPrep');
    const result = await prepareImage(fakeFile);

    expect(createBitmapSpy).toHaveBeenCalledWith(fakeFile, { imageOrientation: 'from-image' });
    expect(result.compressed).toBe(true);
    if (result.compressed) {
      expect(result.originalWidth).toBe(2448);
      expect(result.originalHeight).toBe(3264);
      expect(result.finalWidth).toBe(1200);
      expect(result.finalHeight).toBe(1600);
      expect(result.afterKb).toBe(200);
    }
    expect(createdCanvas.width).toBe(1200);
    expect(createdCanvas.height).toBe(1600);
    expect(toBlobCalls[0]).toEqual({ mime: 'image/jpeg', quality: 0.82 });
  });

  it('B. 4032x3024 JPEG / 4.5 MB -> resize -> max side 1600', async () => {
    const fakeFile = new File([new Uint8Array(4500 * 1024)], 'photo_12mp.jpg', { type: 'image/jpeg' });
    const mockBitmap = { width: 4032, height: 3024, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(mockBitmap));

    const { prepareImage } = await import('./mediaPrep');
    const result = await prepareImage(fakeFile);

    expect(result.compressed).toBe(true);
    if (result.compressed) {
      expect(result.finalWidth).toBe(1600);
      expect(result.finalHeight).toBe(1200);
    }
    expect(createdCanvas.width).toBe(1600);
    expect(createdCanvas.height).toBe(1200);
  });

  it('C. imagen JPEG pequeña <= 1600 y <= 400 KB -> no resize innecesario', async () => {
    const fakeFile = new File([new Uint8Array(250 * 1024)], 'small.jpg', { type: 'image/jpeg' });
    const mockBitmap = { width: 1200, height: 900, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(mockBitmap));

    const { prepareImage } = await import('./mediaPrep');
    const result = await prepareImage(fakeFile);

    expect(result.compressed).toBe(false);
    if (!result.compressed) {
      expect(result.reason).toBe('dimensiones y peso optimos');
    }
    expect(mockBitmap.close).toHaveBeenCalled();
    expect(createdCanvas).toBeNull();
  });

  it('D. PNG con transparencia -> no conversión destructiva a JPEG (mantiene PNG)', async () => {
    const fakeFile = new File([new Uint8Array(2000 * 1024)], 'logo_large.png', { type: 'image/png' });
    const mockBitmap = { width: 2400, height: 1800, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(mockBitmap));

    const { prepareImage } = await import('./mediaPrep');
    const result = await prepareImage(fakeFile);

    expect(result.compressed).toBe(true);
    expect(result.file.type).toBe('image/png');
    expect(result.file.name.endsWith('.png')).toBe(true);
    expect(toBlobCalls[0].mime).toBe('image/png');
    expect(toBlobCalls[0].quality).toBeUndefined();
  });

  it('E. preserva orientación con { imageOrientation: "from-image" }', async () => {
    const fakeFile = new File([new Uint8Array(800 * 1024)], 'portrait.jpg', { type: 'image/jpeg' });
    const createBitmapSpy = vi.fn().mockResolvedValue({ width: 2000, height: 3000, close: vi.fn() });
    vi.stubGlobal('createImageBitmap', createBitmapSpy);

    const { prepareImage } = await import('./mediaPrep');
    await prepareImage(fakeFile);

    expect(createBitmapSpy).toHaveBeenCalledWith(fakeFile, { imageOrientation: 'from-image' });
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
