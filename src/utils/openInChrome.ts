// "Abrir en Chrome" para cuando SmartFlow corre fuera de una pestaña normal.
//
// Evidencia física A/B (2026-09-11): desde el ícono de inicio (modo standalone)
// la galería y la cámara no aparecen — el input se cancela solo en ~300-400 ms —
// y abriendo hub.smartflow-suite.com en Chrome funcionan las tres. La app no tiene
// manifest de PWA, así que ese modo lo arma otra cosa que Chrome.
//
// En Android, un enlace intent:// con package=com.android.chrome abre la misma
// URL en la app Chrome. Si el contenedor no sabe manejar intents, el
// S.browser_fallback_url lleva a la URL https normal.

export const CHROME_PACKAGE = 'com.android.chrome';

/** intent:// que abre `href` (https) en la app Chrome de Android. */
export function chromeIntentUrl(href: string): string {
  const u = new URL(href);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=${CHROME_PACKAGE};S.browser_fallback_url=${encodeURIComponent(u.toString())};end`;
}

/** true si la página NO corre en una pestaña normal del navegador. */
export function isOutsideBrowserTab(container: string): boolean {
  return container !== 'pestaña del navegador';
}
