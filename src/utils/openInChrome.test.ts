import { describe, it, expect } from 'vitest';
import { chromeIntentUrl, isOutsideBrowserTab } from './openInChrome';
import { describeContainer } from './mediaDiag';

// Evidencia física A/B: desde el ícono (standalone) el selector se cancela solo;
// en Chrome normal galería, foto y video funcionan.
describe('Abrir SmartFlow en Chrome desde el acceso directo', () => {
  it('arma un intent de Android a la app Chrome con la misma ruta y respaldo https', () => {
    const url = chromeIntentUrl('https://hub.smartflow-suite.com/conversaciones?qa=1');
    expect(url.startsWith('intent://hub.smartflow-suite.com/conversaciones?qa=1#Intent;')).toBe(true);
    expect(url).toContain('scheme=https');
    expect(url).toContain('package=com.android.chrome');
    expect(url).toContain(`S.browser_fallback_url=${encodeURIComponent('https://hub.smartflow-suite.com/conversaciones?qa=1')}`);
    expect(url.endsWith(';end')).toBe(true);
  });

  it('solo se ofrece fuera de una pestaña normal', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
    const pestana = describeContainer({ ua, brands: ['Google Chrome 128'], displayMode: 'browser', referrer: '' });
    const icono = describeContainer({ ua, brands: ['Google Chrome 128'], displayMode: 'standalone', referrer: '' });
    expect(isOutsideBrowserTab(pestana)).toBe(false);
    expect(isOutsideBrowserTab(icono)).toBe(true);
  });
});
