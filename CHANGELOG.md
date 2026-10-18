# Changelog

Formato libre, en español, más reciente primero. Un cambio por línea, agrupado por fecha.
## 2026-10-17 — Round-robin sin TOMAR + Live Video productivo (commits 29f5c34, 22f8cdd, ac5c419; SIN DEPLOY)
- Agente: Claude Code. Asignación: el round-robin YA existía y es atómico (transacción sobre settings/{tenant}); se extrajo a `functions/src/autoAssign.ts` sin cambiar la lógica y se agregó reintento al volver a escribir el lead si la conversación quedó sin asesor (WhatsApp y Meta; una ya asignada nunca se toca). Con asignación automática activa el asesor no ve TOMAR; Owner/Admin lo conservan como contingencia. Emulador: 8 paralelas → 2/2/2/2; secuencia 1→2→3→4→1.
- Live Video: Function `chatLiveVideo` (compose/delete, sin ffprobe), ruta `chat-live-video/{tenant}/{conversation}/{uid}/{job}/` con reglas en storage.rules (16/16 casos en emulador), componente `ChatLiveVideoRecorder` (60 s, ~1,4 Mbps, review + Enviar/Descartar) y botón Grabar video del chat con fallback a la cámara nativa. Envío por ConversationService.sendMessage → sendWhatsappMessage. /super-admin/qa-live-video intacto.
- Validación: functions vitest 160/160, front 504/504 (sin las suites de reglas), tsc/eslint del módulo nuevo, build OK. E2E en emulador con cámara falsa de Edge: cámara→grabar→subir chunks→Detener; cancelar y descartar borran lo subido; Enviar llama a sendWhatsappMessage. Nota: storage.rules.test.ts G (live-video-qa SuperAdmin) falla también SIN estos cambios.
- No verificado: compose real (el emulador de Storage responde Not Implemented a combine; solo corrió en producción en el QA), preview del MP4 fragmentado en Android, envío real a Meta del video del chat, Edge/iOS. Sin deploy de Functions, Storage Rules ni Hosting.

## 2026-10-17 — Falso FAILED de video QA: observabilidad webhook + responsive TOMAR (commits 8606a7d, eac05e1)
- Agente: Claude Code. Live Video QA real: PASS (57.7 s, 10.64 MB, STOP_TO_READY 3041 ms, Meta aceptó, receptor reprodujo); REMUX_REQUIRED=NO. El "No enviado — Media upload error" fue un webhook de Meta `failed` (1.7 s tras el POST OK) que sobrescribió status/errorMessage; sin delivered/read posteriores. Causa de fondo de Meta: sin determinar (falta el código).
- `whatsappWebhook` ahora guarda `metaError` estructurado (code, subcode, title, message, type, fbtraceId, details, wamid, receivedAt) y loguea sanitizado. NO cambian status, shouldApplyStatusUpdate, latch, retry ni sendWhatsappMessage. Responsive: botón TOMAR baja a fila propia en móvil, handleClaim/disabled intactos.
- Validación: functions vitest 141/141, tsc build OK, front tsc OK, conversaciones 65/65; QA visual en 320/360/390/412 sin solapes ni overflow (emuladores). Deploy: `hosting:app` OK (200, bundle con el cambio) y `functions:whatsappWebhook` ACTIVE v104 (2026-10-18T01:51Z). Sin deploy de rules ni de otras Functions.
- No verificado: ningún failed real posterior al deploy (se espera uno); no se inspeccionó el código fuente remoto de la Function más allá del deploy exitoso.

## 2026-10-17 — Botón "Enviar video QA a WhatsApp" (commit 85bf068)
- Agente: Claude Code. En `/super-admin/qa-live-video` se añadió `LiveVideoWhatsappCard`: lee la ventana 24h de la conversación QA (USADITOS CR, `J8qU4lmvYkuRMjYxtvRy`), obtiene la URL del `final.mp4` del job mvc0dj5ddmsvu0 con `getDownloadURL` y envía SOLO al pulsar, vía `ConversationService.sendMessage` → `sendWhatsappMessage`. Botón deshabilitado con ventana inactiva. Sin cambios en Functions/Rules/Meta. Validación: vitest 467/467, tsc y build OK; deploy solo `hosting:app`. Envío real NO ejecutado; ventana inactiva al desplegar (último inbound 2026-10-15 16:49 UTC).

## 2026-10-17 — Fix Live Video QA: lib desincronizado + predeploy
- Agente: Claude Code (commit fab913f). Causa: el deploy del 15-oct subió `functions/lib` viejo (check solo-SuperAdmin) porque no había build previo. Se regeneró lib, se añadió `predeploy` (`npm --prefix "$RESOURCE_DIR" run build`) en `firebase.json` y se desplegó SOLO `functions:liveVideoQa` → revisión `livevideoqa-00003-tuf` (100% tráfico). Validación: tsc OK, functions 138/138. Pendiente: reintentar QA física con EDUARDO ADMIN. El primer deploy dio timeout de discovery (10 s); pasó con `FUNCTIONS_DISCOVERY_TIMEOUT=60`.

## 2026-10-15 — Deploy header + Live Video QA access
- Agente: Claude Code. Desplegados (commits 05efd18, 5dc6e22): `storage` rules, `functions:liveVideoQa` (ACTIVE; sin auth → 401) y `hosting:app` (hub.smartflow-suite.com 200). Sin objetos `live-video-qa/` creados. QA con login de EDUARDO ADMIN, otras rutas /super-admin, vendedor y header en dispositivos: pendientes (requieren sesión real).

## 2026-10-15 — Acceso aislado a Live Video QA para EDUARDO ADMIN (sin deploy)
- Agente: Claude Code. Ruta dedicada `live-video-qa/{uid}/{jobId}/`; `storage.rules` (nuevo match, `admin_attachments` intacto); `liveVideoQa` autoriza SuperAdmin o UID QA exacto y opera solo sobre `request.auth.uid`; `LiveVideoQaGuard` solo para `/super-admin/qa-live-video`. Validación: vitest front 463/463, functions 138/138, `storage.rules.test.ts` 8/8 (emuladores), tsc y build OK. NO desplegado: falta deploy de storage, función `liveVideoQa` y hosting (requiere aprobación).

## 2026-10-15 — Header: nombre de usuario visible en móvil
- Agente: Claude Code. `MainLayout.tsx` (nombre siempre visible, truncado solo como último recurso), nuevo `HeaderMoreMenu.tsx` (menú "⋮" solo móvil: sonido, tema, cerrar sesión), `OperationalStatusSelector.tsx` (solo clases: etiqueta visible en móvil ≥360px). Validación: vitest 453/453, `npm run build` OK, tsc sin errores; eslint solo errores previos de MainLayout. Sin deploy; QA visual por viewport pendiente.

## 2026-10-13 — Prototipo QA Live Video (solo SuperAdmin)

- Agente: Claude Code. Nueva función callable `liveVideoQa` + pantalla `/super-admin/qa-live-video`; dependencia `@ffprobe-installer/ffprobe`. Sin cambios en WhatsApp, chat productivo, Rules, tenants ni Meta.
- Validación: vitest 453/453 y 132/132 (functions), tsc+build OK. No verificado: medición en Android real.

## 2026-10-12 — Adjuntos del chat: progreso y rechazo visibles

- Agente: Claude Code. Solo frontend (`ConversationsPageView`, nuevo `mediaUpload.ts`); deploy solo `hosting:app`. Sin cambios en límites, compresión, Functions, Rules ni Meta.
- Validación: vitest 425/425, tsc+build OK, eslint sin errores nuevos. No verificado: QA física en el teléfono.

## 2026-10-12 — Selector de turno: menú visible completo en móvil

- Agente: Claude Code. Solo frontend (`OperationalStatusSelector`, nuevo `dropdownPosition.ts`); deploy solo `hosting:app`. Sin cambios de media, Functions ni Rules.
- Validación: vitest 400/400, tsc+build OK. No verificado: QA física en Android.

## 2026-10-12 — Acceso por código: el negocio del enlace/servidor gana (fase 1, cliente)

- Agente: Claude Code. Solo frontend (`PinAccessView`, nuevo `pinAccessTenant.ts`); deploy solo `hosting:app`. Sin cambios en Functions, Rules, ConversationService ni modelo de datos.
- Validación: vitest 392/392 (21 nuevos), tsc+build OK, eslint sin errores nuevos. No verificado: QA física en teléfono.

## 2026-10-12 — Impersonación sin selector de turno + presencia vencida

- Agente: Claude Code. Solo frontend. Nuevo `presenceStatus.ts` (`resolvePresenceStatus`, `resolveOperationalStatus`, `isImpersonatingTenant`); `MainLayout`, `usePresenceTracker`, `UsersManagementView` y `formatLastSeen` (export `toSafeDate`) ajustados.
- Umbral de presencia = 3 × heartbeat de 60 s = 180 s; derivado en UI, sin escribir `offline`. `operationalStatus`, `setOperationalStatus`, work_sessions, WhatsApp y Meta intactos.
- Validación: vitest 371/371, tsc+build OK, eslint sin errores nuevos. No verificado: QA física.

## 2026-10-12 — Alerta sonora global de mensajes WhatsApp entrantes

- Agente: Claude Code. Commit `24821fd`; deploy solo `hosting:app`. Sin cambios en webhook, Meta, reglas ni Firestore.
- Nuevos: `useInboundAlerts`, `inboundAlerts.ts`, `inboundSound.ts`, `InboundSoundToggle`; `MainLayout` los monta.
- Validación: vitest 351/351 (19 nuevos: primer snapshot, repetición, outbound, reset de unread, recarga, tenants, roles, preferencia, autoplay), tsc OK, build OK, eslint sin errores nuevos.
- No verificado: QA física en navegador con mensaje real.

## 2026-10-12 — USADITOS CR: WhatsApp conectado (manual controlado)

- Agente: Claude Code (script Admin SDK fuera del repo; sin cambios de código ni deploy; sin mensajes enviados).
- Meta: app SmartFlow Hub Connect suscrita SOLO a la WABA `2093517247974916` (token dedicado SYSTEM_USER `usaditoscrapi`, permisos whatsapp_business_management/messaging).
- Firestore: `integrations/YZFXfMJtwV91oEDqclVf` creado con `create()` para `t-1791700036682` (phoneNumberId `1395528163640894`, +1 229-800-2808, appSecret/verifyToken null, el webhook usa el secreto global). El token nuevo vive solo en ese doc y en un archivo local fuera del repo (`~/.aasg-secrets/`).
- Validación: 1 integración WhatsApp para el clon; el webhook resuelve el phoneNumberId nuevo al clon; `integrations/C1lnMixK9riUA7HlQzPT` intacto (mismo updateTime, mismas huellas). Resultado: PASS.
- No verificado: recepción real de un mensaje (firma con WHATSAPP_APP_SECRET global) ni envío.

## 2026-10-11 — Clon operativo USADITOS CR (config + equipo) para contingencia de WhatsApp

- Agente: Claude Code (script Admin SDK fuera del repo, solo `create()`; sin cambios de código ni deploy).
- Nuevo tenant `t-1791700036682` "USADITOS CR": tenants + settings (pipeline, features, branding con logo copiado a su propia ruta, plantillas, comercial, cobros, Multi-Agente remapeado) + 10 memberships (mismos userId; los preparados con IDs nuevos).
- NO se copió: integrations/credenciales, PIN hashes, handles, conversaciones, leads, mensajes, dedup, presencia, dispositivos, sesiones, logs, onboarding state.
- `ownerEmail` se escribe DESPUÉS de crear el tenant a propósito: `onTenantCreatedAutomation` (onCreate) enviaría correo de bienvenida + factura y agendaría seguimientos.
- Validación: origen intacto (18 docs, updateTime + hash, incl. `integrations/C1lnMixK9riUA7HlQzPT`); 0 docs del clon en 11 colecciones operativas; sin llaves de credenciales; sin onboarding state ni correos encolados. Resultado: PASS.
- No verificado: login real de cada persona por UI (requiere sesión humana).

## 2026-09-30 — Auditoría solo lectura: ¿sirve +506 6148 5138 como número alterno?

- El token de producción de USADITOS (SYSTEM_USER, scopes whatsapp_business_*) alcanza
  UNA sola WABA (`1659672582339181`) y ahí hay UN solo número: +506 7229 2718. El 6148
  no aparece con ningún token de SmartFlow (los otros tenants tampoco lo tienen).
- `owned/client_whatsapp_business_accounts` del negocio 484626874413322 → error 200
  (falta `business_management`): no se puede enumerar el inventario del negocio por API.
- Clave técnica: el bloqueo 141008 es **de WABA**, no del número. Otro número dentro de
  la MISMA WABA heredaría el bloqueo; solo sirve un número en una WABA sana distinta.
- Ads: ninguna cuenta publicitaria cuelga del negocio de Usaditos; varias cuentas del
  usuario están `UNSETTLED` (saldo pendiente) y otras `DISABLED`. Es un sistema distinto
  al de mensajería: no explica ni causa el 141008.
- Sin cambios, sin deploy, sin mensajes enviados.
## 2026-09-30 — Break-glass: el SuperAdmin puede rescatar el acceso de un usuario de tenant

- Auditoría: `setVendorPin` → `checkVendorPinAuth` solo admitía al SuperAdmin para
  bootstrap (tenant sin Owner activo). Con un Owner activo bloqueado, lockout total.
- `0f311a3` — tercer camino explícito (`breakGlass` + SuperAdmin), evento en
  `security_audit`, regla nueva en firestore.rules, confirmación en la UI.
- 9 tests nuevos en `functions/src/vendorPinAuth.test.ts` (incluye: usuario común no
  puede aunque mande la bandera; SuperAdmin sin pedido explícito sigue bloqueado; el
  evento nunca lleva código/hash/salt). 332/332 en total.
- Deploy: `functions:setVendorPin`, `firestore:rules`, `hosting:app`. Sin tocar Meta,
  WhatsApp, roles ni datos de tenants.
## 2026-09-25/26 — Billing reactivado; panel QA de media sacado de producción

- Verificación post-billing (solo lectura): sin errores `billing is disabled` tras
  las 03:57 UTC; `whatsappWebhook` 200; callables responden 401 en vez de 500;
  inbound de WhatsApp confirmado físicamente.
- `8ec1d8c` — `MediaDiagPanel` ya no se enciende por `isSuperAdmin`; requiere `?qa=1`
  explícito y la marca pasa de `localStorage` a `sessionStorage`, limpiando la vieja.
  2 tests nuevos en `mediaInputs.test.ts`. 324/324, build OK, lint sin regresión.
- Deploy: solo `hosting:app`. Verificado en el bundle publicado (`index-DtqRHt31.js`).
- Sin cambios en Meta, tokens, webhook, ni datos de tenants.
## 2026-09-25 — SuperAdmin mostraba "Conectar WhatsApp" en tenants conectados: backend caído por billing

- Auditoría del SuperAdmin global: la tabla deriva el estado de la callable
  `getWhatsappNumbers`; los datos de Firestore están sanos (5 integraciones activas,
  `tenantId` de todas coincide con un tenant real, 0 huérfanos).
- Causa raíz: `gcloud logging` muestra `"billing is disabled for this project"` (500)
  desde 2026-09-18 05:45 UTC. Todas las Cloud Functions fallan, `whatsappWebhook`
  incluido → sin inbound de WhatsApp desde 2026-09-15.
- Defecto propio corregido (`2e9ed0f`): el servicio confundía "no pude consultar" con
  "no conectado" y la UI ofrecía Embedded Signup sobre integraciones vivas. Ahora
  `getWhatsAppNumbers` devuelve `{ numbers, lookupFailed }` y la vista muestra
  "Revisar WhatsApp" sin botón de (re)conectar.
- Tests: 322/322 (5 nuevos en `src/utils/whatsappStatus.test.ts`). Build OK. Lint sin
  regresión (334 antes y después). Deploy: solo `hosting`, verificado en el bundle.
- No se tocó Meta, ni tokens, ni datos de tenants. Nada de Embedded Signup ejecutado.
## 2026-09-14 — P0 WhatsApp outbound USADITOS: auditoría final, causa exacta 141008 (Claude Code, solo lectura)

- `GET /{phone}?fields=status,account_mode,...,health_status` (Graph v21.0) sobre todas
  las integraciones WhatsApp activas, tokens leídos de Firestore sin imprimirse. Sin
  envíos, sin escrituras, sin deploy.
- USADITOS: `health_status.can_send_message: BLOCKED`; entidad WABA `1659672582339181`
  BLOCKED con `141008 "The WABA status is not active."` (Meta indica contactar soporte).
  El 141006 de pago del 2026-09-09 ya no aparece.
- Poder Ancestral (envía OK): WABA AVAILABLE; tiene el mismo 141010 de Business sin
  verificar → descartado como causa. APP AVAILABLE en ambos → token/app descartados.
- Corrige la auditoría intermedia del mismo día que afirmaba que no existía un flag
  `can_send_message` en Graph.
- Lateral, no tocado: `t-alpha` y `zapaterasdesanjos` con tokens inválidos (190).
- Resultado: sin problema de configuración local; requiere que Meta active la WABA.
## 2026-09-14 — P0 WhatsApp outbound USADITOS: fix verificado en producción; bloqueo confirmado del lado de Meta

- verificación post-deploy: envío real "Prueba SmartFlow Meta 01" (11:31:34 AM CR).
  Firestore guardó `status:"failed"` con `metaError` completo
  (`{httpStatus:500,type:"OAuthException",code:1,subcode:null,fbtraceId:"ALvfaLHBfdjM2FqGvm5xWzi"}`)
  — sin crash. `gcloud logging read` confirma cero entradas `severity>=ERROR` en
  esa ventana. SMARTFLOW_FUNCTION_FIXED = YES.
- pero el mismo `OAuthException code:1` volvió a aparecer — tercera vez, dos días
  distintos, tres `fbtrace_id` distintos, con token/phone/WABA/cuenta confirmados
  sanos en todas las capas verificables. META_ERROR_PERSISTS = YES: el bloqueo
  actual es 100% de Meta, no queda código de SmartFlow por cambiar para esto.
- next: escalar a soporte de Meta/WhatsApp Business citando WABA
  1659672582339181, phone 1354454937743475 y los 4 fbtrace_id acumulados
  (AFVPOKJS5dQKL2AQ03xW_MJ, Aa5fmtGO2Lg-GvECTz15NS6, Aosj6mgEU-FaB_PJA5SycIU,
  ALvfaLHBfdjM2FqGvm5xWzi).

## 2026-09-14 — P0 WhatsApp outbound USADITOS: error real de Meta capturado, crash de persistencia corregido (7c3c635)

- auditoría (solo lectura, sin tocar frontend/media/Storage/IAM/PIN/Auth/catálogo/WABA/
  pago/tokens): integración activa confirmada — WABA 1659672582339181, phoneNumberId
  1354454937743475, +506 7229 2718. Vía Graph API directo (solo GET): token válido con
  scope whatsapp_business_messaging (SYSTEM_USER), phone status CONNECTED/VERIFIED, WABA
  suscrita correctamente a la app SmartFlow Hub Connect, account_review_status: APPROVED.
  Todo del lado de Meta está sano.
- evidencia real vía `gcloud logging read` (no `firebase functions:log`, que devolvió
  entradas viejas/no cronológicas): el envío real de "buenos dias" de hoy 15:25 UTC
  recibió de Meta OAuthException code:1, HTTP 500, "An unknown error has occurred.",
  fbtrace_id presente — un error genuino y ACTUAL de Meta, no los códigos históricos
  141006/141008/141010.
- root cause real (no era Meta): sendWhatsappMessage guardaba `subcode: undefined` cuando
  Meta no manda error_subcode (como en este code:1 genérico) — el Admin SDK de Firestore
  RECHAZA `undefined` en cualquier write y tira TODA la transacción. Ni el mensaje fallido
  ni el metaError de diagnóstico llegaban a guardarse: la función terminaba en "Unhandled
  error" ciego y el cliente recibía el error genérico interno de Functions, no la
  respuesta estructurada { success:false, errorMessage } que el frontend ya sabía leer
  (por eso la UI solo mostraba "No se pudo enviar el mensaje. Intentá de nuevo.").
- fix: buildMetaErrorDetail() extraída a sendMessageAuth.ts (mismo patrón que
  checkMembershipAuth), sanea cada campo con `?? null`. Sin tocar frontend — la lectura
  de errorMessage ya existía desde un LOOP anterior, solo necesitaba que la función dejara
  de crashear antes de devolver la respuesta.
- test: 4 casos nuevos en sendMessageAuth.test.ts (incluye el caso real reproducido hoy).
  112/112 tests de functions, typecheck y build limpios. Lint: 0 errores nuevos.
- deploy: `functions:sendWhatsappMessage` únicamente, desde worktree aislado en el commit
  7c3c635 (ya en main). No se pudo reproducir un envío real nuevo post-deploy — el intento
  de enviar un mensaje directo a Graph API para verificación fue bloqueado por el
  clasificador de seguridad (mensaje real a un cliente real); pendiente que el negocio
  reintente un envío real o autorice explícitamente una prueba controlada.

## 2026-09-11 — Causa del selector confirmada (standalone); aviso ABRIR EN CHROME (632ee49)

- evidencia fisica A/B: desde el icono (standalone) galeria/foto/video no aparecen
  (cancel ~300-400 ms); en Chrome normal funcionan y los archivos vuelven al chat.
  Video de 25,3 MB rechazado correctamente (limite 16 MB). Voz ATTACHMENT_READY en prod.
- feat: fuera de una pestaña, el cancel instantaneo muestra un aviso en linea con
  ABRIR EN CHROME (intent a com.android.chrome + respaldo https) y Copiar enlace. Sin
  tocar los controles multimedia.
- ops: procedimiento temporal — vendedores usan Chrome directo, no el icono.
- P1: VIDEO_AUTO_COMPRESSION / TRANSCODING (videos de mas de 16 MB).
- test: 313 unit + 42 rules; QA local 53/53. Deploy hosting:app, bundle index-dGE_qY5C.js.

## 2026-09-11 — Storage cerrado en produccion; contenedor real de la pagina (c3a3377)

- evidencia fisica: VOICE_UPLOAD_OK + VOICE_ATTACHMENT_READY en produccion tras el rol
  IAM. Storage/IAM/sesion cerrados.
- hallazgo: el telefono reporta standalone pero la app no tiene manifest; la pagina
  no corre en una pestaña de Chrome (acceso directo/TWA/WebView).
- feat(QA): describeContainer (Client Hints, display-mode, referrer android-app://),
  ENV y PERMISOS_SITIO; prueba GALERIA (showPicker) con QA_SHOWPICKER_ERROR.
- fix(UX): aviso de selector bloqueado sugiere Chrome directo fuera de pestaña + permisos.
- test: 310 unit + 42 rules; QA local 52/52. Deploy hosting:app, bundle index-C1lvn0lb.js.

## 2026-09-11 — storage/unauthorized: falta rol IAM; DIALOG_OPENED era falso positivo (8b2a7f0)

- causa (solo lectura): la cuenta de servicio de Storage no tiene
  roles/firebaserules.firestoreServiceAgent; las Storage Rules con firestore.exists()
  niegan al asesor (el Owner pasa por UID/email). Reglas desplegadas = repo. El
  CLI solo otorga el rol en modo interactivo. Fix: lo otorga Eduardo (ver PROJECT_STATE).
- fix: se elimina DIALOG_OPENED por blur; hechos: TAP, PICKER_REQUESTED, WINDOW_BLUR,
  PAGE_HIDDEN, CHANGE {ms}, cancel nativo {ms, paginaOculta}; cancel < 1,2 s = Chrome
  no pudo abrir → aviso de permisos de Chrome en Android.
- fix: menu de camara cierra con change/cancel, no con focus.
- feat(QA): DOM_DIFF_CLIP_VS_PRUEBA; UPLOAD_START con bucket/ruta/operacion; AUTH_OK con
  rol/estado/coincidencia de membresia.
- test: 308 unit + 42 rules; QA local 52/52. Deploy hosting:app, bundle index-DbP0z_Kw.js.

## 2026-09-11 — La foto y el video de la cámara se perdían al volver (22a603a)

- evidencia fisica: CLIP/PHOTO/VIDEO _TAP + _DIALOG_OPENED en Android. Apertura cerrada.
- fix(causa reproducida): en Android el focus vuelve antes que el change; el focus
  cerraba y DESMONTABA el menu de camara y el archivo llegaba a un input inexistente.
  Menu siempre montado, oculto con CSS.
- feat: fotos >1,5 MB se reducen a JPEG 2048 px antes del limite de 5 MB (8,1 -> 1,3 MB).
- feat: uploadBytesResumable con _UPLOAD_PROGRESS; nombre seguro; MIME de respaldo.
- feat(voz): VOICE_BLOB_CREATED y VOICE_ATTACHMENT_READY antes del intento a Meta.
- feat(QA): registro en sessionStorage + PAGE_RELOADED_WHILE_PICKER_OPEN con aviso.
- test: 306 unit + 42 rules; QA local 52/52 (foto 8 MB, video 15 MB, video 17 MB
  rechazado con aviso, voz). Deploy hosting:app, bundle index-WA7mt1To.js.

## 2026-09-10 — Panel QA copiable y detector que explica (c833c47)

- fix(UX): "COPIA DEL CLIP DEL CHAT" -> "PROBAR CLIP AISLADO".
- feat(QA): 📋 COPIAR DIAGNOSTICO (Clipboard API + respaldo execCommand + copia manual)
  con entorno, estado del chat, controles y todos los eventos; "Diagnostico copiado".
- feat(QA): 🧹 LIMPIAR. MAX_EVENTS 24 -> 80.
- fix(QA): el detector decia "no hay controles en pantalla" cuando el composer no
  estaba dibujado; ahora explica por que (lista abierta, ventana vencida, grabando,
  ocultos) y registra CHAT_STATE. TOQUE con tipo/zona/rotulo; <CONTROL>_CLICK;
  POINTERCANCEL con scroll/viewport/zoom.
- test: 290 unit + 42 rules; QA local 49/49 (portapapeles real verificado).
  Deploy hosting:app, bundle index-RBO5RG2Y.js verificado.

## 2026-09-10 — Prueba media nativa aislada y auditoría del DOM (63b0b57)

- evidencia fisica: solo TOQUE, nunca CLIP_TAP — el click no llega al input del chat.
- feat(QA): PRUEBA MEDIA NATIVA fuera del chat (galeria/foto/video, input nativo
  visible) + COPIA DEL CLIP DEL CHAT fuera del chat; QA_*_TAP/CHANGE/DIALOG_OPENED
  con listeners nativos; lo elegido entra al pipeline del composer.
- feat(QA): data-media-control/data-media-input; auditoria por toque (<CONTROL>_AUDIT:
  renderizado, input, deshabilitado, rect, elemento en el punto, pointer-events,
  z-index), CLICK y POINTERCANCEL globales, boton DOM (CONTROL_RENDERED, DOM_*).
- fix: panel QA sobre la zona de mensajes (no tapa barra superior, cabecera ni composer).
- fix: clip/foto/video del chat con activacion nativa pura (sin showPicker,
  preventDefault ni click programatico) — mismo patron que la prueba nativa.
- test: QA local 46/46 contra build de produccion; 279 unit + 42 rules.
  Deploy hosting:app, bundle index-fxogJJZu.js verificado.

## 2026-09-10 — Puesto del vendedor reproducido en QA local y cerrado (9722be0)

- feat(QA): scripts/qa_seller_seed.mjs + scripts/qa_seller_workstation.mjs + .env.qalocal
  — Chromium tactil Android contra emuladores (Auth/Firestore/Functions/Storage),
  toques por el pipeline real y waitForFileChooser como prueba de apertura.
  37/37 contra el build de produccion, 5 min de uso continuo.
- fix: reentrada rapida rebotaba a /acceso (navegaba antes de que el store viera
  la sesion) — waitForSessionReady en codigo y dispositivo.
- fix: avisos tapaban microfono/enviar en movil — arriba y sin interceptar toques.
- fix: scrollIntoView del chat corria la cabecera — solo se desplaza la lista.
- fix: layout 100vh -> 100dvh con respaldo (barra de Chrome tapaba la barra de mensajes).
- fix: nota de voz reportaba "No se pudo subir" cuando fallaba el envio — capas separadas.
- fix: cobro desde el chat — sin codigo tecnico crudo; no dice "enviadas" si Meta
  rechaza; el asesor no escribe la moneda del negocio.
- fix: toque fantasma tras reentrada fallida (teclado bloqueado 800 ms).
- fix: catalogo vacio no manda al asesor a /catalogo; OnboardingBanner fuera del chat;
  useTeam sin rechazo sin manejar; failed-precondition al enviar = aviso de administrador.
- feat(QA): panel con etapas de subida (AUTH_OK..ATTACHMENT_READY, FAILED_AT) y voz
  (VOICE_TAP, MIC_PERMISSION_OK, RECORDER_START/STOP, VOICE_BLOB, VOICE_UPLOAD_*).
- fix(functions): FieldValue importado en setOperationalStatus/tickPresence/claimConversation.
- test: 275 unit + 42 rules + 108 functions. Deploy functions (3) + hosting:app,
  bundle index-DfQ1cHXN.js verificado en produccion.
- lectura prod: catalogo USADITOS con 0 productos; vendedoras reales en prepared;
  Meta WABA sigue BLOCKED (externo).

## 2026-09-10 — El panel QA tapaba los controles que diagnosticaba

- evidencia fisica: Chrome, no embebido, showPicker disponible. Entorno descartado.
- fix(bug propio): el panel era un bloque fijo grande con pointer-events normales y
  los toques de la prueba caian sobre el. Ahora es pointer-events-none; solo una
  pastilla chica recibe toques y no se registran.
- feat(QA): <CONTROL>_COVERED_BY — si el dedo cae dentro de la zona de un control
  (data-media-target) pero el toque lo recibe otro elemento, se registra cual.
- fix: showPicker() dentro del mismo gesto, con respaldo a la activacion nativa si
  lanza. Sin nada asincrono antes del selector (test).
- fix: OnboardingBanner solo para admin — tarjeta fija abajo con z-50 que en movil
  queda sobre la barra, y cuyos pasos llevaban al vendedor a rutas restringidas.
- test: 269/269. Deploy hosting:app, commit a025cc9, bundle index-B36aqE_u.js.

## 2026-09-10 — El dedo toca directamente el input de archivo + panel QA que se activa

- fix(bug propio): ?qa=1 solo se leia dentro del panel; el aterrizaje lo descartaba
  al redirigir y el panel nunca aparecia. Se captura en src/app/main.tsx antes de
  cualquier redireccion (verificado en produccion).
- fix: FileTapTarget — input type=file transparente cubriendo todo el boton, contenido
  con pointer-events-none. Sin label, sin click programatico, sin timers.
- auditoria: sin captura de gestos en la vista (unico preventDefault = submit del form).
- feat(QA): panel con navegador, deteccion de navegador embebido/WebView, userAgent,
  soporte tactil y de showPicker, el elemento que recibe cada toque, y por control
  TAP / DIALOG_OPENED / CANCEL / CHANGE.
- ux: acceso rapido de 1000 ms a 500 ms; seguridad sin cambios.
- test: 262/262. Deploy hosting:app, commit c499add, bundle index-CsmpP0DY.js.
- pendiente: prueba fisica de clip/foto/video con el panel activo.

## 2026-09-10 — Codigo de acceso una sola vez + clip/camara que no abrian en Android

- fix(causa raiz): los tres input type=file tenian className="hidden" (display:none).
  En Chrome Android un input de archivo con display:none NO abre el selector con
  .click() programatico; en escritorio si, por eso nunca fallo en la PC y el fix
  anterior de isUploading no cambio nada en el telefono.
- fix: inputs con sr-only + clip y opciones de camara como <label htmlFor> (activacion
  nativa, sin click programatico). El menu de camara ya no se desmonta en el mismo
  toque; se cierra al volver el foco. Candado en mediaInputs.test.ts.
- feat(QA): panel MEDIA_DIAG visible en el telefono con ?qa=1 (o SuperAdmin), sin
  depender de chrome://inspect. Registra solo pasos y metadatos no sensibles.
- feat: credencial de dispositivo (functions/src/deviceSecret.ts). 256 bits generados
  en el servidor, entregados una vez al vincularse con el codigo; en Firestore solo el
  hash. registerDevice la emite solo si la sesion salio de un login con codigo;
  loginWithDevice permite volver a entrar sin codigo tras cerrar sesion, revalidando
  todo en cada uso y con error generico ante cualquier rechazo.
- seguridad: regenerar el codigo invalida las credenciales de dispositivo de esa
  persona (recuperacion). Revocar el equipo tambien las anula. El deviceId sigue sin
  ser un factor de autenticacion.
- ux: cerrar sesion conserva identidad, equipo y credencial (vuelve con long press);
  cambiar de usuario los borra; revocar dispositivo los anula desde el servidor.
- fix: LandingRedirect ya no decide con el rol vacio (habria mandado a un Owner a las
  conversaciones justo despues de entrar).
- test: 260/260 unitarios + 42/42 Rules + 86/86 E2E (13 nuevos de la reentrada).
- deploy: functions:registerDevice,loginWithDevice,setVendorPin + hosting:app.
  Commits 85e7ad8 y bd128ea. Bundle index-CoP4cktI.js verificado.
- nota: el telefono de prueba se vinculo ANTES de este deploy y no tiene credencial:
  necesita entrar UNA vez mas con el codigo para recibirla.

## 2026-09-10 — Clip y camara morian junto con la nota de voz

- fix(causa mas probable): isUploading lo pone SOLO el envio de la nota de voz pero
  deshabilitaba tambien el clip y la camara. Si queda pegado — y puede: recorder.stop()
  codifica el MP3 en el hilo principal, segundos con la UI congelada — los cuatro
  controles multimedia mueren juntos, que es el sintoma reportado. El clip y la camara
  dejan de mirar ese estado; el boton de microfono lo conserva.
- fix: se cede un frame antes de codificar, para que el spinner alcance a pintarse.
- auditado y SIN cambios necesarios: los tres input.click() ya ocurren sincronamente
  dentro del onClick (sin setTimeout/await/modal de por medio) y los inputs viven en el
  mismo bloque JSX que sus botones, asi que los refs no pueden ser null por render
  condicional. Igual ahora se registra el estado del ref en cada toque.
- feat(diagnostico): logs [MEDIA_UI] y [VOICE] paso a paso, sin datos sensibles, para
  ver por chrome://inspect exactamente donde se corta el flujo en el telefono.
- fix: el envio de la nota de voz pasa por reportOutboundResult; un rechazo de Meta se
  explica en vez de fallar en silencio.
- test: 238/238. Deploy hosting:app, commit a962812, bundle index-UbHfOzd4.js verificado.
- pendiente: no se pudo reproducir el fallo (llegar a /conversaciones requiere sesion
  real). Si persiste, hacen falta los logs del telefono.

## 2026-09-10 — Adjuntos: solo clip y camara; el Asesor entra directo a WhatsApp

- ux: se elimina el boton extra de imagen (lo habia agregado yo en el deploy
  anterior) y el de documentos, que abria 'Recientes'/el file manager. Quedan dos
  botones: Clip (fotos y videos, accept image/video SIN capture) y Camara (solo
  Tomar foto / Grabar video, ambos con capture). 3 inputs, 2 botones, sin audio ni
  documentos en el accept, sin galeria duplicada.
- nota: desde la web no existe forma de invocar una app concreta de galeria de
  Android. accept + ausencia de capture es lo mas especifico disponible; que
  selector aparece lo decide el sistema. No se agrego ningun hack.
- ux: LandingRedirect resuelve el destino de '/' por rol — /conversaciones para el
  Asesor, /dashboard para Owner/Admin/SuperAdmin. Aplica a login con codigo, acceso
  rapido y reentrada. Los deep links no se tocan y /mi-turno sigue accesible (el
  estado operativo esta en la barra de MainLayout).
- test: 238/238 (4 nuevos del aterrizaje por rol). Deploy hosting:app, commit
  8c1fdc4, bundle index-CrlPEnTj.js verificado en produccion.
- pendiente: causa del fallo de upload en el telefono, y camara/video/audio sin
  probar fisicamente.

## 2026-09-10 — P0 vendedor: un adjunto fallido ya no expulsa, y galeria/camara simplificadas

- fix(bug propio): handleSellerError trataba storage/unauthorized como sesion muerta
  y hacia signOut. Ese codigo puede ser una Rule, una ruta o un limite. Ahora es
  SOSPECHA: se fuerza un refresh real del ID token y solo se reautentica si Firebase
  confirma token expirado / usuario deshabilitado / token invalido. Un fallo de red
  tampoco expulsa.
- fix(bug propio): los tres pipelines apilaban el mismo aviso tres veces con tres
  redirecciones. Deduplicacion por causa con ventana de 8s.
- ux: el menu confuso de Android (Camara, otra Camara, Grabadora, Fotos) lo producia
  el accept del boton Adjuntar, que mezclaba image/video/audio. Ahora: 'Fotos y
  videos' (sin capture), 'Camara' con solo Tomar foto / Grabar video, y
  'Documentos' aparte con accept solo de PDF/Office. Se quito la 'Galeria'
  duplicada del menu de camara.
- ux: long press de acceso rapido de 2s a 1s; anillo, cancelacion, haptic y sonido
  intactos. Sin cambios en el modelo de seguridad.
- test: 234/234 (12 nuevos). Deploy hosting:app, commit 26aa987, bundle
  index-DjV4IxHS.js verificado en produccion.
- pendiente: la causa del fallo de upload EN EL TELEFONO sigue sin determinar (las
  Rules pasan 8/8 y Storage esta sano). Ahora el fallo no expulsa y deja mensaje
  especifico + log, para poder capturarlo. Camara, video y audio sin probar fisicamente.

## 2026-09-10 — P0 puesto de vendedor: una sesion muerta rompia texto, adjuntos y notas de voz

- auditoria: Storage sano (bucket, facturacion y escritura con Admin SDK OK) y CERO
  archivos subidos en chat-attachments del tenant. Las Storage Rules NO son la causa:
  scripts/diag_chat_upload_rules.mjs las ejercita con el shape real (Asesor con
  membership {uid}_{tenantId}) y pasan 8/8 — imagen, video, audio webm/opus, audio/mp4,
  nombre con espacios, contentType vacio, aislamiento cross-tenant y limite de 20MB.
  Y sendWhatsappMessage no registra NI UNA invocacion del tenant ni de hoy: al tocar
  enviar, la funcion nunca se ejecuta.
- causa raiz unica: al regenerar el codigo de acceso, setVendorPin revoca los refresh
  tokens (deliberado). Confirmado en produccion: tokensValidAfterTime coincide EXACTO
  con pinSetAt en las dos credenciales. El telefono queda 'abierto' pero sin poder
  renovar el token, y fallan A LA VEZ el texto (callable unauthenticated), los adjuntos
  y las notas de voz (storage unauthorized). Al recargar, pide codigo.
- fix: src/utils/sellerErrors.ts traduce por capa y detecta la sesion caida — un solo
  mensaje accionable y vuelta a /acceso, en vez de tres errores genericos distintos.
  Microfono y camara denegados dicen QUE HACER. El detalle tecnico sigue en consola.
- fix: los rechazos de Meta se traducen en TODOS los envios (antes solo en video, con
  el texto crudo 'An unknown error has occurred').
- ux: en el drawer de venta, 'Cobrar / Enviar pago' pasa a accion primaria — verde,
  grande, primera y a ancho completo en movil. Antes era el ultimo chip pequeno.
- fix(bug propio): el boton 'Cotizar' del chat navegaba a /cotizaciones, que para un
  Asesor ahora es 'Acceso restringido'. Ahora le deja la plantilla lista en el mensaje;
  Owner/Admin sigue abriendo el modulo.
- EXTERNAL_BLOCKER confirmado hoy (solo lectura): WABA 1659672582339181 con
  can_send_message=BLOCKED — 141006 metodo de pago, 141008 WABA no activa, 141010
  verificacion de negocio pendiente. El outbound no depende de SmartFlow.
- test: 228/228 (22 nuevos) + 8/8 del diagnostico de Rules. Deploy: hosting:app.
  Commits 036ff3b y 9b356a5.
- pendiente: verificacion fisica en el telefono (reentrada, adjuntos, camara, nota de
  voz) y el ciclo producto->cotizacion->cobro de punta a punta.


## 2026-09-10 — La sesión no persistía: por eso pedía el código en cada apertura

- fix(causa raíz): `src/lib/firebase.ts` hacía `getAuth(app)` a secas. El SDK
  elige el default y, si IndexedDB no está disponible (móviles con
  almacenamiento restringido, modo ahorro, ajustes de privacidad), cae a
  persistencia EN MEMORIA sin avisar: la sesión moría al cerrar la app y el
  vendedor tenía que escribir su código otra vez. Ahora se declara la cadena
  explícita `indexedDBLocalPersistence` + `browserLocalPersistence`.
- fix: `browserPopupRedirectResolver` explícito — `initializeAuth` NO lo incluye
  solo (a diferencia de `getAuth`) y sin él `signInWithPopup`, o sea el login con
  Google, dejaría de funcionar. Verificado en navegador que Google, correo y
  contraseña siguen ahí y que la app monta sin errores de consola. try/catch con
  `getAuth` de respaldo porque `initializeAuth` lanza con el recambio en caliente.
- fix(ruteo): `ProtectedRoute` mandaba a `/login` a cualquiera sin sesión,
  incluido un vendedor con identidad recordada — aterrizaba en la pantalla
  corporativa, que no le sirve. Ahora, si este equipo ya fue usado, va derecho a
  `/acceso`, que decide solo: entrada rápida si la sesión sigue viva, o código si
  hace falta. No cambia nada de seguridad: ambas exigen lo mismo.
- ux: el código queda como mecanismo de alta y recuperación (equipo nuevo,
  revocado, cambio de usuario, código regenerado, sesión inválida) y deja de ser
  un peaje diario.
- qa: verificado a 375x812 local y en producción — sin identidad → `/login`; con
  identidad → `/acceso` saludando por nombre. 206/206 tests, build limpio.
- deploy: `hosting:app`. Commit `162c605`. Bundle `index-OrtWLMSS.js`.
- pendiente: que la sesión sobreviva de verdad al cerrar y reabrir la app en el
  teléfono, y la sensación física del long press. Requieren cuenta real.



## 2026-09-10 — /login prioriza el acceso del equipo sobre el corporativo

- ux: el bloque "Acceso del equipo" pasa arriba, con el botón principal grande
  "Entrar con código de acceso" y un saludo "Hola <nombre>" cuando este equipo
  ya fue usado. "Acceso corporativo" (Google + correo/contraseña) queda debajo,
  con los mismos handlers y enlaces: sin regresión.
- ux: "Cambiar de usuario" también desde `/login` — borra identidad Y deviceId.
- nota: el "mantener presionado" NO puede vivir en `/login`. Solo tiene sentido
  con la sesión de Firebase viva, y con sesión viva esa pantalla ni se muestra
  (la app redirige derecho adentro). El long press vive en `/acceso`. Que el
  vendedor pase siempre por esa pantalla al abrir sería una decisión aparte:
  agregaría 2 segundos a cada apertura de un flujo hoy instantáneo.
- qa: verificado en navegador a 375x812 (botón del equipo visible sin scroll,
  260-324 de 812) y a 1440x900, sin scroll horizontal; "Cambiar de usuario"
  comprobado sobre `localStorage` real; y en producción, orden correcto y botón
  sin scroll (bundle `index-SnMMbySx.js`).
- deploy: `hosting:app`. Solo jerarquía visual y copy; sin cambios de seguridad.

## 2026-09-10 — Preset final del Asesor Comercial: solo atención y ventas

- feat: menú del Asesor = Dashboard, Mis Tareas, CRM, WhatsApp, Agenda. Ocultos y
  denegados por ruta directa: Paquetes, Tienda Hub, Cobros, Cotizaciones,
  Catálogo, Usuarios, Mi Suscripción, Multi-Agente, Agente IA, Auditor IA,
  Integraciones y Configuración.
- auditoría (antes de tocar nada): `hasTool`/`getEffectiveTools`/`allowedTools`
  se usaban SOLO en ToolGuard, MainLayout y la ficha de usuario. Ningún módulo de
  conversaciones ni de CRM ataba una acción comercial a esos permisos, así que
  MODULE_ACCESS y COMMERCIAL_ACTION ya estaban separados: no hubo que
  desacoplar nada.
- test: `commercialActionsDecoupled.test.ts` es el candado de esa separación —
  lee el código de conversaciones y CRM (con `import.meta.glob`) y falla si
  alguien mete un permiso de navegación dentro de una acción comercial. Verifica
  además que el drawer de catálogo, el modal de cobro y la plantilla de
  cotización sigan estando en la conversación.
- feat: `ADVISOR_TOOLS` = crm, conversaciones, agenda. `ADMIN_ONLY_TOOLS` suma
  catalogo, cotizaciones y pagos (sus MÓDULOS son configuración: productos
  maestros, plantillas, cuentas de cobro). El preset "Vendedor" de la ficha se
  alinea con el rol.
- fix(rutas): `/cotizaciones`, `/catalogo`, `/paquetes` y `/pagos` suman
  `RoleGuard(Admin, Owner)`. `/tienda` y `/paquetes` NO TENÍAN NINGÚN GUARD.
  En el menú, Paquetes y Tienda Hub pasan a `adminOnly`.
- fix(seguridad, firestore.rules): el catálogo permitía create/update/delete a
  cualquier `isTenantMember` — un asesor podía alterar los productos maestros
  saltándose la UI. Leer sigue abierto a todo miembro activo (lo necesita desde
  la conversación); crear, editar y borrar exigen `isTenantAdmin`. `packages` ya
  estaba bien; `quotes` y `payment_requests` se dejan como estaban a propósito:
  crear una cotización o un enlace de cobro ES una acción comercial del asesor.
- sin cambios funcionales en backend: Multi-Agente, Agente IA y Auditor IA siguen
  trabajando por debajo; solo sus paneles son de Owner/Admin. No se tocaron el
  outbound de Meta, los pagos externos, el acceso por código, Presence ni el
  routing del Multi-Agente.
- test: 206/206 unitarios + 42/42 de Rules (7 nuevas del catálogo). El test del
  menú exige que el del asesor sea EXACTAMENTE esos 5 ítems, ni uno más.
- deploy: `hosting:app` + `firestore:rules`. Commit `f3532d9`. Bundle verificado
  (`index-K1efxHg1.js`).


## 2026-09-10 — P0: el Asesor Comercial veía y podía abrir todo el menú administrativo

- fix(causa raíz): `ROLE_DEFAULT_TOOLS` devolvía `ALL_TOOL_KEYS` para TODOS los
  roles. Como ninguna membership tiene `allowedTools`, el Asesor caía en ese
  fallback y recibía las 12 herramientas. El rol se cargaba bien tras
  `loginWithPin` — no se usaba para nada en `permissions.ts`.
- fix(segundo agujero): `getEffectiveTools` nunca aplicaba el techo por rol que
  su propio comentario prometía; una lista explícita con herramientas
  administrativas se las concedía igual a un Asesor. Ahora se recorta ahí, en un
  solo lugar, así menú y guards no se desincronizan.
- feat: `ADVISOR_TOOLS` = crm, conversaciones, pagos, cotizaciones, catalogo,
  agenda. Cobros INCLUIDO (el vendedor genera enlaces de pago para sus clientes).
- feat: `ADMIN_ONLY_TOOLS` suma multi-agent, ai-agent y auditoria — sus PANELES
  son administrativos; los procesos de fondo siguen corriendo para todos.
- fix(rutas): `/ai-agent`, `/multi-agent` y `/auditoria` suman
  `RoleGuard(Admin, Owner)` además del ToolGuard. `/suscripcion` NO TENÍA NINGÚN
  GUARD y cualquier vendedor la abría por URL: ahora también.
- refactor: el filtro del menú sale de `MainLayout` a `navigationAccess.ts` para
  poder probarlo (el mismo `<aside>` sirve escritorio y móvil). "Mi Suscripción"
  no tenía `toolKey` ni filtro: ahora es `adminOnly`.
- fix(Cobros): las tarjetas de configuración financiera (PayPal, SINPE, cuentas
  bancarias) pasan a ser solo de Owner/Admin, igual que confirmar pagos manuales.
  El Asesor sigue creando cobros y copiando el enlace. Resto de la lógica intacto.
- test: 200/200 (22 nuevos). El test del menú corre contra el array REAL de
  MainLayout, así que atrapa cualquier ítem administrativo nuevo sin protección.
- nota: `Técnico` y `Solo lectura` quedan con el fallback amplio (no fueron parte
  del pedido, no hay usuarios de esos roles en USADITOS); igual los recorta
  `ADMIN_ONLY_TOOLS`. `Tienda Hub` y `Paquetes` no estaban en ninguna lista.
- deploy: `hosting:app`. Commit `080d83d`. Bundle verificado (`index-Dz901kVb.js`).

## 2026-09-10 — Entrada rápida en equipo reconocido (mantener presionado) + "código de acceso"

- feat: en `/acceso`, con la sesión de Firebase viva, "Hola <nombre>" + botón de
  encendido que hay que mantener 2 s, con anillo de progreso, vibración y una
  firma sonora corta. Fallbacks siempre visibles: "Usar código de acceso" y
  "Cambiar de usuario" (que ahora además cierra la sesión).
- seguridad: el gesto NO autentica ni reemplaza al código. Solo aparece con
  sesión viva (el refresh token es la credencial real del equipo). El `deviceId`
  no es un factor: lo genera el cliente y vive en localStorage. Sin sesión viva
  se sigue pidiendo el código. Nada de PIN en texto plano.
- feat: `verifyDeviceSession` revalida en el SERVIDOR cada entrada rápida
  (membership activa, equipo registrado, no revocado, mismo uid, mismo tenant) y
  dice qué hacer si falla: pedir código o cerrar sesión.
- feat: firma sonora de 420 ms sintetizada con Web Audio — sin archivo ni CDN (la
  CSP bloquea media externa), pico bajo, solo tras entrar. Háptico que respeta
  "reducir movimiento" y que en iOS simplemente no hace nada.
- ux: "PIN" pasa a llamarse "código de acceso" en los 15 textos visibles.
- test: 73/73 E2E contra emuladores reales (antes 65) + 155/155 unitarios.
- deploy: `functions:verifyDeviceSession` + `hosting:app`. Commit `6f60780`.
- pendiente: la interacción física del botón y el menú del Asesor en pantalla
  necesitan una sesión real; no puedo autenticarme en la app.


## 2026-09-10 — Las rutas de la app se cacheaban 1 hora: los deploys tardaban en verse

- auditoría: el bundle vivo SÍ tenía el botón. `/login` servía
  `assets/index-DVmho5XI.js` (mismo hash que el build de `9894187`, que está en
  `main`) y los 5 strings buscados estaban presentes. No hay service worker
  (`sw.js` devuelve `text/html` por el rewrite). Verificado además en un
  navegador limpio contra producción: botón visible, 56px, lleva a `/acceso`.
- fix(hosting, causa raíz): la regla de `no-store` estaba escrita para el path
  literal `/index.html`, pero todas las rutas de la app se sirven por el rewrite
  `**` -> `/index.html`, y Firebase aplica los headers por el path PEDIDO, no
  por el archivo servido. Cada ruta caía en el `max-age=3600` por defecto, así
  que un navegador podía quedarse hasta una hora con el HTML viejo y su bundle
  viejo. Afectaba a TODOS los deploys, no solo a este.
- fix: la regla `**` incluye ahora `no-cache, no-store, must-revalidate`, y se
  agrega `/assets/**` con `max-age=31536000, immutable` (los assets llevan hash,
  son inmutables — mejor rendimiento que el 3600 anterior).
- verificación post-deploy: `/login`, `/acceso`, `/usuarios` e `/index.html` con
  `no-store`; `/assets/index-*.js` con `max-age=31536000, immutable`. En el
  navegador: "Acceso corporativo" (Google + correo/contraseña + invitado) y
  "Acceso del equipo" (Entrar con PIN -> /acceso), todo presente.
- deploy: `hosting:app` únicamente. Commit `2c4bf21`, ya en `main`. Sin cambios
  de código, Functions ni Rules.


## 2026-09-09 — /login deja entrar también al equipo (usuario + PIN), sin depender del enlace

- feat(UI): `/login` mantiene intacto el acceso corporativo (Google +
  correo/contraseña) y suma abajo el bloque "Acceso del equipo" con el botón
  "Entrar con PIN" -> `/acceso`. Antes, un vendedor con la sesión cerrada caía
  en `/login` sin ninguna vía para volver: dependía de conservar el enlace de
  WhatsApp, porque su cuenta técnica usa un password aleatorio que nadie conoce.
- feat(UI): `/acceso` con dos modos — dispositivo reconocido ("Hola <nombre>" +
  solo PIN + "Cambiar de usuario") y dispositivo nuevo (campo Usuario + PIN).
  Antes, sin el enlace de alta mostraba "Este enlace no es válido".
- fix(UI): "Cambiar de usuario" borra identidad Y deviceId — si solo borrara la
  identidad, la persona siguiente heredaría la confianza del equipo anterior.
- feat(backend): `tenantId` pasa a ser OPCIONAL en `loginWithPin`. Sin él, el
  negocio se resuelve internamente por `loginHandle`; nunca se le pide al
  vendedor un tenantId ni otro dato técnico. Como `loginHandle` es único por
  tenant y no globalmente, puede haber varios candidatos: el PIN desambigua y
  cada intento fallido cuenta en su propia credencial.
- feat(backend): la respuesta suma `tenantId`/`loginHandle`/`displayName`
  DESPUÉS de autenticar (lo que el cliente necesita para registrar el
  dispositivo y recordar quién es). `displayName` sale de la membership, nunca
  del correo técnico interno; no se devuelve `authUid` ni ids de credencial.
- fix(seguridad): el cupo de rate limit se cuenta por usuario (`pin:<handle>`)
  en vez de tenant+usuario — con `tenantId` opcional, la clave anterior se podía
  esquivar alternando entre mandarlo y no mandarlo.
- fix: el registro del dispositivo dejó de poder bloquear el login. Si el equipo
  fue revocado por un Admin, se pide una vinculación nueva (deviceId nuevo) de
  forma transparente. La persona ya está autenticada por PIN; el device trust es
  confianza, no la puerta de acceso.
- test: 65/65 E2E contra emuladores reales (antes 53) — usuario+PIN sin
  tenantId, PIN incorrecto DENY, usuario inexistente con el MISMO error
  genérico, no entra declarando otro tenant, desactivado DENY por esta puerta,
  reactivado vuelve a entrar, dispositivo reconocido solo con PIN, la respuesta
  no filtra authUid/ids/correo interno, y el rate limit bloquea. El E2E ahora
  espera y reintenta cuando satura su propia ventana de rate limit (el script
  hace muchos más logins seguidos que una persona real).
- test(UI): verificado en navegador a 375x812 y 1440x900 — las dos secciones,
  botón de 56px dentro del viewport, sin scroll horizontal, los dos modos de
  `/acceso` y "Cambiar de usuario" limpiando identidad y deviceId.
- deploy: `functions:loginWithPin` + `hosting:app`. Commit `9894187`, ya en
  `main`. Bundle verificado en producción (`index-DVmho5XI.js`). Sin tocar
  WhatsApp, Payments, Multi-Agent, IA ni el acceso con Google.


## 2026-09-09 — FIX URGENTE: un PIN recién generado no dejaba entrar (regresión de `2c106ca`)

- fix(regresión propia, no el bug original): `repointLoginHandle` dejaba
  `login_handles.membershipId` en el ID actual de la membership, pero
  `setVendorPin` escribía el PIN nuevo en el doc de credencial donde ya estaba
  (un ID viejo), y `loginWithPin` derivaba el doc de credencial de ese mismo
  campo del índice: buscaba `vendor_credentials/{idActual}`, no existía, y
  cortaba con el error genérico ANTES de comparar ningún hash. Las dos mitades
  del par apuntaban a lados opuestos. Afectaba a los DOS usuarios con PIN del
  tenant, incluido EDUARDO ADMIN.
- auditoría (solo lectura, sin regenerar ni migrar): `pinHash`/`pinSalt` estaban
  bien escritos en ambas credenciales y `failedAttempts` era 0 — nunca se
  llegaba a la verificación. No hizo falta manipular el PIN en texto plano.
- fix: `setVendorPin` mueve la credencial a su lugar canónico
  (`vendor_credentials/{membershipId}`) en un batch atómico ANTES de escribir el
  PIN nuevo, y sincroniza el índice DESPUÉS — nunca al revés.
- fix: `login_handles` guarda `credDocId` (dónde está la credencial) y `authUid`
  (el único identificador que no cambia nunca).
- fix: `loginWithPin` resuelve la credencial en cadena —  `credDocId` → lugar
  canónico → por `loginHandle` dentro del tenant → por `authUid`. Con el índice
  desfasado el login entra igual en vez de mentir "PIN incorrecto", y el filtro
  por tenant se aplica en cada paso (la red de seguridad no cruza negocios).
- fix: `acceptTenantInvite` escribe `credDocId`/`authUid` en el MISMO batch en
  que mueve la credencial.
- test: el hueco era que el E2E verificaba que regenerar sobre una credencial
  desubicada fuera ALLOW, pero nunca intentaba entrar con el PIN nuevo.
  Secciones 12 y 13: login con el PIN recién generado (el caso reportado, falla
  con el código anterior), PIN viejo DENY, credencial canónica y la vieja
  borrada, índice con `credDocId`/`authUid`, login repetido (recarga / volver a
  entrar), índice roto a propósito recuperándose solo, y sin cruzar tenants.
  53/53 E2E (antes 44) + 134/134 unitarios + 35/35 Rules.
- verificación post-deploy en producción (solo lectura): ambos usuarios
  resuelven su credencial por la red de seguridad de `loginHandle`, con hash y
  salt intactos, 0 intentos fallidos, sin bloqueo y membership `active` → login
  habilitado CON EL PIN QUE YA TIENEN. No hace falta regenerar ni migrar.
- deploy: `functions:loginWithPin,setVendorPin,acceptTenantInvite`. Commit
  `7e78e52`, ya en `main`. Sin frontend, sin Rules, sin WhatsApp/Payments/IA.
- pendiente: prueba real en teléfono con el PIN ya generado. No regenerar antes
  de probar — regenerar invalida el PIN de la pantalla anterior.


## 2026-09-09 — FIX URGENTE: el ciclo de acceso por PIN estaba roto de punta a punta

- fix(causa raíz única, verificada contra datos de producción):
  `vendor_credentials` usa el ID de la membership como doc id y `login_handles`
  guarda ese mismo ID, pero `acceptTenantInvite` re-indexa la membership a
  `{uid}_{tenantId}` y borra el doc original en el primer acceso, sin mover la
  credencial ni repuntar el índice. Las 2 credenciales de USADITOS apuntaban a
  IDs de membership inexistentes.
- fix(1): `getVendorAccessInfo` decía "PIN no configurado" sobre alguien que sí
  tenía acceso.
- fix(2): `setVendorPin` caía en el guard de prepared/draft y rechazaba — el
  estado muerto reportado ("ya tiene un método de acceso configurado").
- fix(3, NO reportado y más grave): `loginWithPin` leía `memberships/{idViejo}`
  (borrado) y denegaba el acceso a cualquier vendedor que ya hubiera entrado
  una vez, con el mismo mensaje que un PIN incorrecto. Seguían trabajando solo
  porque su sesión de Firebase ya estaba abierta.
- fix(4): el chequeo `status==='active'` de `c43549b` rompía también el PRIMER
  acceso (`setVendorPin` deja la membership en `pending` a propósito, porque es
  el primer `signInWithCustomToken` el que dispara `acceptTenantInvite`): ningún
  vendedor nuevo podía entrar. Ahora `pending` se acepta solo mientras la
  membership no tenga `userId` (desactivar escribe `suspended` y conserva el
  `userId`, así que no se reabre el agujero que ese chequeo cerró). El test que
  afirmaba `pending -> DENY` codificaba el bug y se corrigió con el motivo.
- feat: `functions/src/accessLifecycle.ts` — máquina de estados explícita del
  acceso (`no-access`, `pending-first-login`, `active-with-access`,
  `active-without-access`, `suspended`) y la acción de negocio de cada uno.
  Ningún estado sin acción: el suspendido sin PIN ofrece "Reactivar y generar
  acceso" en un solo paso.
- feat: `setVendorPin` con modos `bootstrap`/`attach`/`regenerate`. `attach` es
  el camino que faltaba: engancha una credencial nueva al uid de Auth que ya
  existe, sin crear identidad nueva ni perder historial.
- fix: la credencial se resuelve por `authUid` cuando no está bajo el ID actual
  (los datos ya desfasados se curan solos, sin migración destructiva);
  `acceptTenantInvite` mueve credencial + índice en el MISMO batch que la
  membership; `loginWithPin` lee la membership canónica `{authUid}_{tenantId}`.
- fix(seguridad): regenerar invalida siempre el PIN anterior y ahora además
  revoca los refresh tokens — con un PIN filtrado o un teléfono perdido, dejar
  viva la sesión anterior hacía inútil el PIN nuevo.
- feat(UI): `getTenantAccessOverview` (una llamada por tenant) da el estado real
  de cada fila con la MISMA máquina de estados del backend, y la lista muestra
  UNA acción principal en lenguaje de negocio: Generar acceso / Copiar acceso /
  Reactivar / Reactivar y generar acceso. Las reglas no se duplican en el
  cliente — eso es lo que producía botones que el backend rechazaba. Antes la
  fila mezclaba hasta 5 íconos con significados solapados.
- fix(UI): la columna de estado mostraba "Vía: Email/Password" para vendedores
  por PIN, cuya cuenta técnica usa un password aleatorio que nadie conoce ni
  puede usar. Ahora dice "Vía: PIN + dispositivo".
- chore: `FieldValue`/`Timestamp` desde `firebase-admin/firestore` SOLO en las
  funciones del ciclo de acceso — el stub del emulador de Functions no expone
  esos estáticos en `admin.firestore` (le rompe igual a `registerDevice`,
  preexistente) y sin eso el ciclo no se puede probar de punta a punta. Misma
  clase y comportamiento en producción.
- test: 134/134 unitarios (31 nuevos) + 35/35 de Rules (intactas) + 44/44 del
  E2E nuevo `scripts/e2e_access_cycle.mjs` contra emuladores reales de
  Functions + Firestore + Auth (ciclo completo, autorización, cross-tenant y la
  credencial huérfana exacta de producción).
- deploy: `functions:acceptTenantInvite,setVendorPin,getVendorAccessInfo,`
  `getTenantAccessOverview,loginWithPin,registerDevice,revokeDevice,`
  `setMembershipActive` + `hosting:app`. Commit `2c106ca`, ya en `main`. Bundle
  verificado en producción (`index-5DrEWglM.js`).
- verificación: estado de acceso real de USADITOS recalculado con la lógica
  desplegada — 0 callejones sin salida; los 2 usuarios con PIN resuelven por
  `authUid` y las 8 filas restantes ofrecen "Generar acceso".
- pendiente: E2E de producto con teléfono real (no puedo autenticarme en la
  app). No activar vendedoras reales hasta que Eduardo cierre ese ciclo.


## 2026-09-09 — FIX URGENTE: el Owner local solo veía su propio usuario en /usuarios

- fix(causa raíz del cliente, NO de las Rules): `useUserStore.subscribe` hacía
  `getUserProfile(m.userId)` —un `getDoc` sobre `users/{uid}`— por cada
  compañero de equipo dentro de un `Promise.all`. Las Rules de `users/` solo
  permiten leer el perfil propio o SuperAdmin (PII), así que el perfil ajeno
  tiraba `permission-denied` y una sola promesa rechazada tiraba TODO el lote:
  `set({teamMembers})` no volvía a correr. Por eso el SuperAdmin sí veía al
  equipo completo (él puede leer cualquier `users/{uid}`) y el Owner no.
- fix(por qué era 1 fila y no cero): `AuthService.getUserMemberships` deja la
  membership propia en el cache local de Firestore al entrar; el primer
  snapshot de `/usuarios` llega desde ese cache con ese único doc (perfil
  propio → legible → lote OK → `teamMembers=[él mismo]`), y el snapshot del
  servidor con los 10 miembros rompía el lote y congelaba el estado ahí.
- fix: el callback ya no lee `users/{uid}` de nadie — la membership ya trae
  `name`/`email`. Pasó de `async`+`Promise.all` a un `map` síncrono y
  `UserService.getUserProfile` se eliminó (sin otros usos; el de `AuthService`,
  que lee el perfil propio, intacto).
- test: 7 escenarios nuevos en `firestore.rules.test.ts` contra el emulador
  real — Owner y Admin activos ven el tenant completo (active/prepared/pending/
  suspended, incluidos `userId:null`), el Asesor no gana permisos de
  administración, cruce de tenants denegado, SuperAdmin intacto. **Las Rules no
  se tocaron**: la query de `memberships` nunca fue el problema.
- verificación de datos: script de solo lectura sobre `t-1788554584458` (10
  membresías) — el único doc sin `name` es la invitación `pending` con
  `userId:null`, que ya caía en el mismo fallback de antes. Cero regresión de
  nombres. `eduardo pruebas` está hoy **suspended**.
- ux(derivado): `displayMemberEmail()` deja de mostrar el correo técnico interno
  (`vendedor.*@*.usuarios.smartflow.internal`) de los vendedores PIN en la
  lista y pone "Acceso por PIN (sin correo)". 4 tests nuevos.
- tests: 95/95 unitarios + 35/35 de Rules. Typecheck y build limpios.
- deploy: `hosting:app` únicamente — sin Functions ni Rules. Commit `bc6cd09`,
  ya en `main`. Bundle en producción verificado (`index-Cx1vhmFb.js`, mismo
  hash del build, contiene el string nuevo).
- pendiente: validación visual de Eduardo en `/usuarios` con recarga forzada
  (Ctrl+Shift+R). No se activan vendedoras reales hasta cerrar el ciclo de QA.


## 2026-09-09 — AJUSTE UX: modal de acceso maneja el caso "usuario sin PIN"

- fix: un usuario active/pending sin PIN generado (nunca tuvo
  `vendor_credentials`) no tenía forma de arrancar su acceso desde
  Usuarios — 🔗 solo mostraba un toast, y el botón 🔑 dedicado solo aparece
  en filas prepared/draft. `VendorAccessData` suma `pinConfigured:boolean`
  (+ `membershipId`): en `false`, el modal no muestra usuario/enlace/PIN ni
  ningún botón de copiar (nada de eso existe todavía, y mostrarlo
  implicaría que el vendedor ya puede entrar) — solo un aviso claro "PIN no
  configurado" + un botón primario "Generar PIN". Al generarlo, el MISMO
  modal pasa al estado ya existente ("recién generado": PIN visible una
  vez, Copiar PIN/enlace/mensaje habilitados) sin cerrarse.
- deploy: `hosting:app` únicamente — sin cambios de backend
  (`setVendorPin`/`getVendorAccessInfo`/Rules intactos). Commit `69ae189`,
  ya en `main`.

## 2026-09-09 — FIX URGENTE: ícono 🔗 abría /login en vez del enlace real de acceso

- fix(bug real confirmado): la rama `else` de `renderActions` (mostrada para
  cualquier usuario que no fuera prepared/draft — incluidos los de acceso
  por PIN como "eduardo pruebas") copiaba `https://hub.smartflow-suite.com`
  a secas — el link raíz, que resuelve a `/login` para cualquiera sin
  sesión. Lógica vieja, pensada solo para invitación por email, nunca
  actualizada cuando se agregó el acceso por PIN.
- fix: 🔗 ahora llama a la función nueva `getVendorAccessInfo` (reusa
  `checkTenantAdminAuth`, mismos 7 tests de siempre) que devuelve ÚNICAMENTE
  el `loginHandle` — nunca el PIN ni su hash (`vendor_credentials` sigue
  con `allow read, write: if false`) — y abre `VendorAccessModal` en modo
  "ver" (`pin: null`, sin fila de PIN, sin inventar ni mostrar uno viejo).
  "Generar nuevo PIN" (🔑) sigue siendo la única acción que efectivamente
  muestra un PIN, una sola vez, recién generado.
- refactor: `buildAccessLink`/`buildFullMessage`/`copyToClipboard`/
  `VendorAccessData` extraídos a `vendorAccessHelpers.ts` (7 tests, 5
  nuevos — cubren el caso real "eduardo pruebas"/`t-1788554584458`, tildes,
  nombres con espacios/símbolos, y que nunca construye sobre `/login`). De
  paso corrige un `react-refresh/only-export-components` que ya existía
  antes de este cambio.
- deploy: `functions:getVendorAccessInfo`, `hosting:app`. Commit `5766cc2`,
  ya en `main`.

## 2026-09-09 — FIX URGENTE: sincronización móvil + Presence OFFLINE + Invalid Date

> Los 3 síntomas, causa raíz real (confirmada leyendo código, no supuesta).
> Falta que alguien vuelva a abrir `/mi-turno` después de este deploy para
> confirmarlo en un teléfono real — no lo pude hacer yo (mismo límite de
> autenticación de toda la noche). Ver `PROJECT_STATE.md`.

- fix: el botón de estado no cambiaba visualmente al instante en el
  teléfono — `handleSelect` esperaba el round-trip completo de Firestore
  antes de mostrar cualquier cambio. Agregada una capa optimista (cambia al
  tocar, se reconcilia sola con el `onSnapshot` real, revierte + muestra
  error si el backend rechaza) en `MyShiftView.tsx` y
  `OperationalStatusSelector.tsx`.
- fix(causa raíz real): `usePresenceTracker()` solo se llamaba desde
  `MainLayout.tsx` — `/mi-turno` (adonde aterriza cualquiera que entra por
  PIN) está montado standalone en `AppRouter.tsx`, nunca envuelto en
  `MainLayout`. Un vendedor por PIN nunca disparaba el heartbeat de
  presencia; el único write a su `user_presence` era de
  `setOperationalStatus`, que nunca escribe `status` ni `lastActiveAt`. Esto
  explica a la vez el badge OFFLINE atascado y el "Visto el Invalid Date".
  Fix: `MyShiftView` ahora también llama `usePresenceTracker()`.
- fix: `src/utils/formatLastSeen.ts` (nuevo, 11 tests) — nunca más muestra
  "Invalid Date" pase lo que pase con el timestamp (undefined, string no
  parseable, objeto Timestamp-like, reloj del cliente adelantado).
- deploy: `hosting:app` únicamente — sin cambios de backend. Commit
  `8f89108`, ya en `main`.

## 2026-09-09 — REQUERIMIENTO OPERATIVO CRÍTICO: reutilización de teléfonos corporativos

> Auditado el ciclo completo antes de tocar código — casi todo ya estaba
> bien construido. Un solo gap real de seguridad encontrado y corregido.
> Falta 1 prueba manual de Eduardo (no la pude correr yo, mismo límite de
> autenticación de toda la noche). Ver `PROJECT_STATE.md`.

- auditoría: confirmado leyendo código (no asumido) que Multi-Agente
  (`assignConversationAdvisor`, `claimConversation`,
  `multiAgentEligibility.ts`) ya excluye `status!=='active'`;
  `revokeDevice`/`renameDevice` + botones ya existían con auditoría real;
  `forgetDeviceAndIdentity()` ya evita que un usuario nuevo en el mismo
  teléfono herede el `deviceId`/identidad del anterior.
- fix(seguridad, todos los tenants): `loginWithPin` nunca chequeaba
  `membership.status` — un vendedor desactivado podía seguir logueándose
  mientras su PIN no cambiara. `checkPinLoginAllowed` (4 tests) lo corrige,
  con el mismo error genérico que un PIN incorrecto a propósito.
- feat: `setMembershipActive` (Cloud Function nueva, `checkTenantAdminAuth`
  — 7 tests) reemplaza el `updateDoc` directo que activaba/desactivaba
  usuarios: agrega `deactivatedAt/By`/`reactivatedAt/By`, bloquea
  auto-desactivación, y revoca los refresh tokens de Firebase Auth al
  desactivar (corta sesión ya abierta, no solo logins nuevos). No borra
  ningún historial — conversaciones/leads/CRM/métricas siguen atribuidos
  igual.
- deploy: `functions:loginWithPin`, `functions:setMembershipActive`,
  `hosting:app`. Commit `c43549b`, ya en `main`.

## 2026-09-09 — FIX UX URGENTE: popup de acceso de usuario ahora es copiable

- fix: generar el PIN de un vendedor mostraba un `alert()` nativo — texto no
  seleccionable en la práctica, sin botón de copiar. Nuevo
  `VendorAccessModal.tsx`: botones "Copiar enlace", "Copiar PIN" y, como
  acción principal, "Copiar mensaje completo" (texto listo para pegar en
  WhatsApp: Acceso SmartFlow / Usuario / PIN / Enlace / instrucción de un
  solo uso) — 3 tests sobre el formato del mensaje. Feedback "Copiado" por
  botón. `navigator.clipboard` con fallback a `textarea`+`execCommand` si
  falla o el contexto no es seguro. El PIN solo vive en el estado local del
  componente — nunca se loguea ni se persiste en otro lado. `setVendorPin` y
  su lógica de autorización no se tocaron.
- deploy: `hosting:app` únicamente, commit `38fea80`, ya en `main`.

## 2026-09-09 — FIX UX: "Ir al sistema completo" pasa a ser la acción principal en /mi-turno

- fix: en `/mi-turno`, "Ir al sistema completo" vivía al fondo con la misma
  jerarquía visual que "Cambiar de usuario" (texto gris chiquito). Nuevo
  orden: estado → **Ir al sistema completo** (botón primario, ancho
  completo, color de marca `#1877F2`, ícono de grid) → Turno de hoy →
  Cambiar de usuario (secundario, al fondo). Sin cambios a rutas ni lógica
  de turno/Presence.
- deploy: `hosting:app` únicamente, commit `1759232`, ya en `main`.

## 2026-09-09 — FIX VISUAL: botones de estado de turno (color completo al estar activo)

- fix: `OperationalStatusSelector` (dropdown del header, mobile y desktop)
  solo coloreaba un punto de 2.5px por estado — el estado activo era casi
  indistinguible salvo por una etiqueta "Actual" chiquita. Ahora el botón
  completo se llena del color: Trabajando=verde, Café/Pausa=amarillo,
  Almuerzo=naranja, Diligencia=azul, Terminar turno=rojo, con borde
  coherente y `active:scale` para feedback táctil. Texto elegido por
  contraste real (amber-400/orange-500 con texto blanco fallan WCAG AA
  ~1.6:1/~2.4:1 — usan texto oscuro; los otros 3 usan blanco). Sin cambios a
  PresenceService, Firestore ni lógica de estados. `MyShiftView.tsx` (la
  pantalla móvil separada) ya lo hacía bien y no se tocó.
- deploy: `hosting:app` únicamente, commit `43e6e4a`, ya en `main`.

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
