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
