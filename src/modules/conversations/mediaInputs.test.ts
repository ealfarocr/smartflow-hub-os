import { describe, it, expect } from 'vitest';
import { describeEnvironment } from '@/utils/mediaDiag';

// Los selectores de archivo del chat. Historia de por qué están así:
//  1. Los <input type="file"> tenían className="hidden" (display:none): en
//     Chrome para Android, .click() sobre un input así no abre el selector.
//  2. Se pasó a <label htmlFor> + sr-only: en el teléfono real tampoco abrió.
//  3. Ahora el dedo toca DIRECTAMENTE el input: un input transparente cubre toda
//     la superficie del botón (FileTapTarget). No hay label, ni click
//     programático, ni nada entre el toque y el selector.
// Este test es el candado para que nadie vuelva a ninguna de las dos variantes
// anteriores sin darse cuenta.
const view = Object.values(
  import.meta.glob('/src/modules/conversations/ConversationsPageView.tsx', { query: '?raw', import: 'default', eager: true }),
)[0] as string;
const target = Object.values(
  import.meta.glob('/src/modules/conversations/FileTapTarget.tsx', { query: '?raw', import: 'default', eager: true }),
)[0] as string;

describe('El dedo toca directamente el input de archivo', () => {
  it('el chat ya no tiene inputs de archivo sueltos ni ocultos', () => {
    expect(view).not.toContain('type="file"');
    expect(view).not.toContain('htmlFor="sf-');
  });

  it('el input cubre toda la superficie del botón y es transparente, no display:none', () => {
    // El JSX del input (no el comentario, que tambien menciona <input type="file">).
    const inicio = target.indexOf('      <input');
    const input = target.slice(inicio, target.indexOf('/>', inicio));
    expect(input).toContain('type="file"');
    expect(input).toContain('absolute inset-0 w-full h-full opacity-0');
    expect(input).not.toMatch(/\bhidden\b|sr-only|display:\s*none/);
  });

  it('el contenido visible no roba el toque (pointer-events-none)', () => {
    const usos = view.split('<FileTapTarget').slice(1);
    expect(usos.length).toBe(3);
    usos.forEach((u) => expect(u.slice(0, u.indexOf('</FileTapTarget>'))).toContain('pointer-events-none'));
  });

  it('clip = fotos y videos sin capture; foto y video usan la cámara trasera', () => {
    const bloque = (diag: string) => {
      const i = view.indexOf(`diag="${diag}"`);
      return view.slice(i, view.indexOf('>', view.indexOf('onFiles', i)));
    };
    expect(bloque('CLIP')).toContain('accept="image/*,video/*"');
    expect(bloque('CLIP')).not.toContain('capture=');
    expect(bloque('PHOTO')).toContain('accept="image/*"');
    expect(bloque('PHOTO')).toContain('capture="environment"');
    expect(bloque('VIDEO')).toContain('accept="video/*"');
    expect(bloque('VIDEO')).toContain('capture="environment"');
  });

  it('el menú de cámara no se desmonta en el mismo toque que abre la cámara', () => {
    expect(view).toContain("onClickCapture={() => window.addEventListener('focus'");
  });

  // QA local con el orden REAL de Android (focus antes que change): con el menú
  // desmontado por el focus, la foto y el video se perdían sin ningún evento.
  it('el menú de cámara queda SIEMPRE montado y se oculta con CSS', () => {
    expect(view).not.toContain('{showCameraChoice && (');
    expect(view).toContain("${showCameraChoice ? '' : 'hidden'}");
    expect(view).toContain('data-camera-menu=');
  });
});

describe('El panel QA reconoce el navegador del teléfono', () => {
  it('Chrome normal en Android: no embebido', () => {
    const env = describeEnvironment('Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36');
    expect(env.browser).toBe('Chrome');
    expect(env.embedded).toBeNull();
  });

  it('navegador dentro de Facebook: embebido (ahí los selectores de archivo suelen no abrir)', () => {
    const env = describeEnvironment('Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36 [FBAN/EMA;FBAV/400.0]');
    expect(env.embedded).toBe('Facebook');
  });

  it('WebView genérico de Android (marca "; wv)")', () => {
    const env = describeEnvironment('Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0 Mobile Safari/537.36');
    expect(env.embedded).toBe('WebView de Android');
  });

  it('Samsung Internet y Opera se nombran bien', () => {
    expect(describeEnvironment('Mozilla/5.0 (Linux; Android 14) SamsungBrowser/25.0 Chrome/121 Mobile Safari/537.36').browser).toBe('Samsung Internet');
    expect(describeEnvironment('Mozilla/5.0 (Linux; Android 14) Chrome/128 Mobile Safari/537.36 OPR/84.0').browser).toBe('Opera');
  });
});

const panel = Object.values(
  import.meta.glob('/src/modules/conversations/MediaDiagPanel.tsx', { query: '?raw', import: 'default', eager: true }),
)[0] as string;
const layout = Object.values(
  import.meta.glob('/src/components/layout/MainLayout.tsx', { query: '?raw', import: 'default', eager: true }),
)[0] as string;

// Evidencia física: con el panel QA anterior, los toques de la prueba caían
// SOBRE EL PANEL (TOQUE registraba div.fixed / div.text-emerald) y nunca
// llegaban al clip. El diagnóstico se contaminaba a sí mismo.
describe('El panel QA observa, no participa', () => {
  it('el contenedor completo es transparente a los toques', () => {
    const raiz = panel.slice(panel.indexOf('<div className="fixed'), panel.indexOf('>', panel.indexOf('<div className="fixed')));
    expect(raiz).toContain('pointer-events-none');
  });

  it('solo la pastilla y la prueba nativa reciben toques; los toques de la pastilla no se registran', () => {
    expect(panel).toContain('pointer-events-auto');
    expect(panel).toContain('composedPath().includes(pillRef.current)');
  });

  it('va sobre los mensajes: ni barra superior, ni cabecera del chat, ni composer; ocupa poco', () => {
    const raiz = panel.slice(panel.indexOf('<div className="fixed'), panel.indexOf('>', panel.indexOf('<div className="fixed')));
    expect(raiz).toContain('top-[26%]');
    expect(raiz).not.toMatch(/bottom-|top-1\b/);
    expect(panel).toContain('max-h-[18vh]');
  });

  it('detecta cuando otro elemento tapa un control multimedia', () => {
    expect(panel).toContain('_COVERED_BY');
    expect(target).toContain('data-media-control={control}');
    expect(target).toContain('data-media-input={inputKind}');
  });
});

// Evidencia física: en el teléfono solo aparecían TOQUE, nunca CLIP_TAP. El
// control del chat queda con el MISMO patrón que la prueba nativa: el dedo toca
// el input y el navegador lo abre solo. Nada de showPicker/preventDefault/click().
describe('Activación nativa pura del input del chat', () => {
  it('sin showPicker, sin preventDefault y sin click programático', () => {
    // Solo el código: el comentario de la cabecera nombra justamente lo que no se usa.
    const codigo = target.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n');
    expect(codigo).not.toMatch(/showPicker|preventDefault|\.click\(\)/);
  });

  it('el click se escucha con un listener NATIVO (no depende de React)', () => {
    expect(target).toContain("el.addEventListener('click', onClick)");
  });

  it('los controles del chat llevan sus marcas de auditoría', () => {
    ['control="clip"', 'inputKind="gallery"', 'control="photo"', 'inputKind="photo"', 'control="video"', 'inputKind="video"', 'data-media-control="camera"']
      .forEach((m) => expect(view).toContain(m));
  });
});

describe('Prueba media nativa fuera del chat (?qa=1)', () => {
  it('galería, foto y video con input nativo mínimo', () => {
    expect(panel).toContain('label="ABRIR GALERÍA" kind="GALLERY" accept="image/*,video/*"');
    expect(panel).toContain('label="TOMAR FOTO" kind="PHOTO" accept="image/*" capture="environment"');
    expect(panel).toContain('label="GRABAR VIDEO" kind="VIDEO" accept="video/*" capture="environment"');
    const probe = panel.slice(panel.indexOf('const NativeProbe'), panel.indexOf('export const MediaDiagPanel'));
    expect(probe).not.toMatch(/showPicker|preventDefault|\.click\(\)|opacity-0/);
  });

  it('registra TAP y CHANGE de cada prueba, y el clip aislado para comparar', () => {
    expect(panel).toContain('QA_${kind}_TAP');
    expect(panel).toContain('QA_${kind}_CHANGE');
    expect(panel).toContain('diag="QA_CHATCOPY"');
  });

  it('el clip aislado no se llama "copia" (parecía copiar al portapapeles)', () => {
    expect(panel).toContain('PROBAR CLIP AISLADO');
    expect(panel).not.toContain('COPIA DEL CLIP');
  });

  it('botones reales para copiar el diagnóstico y limpiar, con respaldo sin Clipboard API', () => {
    expect(panel).toContain('📋 COPIAR DIAGNÓSTICO');
    expect(panel).toContain('🧹 LIMPIAR');
    expect(panel).toContain('navigator.clipboard.writeText');
    expect(panel).toContain("document.execCommand('copy')");
    expect(panel).toContain('Diagnóstico copiado');
  });

  it('el detector explica por qué no hay controles del chat en vez de "no hay controles"', () => {
    expect(panel).not.toContain("'no hay controles en pantalla'");
    expect(panel).toContain('explainMissingControls');
    expect(view).toContain('chat={{ conversacionAbierta: !!activeChat');
  });

  it('audita el DOM: renderizado, input, deshabilitado, rect, elemento en el punto, pointer-events y z-index', () => {
    ['CONTROL_RENDERED', 'renderizado', 'deshabilitado', 'rect', 'enElPunto', 'peInput', 'z:', 'CLICK', 'POINTERCANCEL']
      .forEach((m) => expect(panel).toContain(m));
  });
});

describe('El banner de onboarding no tapa la barra del vendedor', () => {
  it('solo lo ve quien administra el negocio, y nunca en el chat', () => {
    expect(layout).toContain("(isSuperAdmin || isAdminRole(activeMembership?.role)) && pathname !== '/conversaciones' && <OnboardingBanner />");
  });
});

const toast = Object.values(
  import.meta.glob('/src/components/ui/Toast.tsx', { query: '?raw', import: 'default', eager: true }),
)[0] as string;

// QA local (teléfono Android emulado): el toque del micrófono lo recibía el
// texto de un aviso, y la cabecera del chat quedaba corrida por scrollIntoView.
describe('Nada fijo tapa los controles del chat en el teléfono', () => {
  it('los avisos van arriba en pantallas chicas y dejan pasar los toques', () => {
    const raiz = toast.slice(toast.indexOf('<div data-toasts'), toast.indexOf('>', toast.indexOf('<div data-toasts')));
    expect(raiz).toContain('top-[4.5rem]');
    expect(raiz).toContain('pointer-events-none');
    expect(raiz).not.toMatch(/(^|\s)bottom-4/);
  });

  it('el auto-scroll mueve solo la lista de mensajes, no los ancestros', () => {
    expect(view).not.toContain('.scrollIntoView(');
    expect(view).toContain('messagesScrollRef');
  });

  it('el alto del layout usa la pantalla visible (dvh) con respaldo a vh', () => {
    expect(layout).toContain('supports-[height:100dvh]:h-[100dvh]');
  });
});

describe('Subida desde el teléfono: reanudable, con avance y fotos reducidas', () => {
  it('sube por partes con reintento y reporta el avance', () => {
    expect(view).toContain('uploadBytesResumable');
    expect(view).toContain('_UPLOAD_PROGRESS');
    expect(view).not.toMatch(/\buploadBytes\(/);
  });

  it('las fotos se reducen antes de medir el límite de 5 MB', () => {
    expect(view).toContain('prepareImage(file)');
    expect(view).toContain("kind !== 'image' && file.size > limit");
    expect(view).toContain('_IMAGE_COMPRESSED');
  });

  it('nombre seguro y MIME de respaldo en la subida', () => {
    expect(view).toContain('safeFileName(');
    expect(view).toContain('contentType = mimeFor(file)');
  });

  it('la nota de voz queda lista (ATTACHMENT_READY) ANTES del intento a Meta', () => {
    expect(view.indexOf("voiceLog('VOICE_ATTACHMENT_READY'")).toBeGreaterThan(-1);
    expect(view.indexOf("voiceLog('VOICE_ATTACHMENT_READY'")).toBeLessThan(view.indexOf("voiceLog('VOICE_SEND')"));
  });
});

describe('Cada etapa de subida queda marcada en el panel QA', () => {
  it('auth, token, subida, URL y adjunto listo', () => {
    ['_AUTH_OK', '_TOKEN_REFRESH_OK', '_UPLOAD_START', '_UPLOAD_OK', '_DOWNLOAD_URL_OK', '_FAILED_AT', '_ATTACHMENT_READY', '_FILE_SELECTED']
      .forEach((s) => expect(view).toContain(s));
  });

  it('la nota de voz separa grabación, subida y envío', () => {
    ['VOICE_TAP', 'MIC_PERMISSION_OK', 'RECORDER_START', 'RECORDER_STOP', 'VOICE_BLOB_CREATED', "uploadToStorage(file, 'VOICE'", 'VOICE_ATTACHMENT_READY', "etapa = 'send'"]
      .forEach((s) => expect(view).toContain(s));
  });
});
