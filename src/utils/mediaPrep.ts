// Preparación de un archivo del teléfono antes de subirlo a Storage.
//
// 1. Nombre seguro: los nombres que devuelve Android pueden traer espacios,
//    acentos, "#", "?" o venir sin extensión ("1000012345"). Se normalizan a
//    [A-Za-z0-9._-] con extensión, para la ruta de Storage y para la URL que
//    después tiene que descargar Meta.
// 2. Tipo MIME de respaldo: algunos selectores entregan file.type vacío.
// 3. Compresión de fotos: una foto de cámara de un teléfono actual pesa 3-8 MB y
//    WhatsApp acepta 5 MB para imágenes — sin esto, "Tomar foto" terminaba en
//    "El archivo pesa 6,2 MB". Se reduce el lado mayor a 2048 px en JPEG 0,82
//    (queda en 300 KB - 1 MB), que es de sobra para mostrar un producto por chat.

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/3gpp': '3gp', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav',
};
const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime]),
);
MIME_BY_EXT.jpeg = 'image/jpeg';

export function extensionOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]{1,5})$/);
  return m ? m[1] : '';
}

/** MIME a usar: el del archivo si viene, si no el de su extensión. */
export function mimeFor(file: { name: string; type: string }): string {
  if (file.type) return file.type;
  return MIME_BY_EXT[extensionOf(file.name)] || 'application/octet-stream';
}

/**
 * Nombre apto para la ruta de Storage y la URL de descarga. Conserva la parte
 * legible, cambia todo lo demás por "_", limita el largo y garantiza extensión
 * (la toma del MIME si el nombre no la trae).
 */
export function safeFileName(name: string, mime: string): string {
  const ext = extensionOf(name) || EXT_BY_MIME[mime] || 'bin';
  const base = name.replace(/\.[^.]*$/, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'archivo';
  return `${base}.${ext}`;
}

/** Tamaño destino conservando proporción, con el lado mayor en `max` como tope. */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

export const TARGET_MAX_SIDE = 1600;
export const JPEG_QUALITY = 0.82;
/**
 * Umbral de peso para fotos: 400 KB (409,600 bytes).
 * Por debajo de 400 KB y con lado mayor <= 1600 px, una foto ya se considera
 * liviana y nítida y no se recomprime para no generar artefactos innecesarios.
 * Si supera 400 KB o supera 1600 px en cualquier lado, se optimiza.
 */
export const PHOTO_MAX_BYTES_WITHOUT_RESIZE = 400 * 1024;
export const COMPRESS_OVER_BYTES = PHOTO_MAX_BYTES_WITHOUT_RESIZE;

export type ImagePrepResult =
  | {
      file: File;
      compressed: true;
      beforeKb: number;
      afterKb: number;
      originalWidth: number;
      originalHeight: number;
      finalWidth: number;
      finalHeight: number;
      processingMs: number;
    }
  | {
      file: File;
      compressed: false;
      reason: string;
      originalWidth?: number;
      originalHeight?: number;
      finalWidth?: number;
      finalHeight?: number;
      processingMs?: number;
    };

/**
 * Optimiza fotos y capturas antes de subir a Storage.
 *
 * Criterios:
 * 1. Para JPEG / WebP fotográficos:
 *    Se procesa si lado mayor > 1600 px OR peso > 400 KB.
 *    Se escala manteniendo proporción a MAX 1600 px en el lado mayor (sin upscale)
 *    y se codifica a JPEG con calidad 0.82.
 *    Si ya viene <= 1600 px y <= 400 KB, no se recomprime innecesariamente.
 * 2. Para PNG:
 *    Se preserva el formato PNG con transparencia (no conversión destructiva a JPEG).
 *    Si el lado mayor > 1600 px, se escala proporcionalmente a 1600 px pero se exporta
 *    como 'image/png' para preservar alfa y nitidez de logos/textos.
 * 3. Otros formatos (GIF, HEIC no decodificable, etc.):
 *    Se devuelven tal cual sin romper el archivo.
 */
export async function prepareImage(file: File): Promise<ImagePrepResult> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const mime = mimeFor(file);

  if (!/^image\/(jpeg|png|webp)$/.test(mime)) {
    return { file, compressed: false, reason: `formato ${mime}` };
  }

  if (typeof createImageBitmap !== 'function') {
    return { file, compressed: false, reason: 'sin createImageBitmap' };
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const origW = bitmap.width;
    const origH = bitmap.height;
    const maxSide = Math.max(origW, origH);
    const isPng = mime === 'image/png';
    const isPhotographic = mime === 'image/jpeg' || mime === 'image/webp';

    const needsResize = maxSide > TARGET_MAX_SIDE;
    const needsCompression = isPhotographic && file.size > PHOTO_MAX_BYTES_WITHOUT_RESIZE;

    // Si ya tiene dimensiones <= 1600 y peso adecuado, no procesar innecesariamente
    if (!needsResize && !needsCompression) {
      bitmap.close?.();
      const elapsed = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
      return {
        file,
        compressed: false,
        reason: 'dimensiones y peso optimos',
        originalWidth: origW,
        originalHeight: origH,
        finalWidth: origW,
        finalHeight: origH,
        processingMs: elapsed,
      };
    }

    const { w, h } = fitWithin(origW, origH, TARGET_MAX_SIDE);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('sin canvas 2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    bitmap = null;

    // PNG se mantiene PNG para preservar transparencia y vectores/logos; fotos van a JPEG 0.82
    const outputMime = isPng ? 'image/png' : 'image/jpeg';
    const outputQuality = isPng ? undefined : JPEG_QUALITY;

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputMime, outputQuality));
    if (!blob) throw new Error('toBlob vacío');

    // Si no hubo resize y el blob resultante no ahorra bytes, conservar original
    if (!needsResize && blob.size >= file.size) {
      const elapsed = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
      return {
        file,
        compressed: false,
        reason: 'no achica',
        originalWidth: origW,
        originalHeight: origH,
        finalWidth: origW,
        finalHeight: origH,
        processingMs: elapsed,
      };
    }

    const ext = isPng ? '.png' : '.jpg';
    const name = file.name.replace(/\.[^.]*$/, '') + ext;
    const processedFile = new File([blob], name, { type: outputMime, lastModified: file.lastModified });
    const elapsed = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);

    return {
      file: processedFile,
      compressed: true,
      beforeKb: Math.round(file.size / 1024),
      afterKb: Math.round(blob.size / 1024),
      originalWidth: origW,
      originalHeight: origH,
      finalWidth: w,
      finalHeight: h,
      processingMs: elapsed,
    };
  } catch (e) {
    bitmap?.close?.();
    const elapsed = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
    return {
      file,
      compressed: false,
      reason: `no se pudo decodificar (${(e as Error)?.message?.slice(0, 40) || 'error'})`,
      processingMs: elapsed,
    };
  }
}
