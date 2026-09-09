# Changelog

Formato libre, en español, más reciente primero. Un cambio por línea, agrupado por fecha.

## 2026-09-09 — FIX URGENTE: bootstrap del primer Owner (USADITOS sin ningún Owner activo)

> Corregido y desplegado. Falta 1 paso manual de Eduardo (generar el PIN de
> EDUARDO ADMIN desde su propia cuenta real de SuperAdmin) — no lo pude
> completar yo por un límite real de permisos IAM en este entorno. Ver
> `PROJECT_STATE.md`.

- chore(git hygiene): `main` tenía `functions/src/index.ts` idéntico a
  `04ac9a0` — sin el subsistema de PIN/vendedores, sin los fixes de WhatsApp
  de esta misma noche, ambos ya confirmados en producción. Reconciliado
  mediante cherry-pick quirúrgico desde `pending/post-baseline-work-2026-09-09`
  (excluyendo `landing/index.html`, que no pertenece a este catch-up). Sin
  deploy nuevo — solo puso a `main` al día con lo que ya corría.
- fix(bug real, confirmado en producción): `setVendorPin` exigía una
  membership activa de Owner/Admin para llamarla — un tenant nuevo tiene
  todos sus Owners en `prepared`, así que nadie podía activar al primer
  Owner. `functions/src/vendorPinAuth.ts` (8 tests) agrega un bootstrap
  angosto: SuperAdmin puede activar el PRIMER Owner únicamente cuando el
  tenant tiene 0 Owners activos; se cierra solo apenas exista uno. No toca
  roles, IA, WhatsApp ni Payments.
- deploy: `functions:setVendorPin` únicamente, desde el commit `f56c75a`
  (ya integrado en `main`, sin ramas efímeras sin mergear).

## 2026-09-09 — LOOP DE EMERGENCIA: causa raíz real de outbound WhatsApp USADITOS encontrada

> No es un bug de SmartFlow. Ver `PROJECT_STATE.md` (sección "⚠️ BLOQUEADOR
> ACTIVO") para el detalle completo y el next action exacto para Eduardo.

- diagnóstico: prueba directa a Graph API (`POST /messages`) sin pasar por
  ningún código de SmartFlow falla idéntico a través de SmartFlow —
  `OAuthException code 1`. Descarta a SmartFlow como causa primaria con
  evidencia directa, no por descarte de hipótesis.
- hallazgo: `GET /{phone-number-id}?fields=health_status` (endpoint separado
  del de envío, no consultado en auditorías anteriores de esta sesión) revela
  la causa real, que `/messages` nunca muestra: la WABA tiene
  `can_send_message: BLOCKED` por error de método de pago (código 141006,
  "bloquea conversaciones iniciadas por el negocio") y estado inactivo
  (código 141008); el Business tiene verificación de negocio pendiente
  (código 141010). Esto explica por qué inbound siempre funcionó mientras
  outbound siempre falló con un error genérico sin pista real.
- no se tocó código de SmartFlow — no había nada que corregir ahí. No se
  reintentó el envío sin que Eduardo primero resuelva el pago/verificación en
  Meta Business Manager.

## 2026-09-09 — LOOP: `main` reconciliado con producción real

> `main` volvió a representar exactamente el frontend desplegado. No se
> desplegó nada en este LOOP. Ver `PROJECT_STATE.md` para el detalle completo.

- fix(git hygiene): `main` estaba en `04ac9a0`, muy por detrás de lo realmente
  desplegado. Snapshot completo de todo lo pendiente vía `git stash push -u`
  (recuperable, no dropeado), luego `git merge --ff-only
  recovery/hosting-canonical-2026-09-09` — fast-forward limpio, sin
  conflictos. `main` ahora es exactamente `0cf17b5`, el commit realmente
  desplegado a `hosting:app`. Verificado: diff de main contra ese commit
  (fuera de `CHANGELOG.md`/`PROJECT_STATE.md`) es vacío.
- chore: todo el trabajo pendiente no incluido en el deploy (validación
  manual de WhatsApp en `IntegrationsPlaceholderView.tsx`/
  `WhatsappIntegrationService.ts` — NO aprobada; trabajo de Functions ya
  desplegado pero nunca committeado; assets de landing; scripts de QA)
  preservado en la rama `pending/post-baseline-work-2026-09-09` (3 commits
  temáticos) y también en el stash original, que se mantiene como respaldo
  redundante. Un conflicto real de 3-way merge en
  `IntegrationsPlaceholderView.tsx` se resolvió a mano, hunk por hunk — no se
  copió el archivo completo a ciegas. Verificado con diff que nada se perdió.
- limitación: no se pudo hacer la confirmación visual real en el navegador de
  los mensajes fallidos de USADITOS (bloqueado por la prohibición de crear
  cuentas, incluso temporales, para autenticarse) — en su lugar se verificó
  por lectura solo-lectura de Firestore que los 2 mensajes fallidos reales
  tienen los campos (`status:'failed'`, `errorMessage`) que el código ya
  desplegado necesita para mostrarse correctamente. Pendiente de que alguien
  con acceso real lo confirme visualmente.

## 2026-09-09 — Deploy autorizado: `hosting:app` desde el baseline canónico

- deploy: `hosting:app` (proyecto `paneles-solares-bcs-mx`, target `app` únicamente
  — no `landing`, no `blog`, no Functions, no Rules, no indexes) desde un worktree
  aislado en `recovery/hosting-canonical-2026-09-09` (commit `0cf17b5`). Diff contra
  el tag `hosting-baseline-2026-09-09` confirmado como un único archivo:
  `ConversationsPageView.tsx` (status UI de WhatsApp). `typecheck` limpio, 15/15
  tests, build limpio. Verificado post-deploy que el bundle servido en vivo
  (`index-BEQd8zsD.js`) contiene el fix (`"No enviado"`, `"Reintentar"`) y conserva
  Payments intacto (`"Quitar cuenta"`). Sin errores de consola en desktop ni mobile
  (viewport emulado) sobre la página pública. **No se pudo verificar visualmente
  una conversación real de USADITOS con un mensaje fallido real** — sin
  credenciales de producción disponibles en este entorno; ver `PROJECT_STATE.md`.

## 2026-09-09 — LOOP: recuperación de baseline canónico de `hosting:app`

> Solo reconciliación de git — **no se desplegó nada** (ni hosting, ni functions,
> ni rules). Ver `PROJECT_STATE.md` para el detalle completo.

- fix(git hygiene): recuperado con `git fsck --unreachable` el commit exacto
  (`3b2228fb3816ed046fc9ff4f454a4cc15a9b161e`) que generó lo que hoy está en vivo
  en `hosting:app` — confirmado byte-por-byte (mismo nombre de bundle de Vite,
  mismo tamaño, mismo MD5, `diff` vacío contra el bundle descargado en producción).
  `main` nunca reflejó este commit porque el patrón de deploy de esta sesión
  commiteaba dentro de worktrees efímeros que luego se borraban sin mergear a
  `main`.
- chore: creado tag local `hosting-baseline-2026-09-09` sobre ese commit — punto
  de referencia canónico y verificado para cualquier deploy futuro de
  `hosting:app`.
- chore: creada rama local `recovery/hosting-canonical-2026-09-09` = ese baseline
  + el único fix aprobado y pendiente (status UI de WhatsApp de la entrada de
  abajo), como commit separado. No desplegada — lista para cuando se autorice.
- hallazgo: comparado contra el baseline real (no contra `04ac9a0`, que estaba
  desactualizado), la divergencia real del working tree se reduce a 3 archivos de
  WhatsApp (`ConversationsPageView.tsx`, `IntegrationsPlaceholderView.tsx`,
  `WhatsappIntegrationService.ts`). Todo lo demás — incluido Payments/PayPal —
  ya está desplegado en producción sin diferencia alguna.
- limitación: no se pudo hacer QA autenticado módulo por módulo en producción por
  no tener credenciales disponibles en este entorno; se documenta explícitamente.

## 2026-09-09 — LOOP nocturno: estabilización WhatsApp USADITOS

> Outbound real de WhatsApp para USADITOS sigue bloqueado por Meta (`OAuthException`
> code 1, "An unknown error has occurred") — NO resuelto esta noche. Ver
> `PROJECT_STATE.md` para el detalle completo y el reporte GO/NO-GO.

- fix(seguridad, todos los tenants): `sendWhatsappMessage` no tenía bypass de
  SuperAdmin — un SuperAdmin sin membership activa en el tenant no podía enviar
  mensajes (bloqueaba a USADITOS, que aún no tiene ningún miembro activado). Lógica
  extraída a funciones puras testeadas (`functions/src/sendMessageAuth.ts` — 9 tests).
  El guard de que la conversación pertenezca al tenant solicitado se preserva igual
  para SuperAdmin (evita el hueco cross-tenant que abriría el bypass).
- fix(diagnóstico, todos los tenants): `sendWhatsappMessage` ahora captura y persiste
  el detalle estructurado del error de Meta (`type`, `code`, `subcode`, `fbtrace_id`,
  `httpStatus`) en el mensaje fallido, sin loguear ni persistir nunca el access token
  ni el App Secret.
- fix(bug real, todos los tenants): el webhook nunca aplicaba los status updates de
  Meta (`sent`/`delivered`/`read`/`failed`) al mensaje guardado — solo los logueaba.
  Los mensajes salientes se quedaban en `status:'sent'` para siempre aunque Meta
  confirmara la entrega/lectura. Corregido: se busca el mensaje por `externalId`
  (wamid, collection-group query, nuevo índice en `firestore.indexes.json`), se
  verifica que la conversación pertenezca al mismo tenant que originó el webhook
  (defensa en profundidad), y se aplica el nuevo status solo si
  `shouldApplyStatusUpdate` (`functions/src/messageStatusUpdate.ts` — 11 tests) lo
  aprueba: nunca retrocede, "failed" es terminal, eventos duplicados/fuera de orden se
  ignoran.
- fix(bug real, todos los tenants): condición de carrera en la deduplicación de
  mensajes entrantes de WhatsApp — el chequeo de `dedupRef.exists` se hacía FUERA de
  la transacción y el `set` adentro nunca lo releía, así que dos entregas casi
  simultáneas del mismo wamid (reintento de Meta) podían crear el mensaje/lead
  duplicado. Corregido releyendo `dedupRef` con `transaction.get()` como primera
  operación dentro de la transacción.
- fix(infra, bloqueaba cualquier deploy de functions): un `setInterval` a nivel de
  módulo (limpieza del rate-limit map) sin `.unref()` mantenía vivo el proceso que usa
  `firebase deploy` para analizar el código — causaba "Cannot determine backend
  specification. Timeout after 10000" al intentar desplegar CUALQUIER función de
  `index.ts`. Bug pre-existente (no relacionado a WhatsApp), encontrado y corregido
  porque bloqueaba desplegar los fixes de esta noche.
- fix(UI, todos los tenants): la burbuja de mensaje mostraba el doble-check azul
  ("leído") para CUALQUIER mensaje del asesor, incluidos los que fallaron
  (`status:'failed'`) — falso positivo de éxito. Ahora el ícono refleja el status real
  (pending/sent/delivered/read/failed) y los mensajes fallidos muestran "No enviado —
  [error] / Reintentar", que reenvía como mensaje nuevo (no duplica ni sobrescribe el
  original).
- feat: nueva función `saveManualWhatsAppConfig` — la conexión manual de WhatsApp
  ahora valida contra Graph API (que el `phoneNumberId` pertenezca al `wabaId`, que la
  app esté suscrita a la WABA) antes de guardar como conectado, igualando el
  comportamiento de Embedded Signup. Antes se podía guardar "Conectado" en Firestore
  sin ninguna validación real contra Meta.
- deploy: `functions:sendWhatsappMessage`, `functions:whatsappWebhook`,
  `functions:saveManualWhatsAppConfig`, `firestore:indexes` — vía worktree aislado,
  targets específicos (nunca deploy global). `hosting:app` NO se desplegó esta noche
  (ver `PROJECT_STATE.md`, sección de deploy).
- test: 37/37 tests de `functions/` en verde (9 nuevos de auth, 11 nuevos de status
  update, resto preexistentes). Typecheck y build limpios en `functions/` y en la raíz.

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
