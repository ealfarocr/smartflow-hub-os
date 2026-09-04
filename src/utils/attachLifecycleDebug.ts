/**
 * Instrumentación TEMPORAL para diagnosticar en Android/iOS real si Chrome recicla el
 * proceso de la SPA (recarga completa, pierde el estado de React) mientras la cámara o la
 * galería están en primer plano — la sospecha detrás de por qué la foto/video/imagen
 * elegida a veces no vuelve al chat como adjunto. Ver PROJECT_STATE.md
 * ("Corrección del diagnóstico") y los logs [ATTACH] en ConversationsPageView.tsx.
 *
 * Quitar (junto con los logs [ATTACH] del chat) una vez confirmada la causa raíz real
 * en dispositivo — no debe quedar como logging permanente.
 *
 * mountCount > 1 dentro de la MISMA sessionId significa que el módulo de JS se volvió a
 * evaluar sin que se abriera una pestaña nueva — o sea, Chrome recargó la SPA desde cero
 * (recicló el proceso). Si eso pasa justo después de PHOTO_CLICK/VIDEO_CLICK/GALLERY_CLICK
 * y antes del *_CHANGE correspondiente, confirma la hipótesis de reciclado.
 */
const rand = () => Math.random().toString(36).slice(2, 8);

const MOUNT_ID = rand();

let SESSION_ID: string;
let MOUNT_COUNT: number;
try {
  SESSION_ID = sessionStorage.getItem('sf_debug_session_id') || rand();
  sessionStorage.setItem('sf_debug_session_id', SESSION_ID);
  MOUNT_COUNT = Number(sessionStorage.getItem('sf_debug_mount_count') || '0') + 1;
  sessionStorage.setItem('sf_debug_mount_count', String(MOUNT_COUNT));
} catch {
  // sessionStorage puede fallar en modo privado/incógnito — degradar sin romper nada.
  SESSION_ID = rand();
  MOUNT_COUNT = 1;
}

const ctx = () => ({ sessionId: SESSION_ID, mountId: MOUNT_ID, mountCount: MOUNT_COUNT });

console.log('[ATTACH] APP_MOUNT', ctx());

window.addEventListener('pagehide', (e) => {
  console.log('[ATTACH] PAGE_HIDE', { ...ctx(), persisted: e.persisted });
});
window.addEventListener('pageshow', (e) => {
  console.log('[ATTACH] PAGE_SHOW', { ...ctx(), persisted: e.persisted });
});
document.addEventListener('visibilitychange', () => {
  const tag = document.visibilityState === 'hidden' ? 'VISIBILITY_HIDDEN' : 'VISIBILITY_VISIBLE';
  console.log(`[ATTACH] ${tag}`, ctx());
});
