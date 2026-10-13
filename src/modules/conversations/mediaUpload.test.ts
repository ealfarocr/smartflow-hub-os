import { describe, it, expect } from 'vitest';
import {
  MEDIA_SIZE_LIMITS, buildChatAttachmentPath, classifyFile, describeUploadFailure, fileKeyOf, isMediaBusy,
  oversizeNotice, pendingMediaReducer, progressPercent, readyToSend, statusLine, validateMediaFile,
  type PendingMediaAction, type PendingMediaItem,
} from './mediaUpload';

const view = Object.values(
  import.meta.glob('/src/modules/conversations/ConversationsPageView.tsx', { query: '?raw', import: 'default', eager: true }),
)[0] as string;
const tapTarget = Object.values(
  import.meta.glob('/src/modules/conversations/FileTapTarget.tsx', { query: '?raw', import: 'default', eager: true }),
)[0] as string;

const MB = 1024 * 1024;
const file = (name: string, type: string, size: number) => ({ name, type, size });

const item = (over: Partial<PendingMediaItem> = {}): PendingMediaItem => ({
  id: 'a', localPreviewUrl: 'blob:x', filename: 'f.jpg', kind: 'image', status: 'uploading', remoteUrl: null, progress: 0, ...over,
});
const run = (start: PendingMediaItem[], ...actions: PendingMediaAction[]) => actions.reduce(pendingMediaReducer, start);

describe('validación previa a la subida', () => {
  it('1. foto pequeña (200 KB) entra', () => {
    expect(validateMediaFile(file('a.jpg', 'image/jpeg', 200 * 1024))).toEqual({ ok: true, kind: 'image' });
  });
  it('2. foto grande válida (3 MB y hasta 12 MB) entra: se mide después de comprimir', () => {
    expect(validateMediaFile(file('a.jpg', 'image/jpeg', 3 * MB)).ok).toBe(true);
    expect(validateMediaFile(file('a.jpg', 'image/jpeg', 12 * MB)).ok).toBe(true);
  });
  it('3. video menor de 16 MB entra', () => {
    expect(validateMediaFile(file('v.mp4', 'video/mp4', 9 * MB))).toEqual({ ok: true, kind: 'video' });
    expect(validateMediaFile(file('v.mp4', 'video/mp4', 16 * MB)).ok).toBe(true); // el límite exacto sigue siendo válido
  });
  it('4. video mayor de 16 MB se rechaza con el texto acordado', () => {
    const r = validateMediaFile(file('v.mp4', 'video/mp4', 22.4 * MB));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('video');
      expect(r.notice.detail).toBe('Este video pesa 22.4 MB. WhatsApp permite máximo 16 MB. Grabe un video más corto o reduzca la calidad.');
    }
    expect(validateMediaFile(file('v.mp4', 'video/mp4', 16 * MB + 1)).ok).toBe(false);
  });
  it('video sin MIME pero con extensión se clasifica como video y respeta el límite', () => {
    expect(classifyFile(file('1000012.mp4', '', 1))).toBe('video');
    expect(validateMediaFile(file('1000012.mp4', '', 20 * MB)).ok).toBe(false);
  });
  it('9. MIME desconocido entra como documento (límite 100 MB)', () => {
    expect(validateMediaFile(file('x.bin', 'application/octet-stream', 30 * MB))).toEqual({ ok: true, kind: 'document' });
    expect(validateMediaFile(file('x.bin', 'application/octet-stream', 101 * MB)).ok).toBe(false);
  });
  it('los límites de WhatsApp no cambiaron', () => {
    expect(MEDIA_SIZE_LIMITS).toEqual({ image: 5 * MB, video: 16 * MB, audio: 16 * MB, document: 100 * MB });
  });
  it('aviso por tipo: dice tamaño, límite y qué hacer', () => {
    expect(oversizeNotice('audio', 20 * MB).detail).toContain('pesa 20.0 MB');
    expect(oversizeNotice('image', 6 * MB).detail).toContain('máximo 5 MB');
  });
});

describe('progreso de subida', () => {
  it('5. progressPercent va de 0 a 100 y se acota', () => {
    expect(progressPercent(0, 1000)).toBe(0);
    expect(progressPercent(370, 1000)).toBe(37);
    expect(progressPercent(1000, 1000)).toBe(100);
    expect(progressPercent(2000, 1000)).toBe(100);
    expect(progressPercent(5, 0)).toBe(0);
  });
  it('5. el item sube 0 → 37 → 100 y no retrocede', () => {
    let items = [item()];
    expect(statusLine(items)?.text).toBe('Subiendo… 0%');
    items = run(items, { type: 'progress', id: 'a', pct: 37 });
    expect(items[0].progress).toBe(37);
    expect(statusLine(items)?.text).toBe('Subiendo… 37%');
    items = run(items, { type: 'progress', id: 'a', pct: 20 });
    expect(items[0].progress).toBe(37);
    items = run(items, { type: 'progress', id: 'a', pct: 100 });
    expect(statusLine(items)?.text).toBe('Subiendo… 100%');
  });
  it('el progreso se ignora si el item ya no está subiendo', () => {
    const items = run([item({ status: 'ready', progress: 100, remoteUrl: 'u' })], { type: 'progress', id: 'a', pct: 10 });
    expect(items[0].progress).toBe(100);
  });
});

describe('estados del adjunto y regresión del flujo que ya funcionaba', () => {
  it('foto: uploading → ready → sending → sent → clear', () => {
    let items = run([], { type: 'add', item: item() });
    expect(isMediaBusy(items)).toBe(true);
    items = run(items, { type: 'ready', id: 'a', url: 'https://x/a.jpg', filename: 'a.jpg' });
    expect(items[0]).toMatchObject({ status: 'ready', progress: 100, remoteUrl: 'https://x/a.jpg' });
    expect(isMediaBusy(items)).toBe(false);
    expect(readyToSend(items)).toHaveLength(1);
    items = run(items, { type: 'sending', ids: ['a'] });
    expect(items[0].status).toBe('sending');
    expect(isMediaBusy(items)).toBe(true);
    items = run(items, { type: 'sent', id: 'a' });
    expect(items[0].status).toBe('sent');
    expect(run(items, { type: 'clear' })).toEqual([]);
  });
  it('video menor de 16 MB: mismo recorrido', () => {
    const v = item({ id: 'v', kind: 'video', filename: 'v.mp4' });
    const items = run([v], { type: 'ready', id: 'v', url: 'https://x/v.mp4', filename: 'v.mp4' }, { type: 'sending', ids: ['v'] }, { type: 'sent', id: 'v' });
    expect(items[0].status).toBe('sent');
  });
  it('6. upload fallido: queda en error con motivo y la línea de estado lo muestra', () => {
    const items = run([item()], { type: 'fail', id: 'a', message: describeUploadFailure({ code: 'storage/retry-limit-exceeded' }) });
    expect(items[0].status).toBe('error');
    expect(items[0].errorMessage).toContain('Se cortó la subida');
    expect(statusLine(items)).toEqual({ text: expect.stringContaining('Foto: Se cortó la subida'), tone: 'error' });
    expect(isMediaBusy(items)).toBe(false);
  });
  it('si el envío falla a medio camino: lo no enviado vuelve a ready y lo enviado NO se reenvía', () => {
    let items = [
      item({ id: 'a', status: 'ready', remoteUrl: 'ua', progress: 100 }),
      item({ id: 'b', status: 'ready', remoteUrl: 'ub', progress: 100 }),
    ];
    items = run(items, { type: 'sending', ids: ['a', 'b'] }, { type: 'sent', id: 'a' }, { type: 'unlock-sending' });
    expect(items.map(m => m.status)).toEqual(['sent', 'ready']);
    expect(readyToSend(items).map(m => m.id)).toEqual(['b']);
  });
});

describe('7. doble toque / doble envío', () => {
  it('un segundo "sending" no cambia nada: el item ya no está listo', () => {
    const once = run([item({ status: 'ready', remoteUrl: 'u' })], { type: 'sending', ids: ['a'] });
    expect(readyToSend(once)).toHaveLength(0);
    expect(run(once, { type: 'sending', ids: ['a'] })).toEqual(once);
  });
  it('el mismo archivo agregado dos veces mientras sube se ignora', () => {
    const key = fileKeyOf({ name: 'IMG_1.jpg', size: 1234, lastModified: 99 });
    let items = run([], { type: 'add', item: item({ id: 'a', fileKey: key }) });
    items = run(items, { type: 'add', item: item({ id: 'b', fileKey: key }) });
    expect(items).toHaveLength(1);
  });
  it('el mismo archivo se puede volver a agregar cuando el anterior ya terminó', () => {
    const key = fileKeyOf({ name: 'IMG_1.jpg', size: 1234, lastModified: 99 });
    let items = run([], { type: 'add', item: item({ id: 'a', fileKey: key }) }, { type: 'ready', id: 'a', url: 'u', filename: 'a.jpg' });
    items = run(items, { type: 'add', item: item({ id: 'b', fileKey: key }) });
    expect(items).toHaveLength(2);
  });
  it('la vista tiene candado síncrono y bloquea el botón mientras sube o envía', () => {
    expect(view).toContain('sendLockRef.current) return');
    expect(view).toContain('sendLockRef.current = true');
    expect(view).toContain('sendLockRef.current = false');
    expect(view).toContain('|| isMediaBusy(pendingMedia)}');
  });
});

describe('mensajes de error específicos', () => {
  it('cada causa conocida tiene su texto, ninguno es "unknown error"', () => {
    const cases: [string, string][] = [
      ['storage/retry-limit-exceeded', 'Se cortó la subida'],
      ['storage/canceled', 'Se cortó la subida'],
      ['storage/unauthorized', 'No tenés permiso'],
      ['storage/quota-exceeded', 'almacenamiento'],
      ['auth/no-current-user', 'sesión'],
      ['storage/object-not-found', 'storage/object-not-found'],
    ];
    for (const [code, text] of cases) expect(describeUploadFailure({ code }).toLowerCase()).toContain(text.toLowerCase());
  });
  it('código desconocido: se muestra el código, no un genérico opaco', () => {
    expect(describeUploadFailure({ code: 'storage/unknown' })).toContain('storage/unknown');
    expect(describeUploadFailure(new Error('boom'))).toContain('sin código');
    expect(describeUploadFailure({ code: 'storage/unknown' }).toLowerCase()).not.toContain('unknown error');
  });
});

describe('8. picker cancelado', () => {
  it('sin archivos no se llama onFiles ni se muestra error', () => {
    expect(tapTarget).toContain('if (files?.length) await onFiles(files)');
  });
});

describe('10. aislamiento por tenant', () => {
  it('la ruta de Storage usa solo el tenant activo', () => {
    expect(buildChatAttachmentPath('t-1791700036682', 'a.jpg', 1000)).toBe('chat-attachments/t-1791700036682/1000-a.jpg');
    expect(buildChatAttachmentPath('t-1791700036682', 'a.jpg', 1000)).not.toContain('t-1788554584458');
  });
  it('la vista construye la ruta con activeMembership.tenantId y sin rutas escritas a mano', () => {
    expect(view).toContain('buildChatAttachmentPath(activeMembership!.tenantId, safeName)');
    expect(view).not.toMatch(/`chat-attachments\//);
  });
});

describe('aviso persistente del rechazo', () => {
  it('la vista lo muestra con role=alert y botón para cerrarlo', () => {
    expect(view).toContain('role="alert"');
    expect(view).toContain('aria-label="Cerrar aviso"');
    expect(view).toContain('setMediaNotices');
  });
});
