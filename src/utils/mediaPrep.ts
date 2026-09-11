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

export const COMPRESS_OVER_BYTES = 1.5 * 1024 * 1024;
const MAX_SIDE = 2048;
const JPEG_QUALITY = 0.82;

export type ImagePrepResult =
  | { file: File; compressed: true; beforeKb: number; afterKb: number }
  | { file: File; compressed: false; reason: string };

/**
 * Reduce una foto pesada a JPEG. Si no hace falta (ya es liviana, o no es
 * JPEG/PNG/WebP) o el navegador no puede decodificarla (HEIC en Chrome), se
 * devuelve el original y se dice por qué — nunca se pierde el archivo.
 */
export async function prepareImage(file: File): Promise<ImagePrepResult> {
  const mime = mimeFor(file);
  if (file.size <= COMPRESS_OVER_BYTES) return { file, compressed: false, reason: 'liviana' };
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) return { file, compressed: false, reason: `formato ${mime}` };
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { w, h } = fitWithin(bitmap.width, bitmap.height, MAX_SIDE);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('sin canvas 2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('toBlob vacío');
    if (blob.size >= file.size) return { file, compressed: false, reason: 'no achica' };
    const name = file.name.replace(/\.[^.]*$/, '') + '.jpg';
    return {
      file: new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified }),
      compressed: true,
      beforeKb: Math.round(file.size / 1024),
      afterKb: Math.round(blob.size / 1024),
    };
  } catch (e) {
    return { file, compressed: false, reason: `no se pudo decodificar (${(e as Error)?.message?.slice(0, 40) || 'error'})` };
  }
}
