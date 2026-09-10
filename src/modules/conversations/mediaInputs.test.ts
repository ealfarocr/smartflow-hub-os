import { describe, it, expect } from 'vitest';

// CAUSA RAÍZ del "tocar el clip o la cámara no hace nada" en el teléfono: los
// <input type="file"> tenían className="hidden", o sea display:none. En Chrome
// para Android un input de archivo con display:none NO abre el selector cuando
// se le hace .click() programático — en Chrome de escritorio sí, y por eso
// nunca falló probando en la PC.
//
// La corrección usa <label htmlFor> (activación nativa del navegador, no un
// click programático) e inputs ocultos con sr-only, que los esconde a la vista
// sin sacarlos del render. Este test es el candado para que no vuelva.
const src = Object.values(
  import.meta.glob('/src/modules/conversations/ConversationsPageView.tsx', { query: '?raw', import: 'default', eager: true }),
)[0] as string;

const IDS = ['sf-gallery-input', 'sf-camera-photo-input', 'sf-camera-video-input'];

describe('Los selectores de archivo abren en el teléfono', () => {
  it('ningún input de archivo usa display:none (className="hidden")', () => {
    const inputs = src.split('type="file"').slice(1).map((chunk) => chunk.slice(0, chunk.indexOf('/>')));
    expect(inputs.length).toBe(3);
    inputs.forEach((block) => {
      expect(block).not.toContain('className="hidden"');
      expect(block).toContain('className="sr-only"');
    });
  });

  IDS.forEach((id) => {
    it(`${id} existe una sola vez y tiene un label que lo activa`, () => {
      expect(src.split(`id="${id}"`).length - 1).toBe(1);
      expect(src.split(`htmlFor="${id}"`).length - 1).toBe(1);
    });
  });

  it('el clip abre solo fotos y videos, sin capture', () => {
    const galeria = src.slice(src.indexOf('ref={galleryInputRef}'), src.indexOf('id="sf-gallery-input"') + 60);
    expect(galeria).toContain('accept="image/*,video/*"');
    expect(galeria).not.toContain('capture=');
  });

  it('las dos opciones de cámara usan la cámara trasera', () => {
    const foto = src.slice(src.indexOf('ref={cameraInputRef}'), src.indexOf('id="sf-camera-photo-input"'));
    const video = src.slice(src.indexOf('ref={cameraVideoInputRef}'), src.indexOf('id="sf-camera-video-input"'));
    expect(foto).toContain('accept="image/*"');
    expect(foto).toContain('capture="environment"');
    expect(video).toContain('accept="video/*"');
    expect(video).toContain('capture="environment"');
  });

  it('las opciones del menú de cámara no se desmontan en el mismo toque que activa el input', () => {
    // Desmontar el label durante el evento puede cancelar la activación en
    // algunos navegadores: el menú se cierra al volver del selector nativo.
    const menu = src.slice(src.indexOf('htmlFor="sf-camera-photo-input"'), src.indexOf('Grabar video'));
    expect(menu).toContain("window.addEventListener('focus'");
    expect(menu).not.toContain('setShowCameraChoice(false);\n');
  });
});
