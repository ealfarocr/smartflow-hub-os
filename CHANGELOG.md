# Changelog

Formato libre, en español, más reciente primero. Un cambio por línea, agrupado por fecha.

## 2026-09-04

> Nota: ninguno de los fixes de este día está confirmado como "causa raíz" del bug de
> cámara/galería/grabadora — son correcciones defensivas/de robustez, razonables y de
> bajo riesgo, pendientes de confirmar con logs en un Android real. Ver
> `PROJECT_STATE.md` → "⚠️ Aclaración sobre causa raíz".

- fix(config, candidato — no confirmado): el header `Permissions-Policy` de Firebase
  Hosting traía `camera=()`, que desactiva la cámara para todo el sitio, incluido él
  mismo. Según el spec HTML/MediaCapture eso debería hacer que el navegador ignore el
  atributo `capture` de los `<input type="file">`, cayendo a un chooser genérico — lo que
  es consistente con las capturas de pantalla del reporte, pero no se confirmó
  empíricamente que esa fuera la causa real. Cambiado a `camera=(self)` de todas formas,
  por ser la configuración correcta.
- feat: nueva opción "Galería" en el menú de la cámara del chat (junto a Foto/Video), para
  elegir fotos/videos existentes sin pasar por captura de cámara.
- fix: la grabadora de notas de voz podía arrancar a grabar "fantasma" después de que el
  usuario soltara el botón, si el permiso de micrófono tardaba en resolverse (diálogo
  nativo del navegador, típicamente la primera vez).
- chore: agregado `scripts/check-mobile-capture-config.mjs`, chequeo de regresión para el
  header de Permissions-Policy y los dos fixes de `ConversationsPageView.tsx` de arriba.
- fix(robustez, candidato — no confirmado): los `onChange` de Foto/Video/Galería/Adjuntar
  limpiaban `e.target.value` sin esperar a que `handleFileUpload` terminara — patrón de
  riesgo documentado en algunos navegadores móviles (puede invalidar el `File` antes de
  terminar de leerlo). Corregido: el reset ahora ocurre después del `await`. No hay
  evidencia todavía de que esto fuera la causa del bug reportado; se aplica igual porque
  elimina un riesgo real sin costo.
- chore: instrumentación temporal de logs (`[ATTACH] PHOTO_CLICK/CHANGE/FILE_RECEIVED/
  ATTACHMENT_CREATED` y análogos VIDEO_*/GALLERY_*) en `ConversationsPageView.tsx` para
  diagnosticar en remote debugging por qué el archivo capturado/elegido no siempre vuelve
  al chat. Se mantienen activos deliberadamente tras el deploy — no quitar todavía.
- chore: instrumentación temporal de ciclo de vida de la página
  (`src/utils/attachLifecycleDebug.ts`, importado desde `main.tsx`): logs `APP_MOUNT`,
  `PAGE_HIDE`, `PAGE_SHOW`, `VISIBILITY_HIDDEN`, `VISIBILITY_VISIBLE`, cada uno con
  `sessionId`/`mountId`/`mountCount`, para detectar en un Android real si Chrome recicla
  el proceso de la SPA (recarga completa) mientras la cámara/galería están abiertas —
  eso perdería cualquier archivo pendiente de volver al chat. También se mantienen
  activos tras el deploy.
- docs: auditado el flujo completo tap→cámara/galería→onChange→upload→preview→envío;
  descartado (con evidencia de código) que cerrar el menú desmonte los inputs — viven
  fuera del dropdown, siempre montados. La causa raíz real queda pendiente de confirmar
  con los logs `[ATTACH]` en un Android real; ver `PROJECT_STATE.md` para la guía de
  diagnóstico completa (qué log-chain esperar y qué significa cada corte).
- deploy: desplegado a producción (`firebase deploy --only hosting:app`) con autorización
  explícita del usuario, con los logs de diagnóstico activos. Header `Permissions-Policy`
  confirmado en vivo en `hub.smartflow-suite.com` (el dominio real del CRM — distinto de
  `smartflow-suite.com`/`www.`/`app.smartflow-suite.com`, que son sitios en Vercel no
  relacionados con este repo). Sin commit todavía — deploy hecho desde el working tree.
  Ver `PROJECT_STATE.md` → "Deploy controlado a producción" para el detalle completo.

## 2026-09-03

- fix: nota de voz podía quedar colgada sin forma de soltarla (listener global de
  pointerup/pointercancel como red de seguridad + tope de 3 minutos).
- fix: encabezado del chat muestra el número de teléfono en vez del nombre del canal;
  panel de herramientas colapsable; bug de cámara con `accept` mezclado separado en dos
  inputs (foto/video).
- feat: botón de cámara para tomar foto o video al momento en el chat.
- feat: panel de cuotas de WhatsApp colapsado por defecto en mobile.

## 2026-09-03 (anterior)

- fix: el bot ahora arranca siempre apagado; solo lo activa el vendedor (antes se
  autoactivaba si `isAiAutomated` era true en la integración).
