# Estado del proyecto — SmartFlow Hub OS

> Documento de continuidad entre sesiones de agentes. Actualizar al final de cada sesión
> que toque código: qué se investigó, qué se cambió, qué quedó pendiente de validar.
> No reemplaza al historial de git — es un resumen de "dónde quedamos" para el próximo agente.

## Qué es este proyecto

CRM multicanal con IA (WhatsApp Cloud API, Instagram, Facebook Messenger) — SPA de React 19 +
TypeScript + Vite, servida como sitio estático por Firebase Hosting (HTTPS, sin service worker,
no es PWA/WebView/Capacitor/Cordova). Backend en Firebase Functions + Firestore + Storage.
Multi-tenant (`activeMembership.tenantId` en casi todo).

Stack relevante: `firebase` SDK v12, `zustand` para stores, `react-router-dom` v7,
`@breezystack/lamejs` para codificar audio a MP3 en el navegador (WhatsApp no acepta
`audio/webm` de `MediaRecorder`).

Dominios: hosting target `app` → SPA (`dist/`), `landing` y `blog` → sitios estáticos aparte.
Headers de seguridad (CSP, Permissions-Policy, HSTS, etc.) se definen en `firebase.json`
bajo `hosting[target=app].headers`, solo aplican en producción — Vite dev server no los manda.

## Sesión 2026-09-04 — Bug: cámara/galería/grabadora no funcionan en el chat móvil

### Síntoma reportado
En `ConversationsPageView.tsx` (mobile), el menú de adjuntos se abre pero cámara, galería
y grabadora "no activan correctamente la captura o selección". Confirmado con capturas de
pantalla en un Xiaomi/MIUI real contra `smartflow-suite.com`: al tocar "Foto", en vez de
abrir la cámara directo, Android muestra un chooser genérico con 4 apps (2× "Cámara",
"Grabadora", "Fotos y videos") — evidencia de que el atributo `capture` del `<input>` está
siendo ignorado por el navegador.

### ⚠️ Aclaración sobre "causa raíz" (agregada tras revisión del usuario)
Nada de lo listado en esta sesión está confirmado como causa raíz definitiva todavía —
son correcciones defensivas/de robustez, razonables y de bajo riesgo, pero **sin prueba
física en Android que las confirme**. La causa raíz real se determina con los logs
`[ATTACH]` en un dispositivo real (sección "Qué queda por validar" más abajo). En
concreto:
1. `Permissions-Policy: camera=(self)` es la configuración **correcta** según el spec
   HTML/MediaCapture (el spec liga el atributo `capture` a esta política), pero **no está
   demostrado empíricamente que `camera=()` haya sido la causa** del comportamiento
   observado en las capturas de pantalla (chooser de 4 apps en vez de cámara directa).
   Es plausible y consistente con el spec, no confirmado con logs de un dispositivo real.
2. Mover el reset de `e.target.value` a después de `await handleFileUpload(...)` es una
   mejora de robustez (evita un patrón de riesgo documentado en algunos navegadores
   móviles), **no debe leerse como "causa raíz confirmada"** de por qué el archivo no
   llegaba al chat.

### Causa candidata identificada (defensiva — NO confirmada en dispositivo)
`firebase.json` → `hosting[target=app].headers["**"].Permissions-Policy` tenía
`camera=()`. Esto desactiva la cámara para **todo origen, incluido el propio sitio**.
El atributo `capture="environment"` de `<input type="file">` está gobernado por esta
política (spec HTML/MediaCapture): si `camera` está deshabilitada, el navegador debería
actuar como si `capture` no existiera — sin error visible en consola. Esto es consistente
con el chooser genérico de 4 apps que aparece en las capturas de pantalla del reporte, y
consistente con que solo se manifieste en producción (Firebase Hosting), nunca en
`npm run dev` (Vite no manda ese header) — lo que también explicaría por qué intentos
previos de arreglarlo a nivel de componente (dos inputs separados foto/video,
`capture="environment"`) no parecían resolverlo. **Sigue siendo una hipótesis
consistente con la evidencia disponible, no una causa confirmada** — la corrección
(`camera=(self)`) se mantiene porque es la configuración correcta de todas formas
(el sitio necesita cámara para sí mismo), independientemente de si termina siendo la
causa completa del bug.

Además se encontraron dos bugs secundarios en el mismo componente:
1. **Grabadora (nota de voz) con condición de carrera**: si el permiso de micrófono tarda
   en resolverse (diálogo nativo del navegador, típicamente la primera vez), el dedo se
   puede soltar antes de que `getUserMedia` resuelva. Como `isRecording`/`recorderRef` solo
   se setean *después* del `await`, la grabación arrancaba "fantasma" tras soltar, sin
   forma de pararla desde la UI (quedaba grabando hasta el próximo toque en cualquier
   parte de la pantalla, o hasta el tope de 3 min).
2. **No existía una opción explícita de "Galería"**: solo había "Adjuntar" (documento
   genérico) y "Cámara" (Foto/Video, ambos con `capture` forzado). No había un input sin
   `capture` para elegir directamente de la galería de fotos/videos.

### Cambios aplicados
- [firebase.json](firebase.json): `Permissions-Policy` → `camera=(self)` (antes `camera=()`).
  Microphone ya estaba correcto (`microphone=(self)`), no se tocó.
- [src/modules/conversations/ConversationsPageView.tsx](src/modules/conversations/ConversationsPageView.tsx):
  - Nuevo input oculto `galleryInputRef` (`accept="image/*,video/*"`, sin `capture`) +
    opción "Galería" en el menú de la cámara (junto a Foto/Video).
  - `startRecording()`: si al resolver `getUserMedia` el usuario ya soltó el dedo (y no
    está en modo bloqueado), cancela el grabador en vez de arrancar la grabación.
- [scripts/check-mobile-capture-config.mjs](scripts/check-mobile-capture-config.mjs): script
  de regresión (sin framework, sigue el patrón de `scripts/test-storage-rules.mjs`) que
  falla si el `Permissions-Policy` vuelve a desactivar `camera`/`microphone` para el sitio,
  o si el input de galería o el guard de la condición de carrera desaparecen del componente.
  Verificado: corre en verde contra el código actual y en rojo contra el commit anterior
  (confirma que hubiera atrapado el bug original).

### Verificado en este entorno (sin dispositivo físico)
- `npx tsc -b` → sin errores.
- `npx eslint src/modules/conversations/ConversationsPageView.tsx` → mismos 8
  problemas preexistentes (no relacionados a este cambio, confirmado comparando contra
  `git stash`); no se introdujeron errores nuevos.
- `npm run build` → build de producción exitoso.
- `node scripts/check-mobile-capture-config.mjs` → verde contra el fix, rojo contra el
  commit anterior.

### ⚠️ Pendiente de validación manual en un teléfono real (no se puede probar aquí)
Nada de lo de cámara/galería/grabadora se puede probar en este entorno: no hay hardware
de cámara/micrófono real, no hay forma de simular el diálogo nativo de Android/iOS, y el
fix principal es un header HTTP que **solo aplica una vez desplegado** a Firebase Hosting
(no en `localhost`). Falta validar en producción, después de un deploy autorizado:
1. Tocar "Cámara" → "Foto" en Android e iOS: debe abrir la cámara directo (sin el chooser
   de 4 apps de las capturas).
2. Tocar "Cámara" → "Video": debe abrir la cámara en modo video directo.
3. Tocar "Cámara" → "Galería" (nueva opción): debe abrir el selector de fotos/videos del
   teléfono (Google Photos / galería nativa), no la cámara.
4. Tocar "Adjuntar" (clip): debe seguir permitiendo elegir cualquier archivo (imagen,
   video, audio, documento) como antes.
5. Mantener presionado el micrófono la primera vez en un teléfono nuevo (o tras borrar
   permisos): conceder el permiso cuando aparece el diálogo nativo, soltando el dedo
   apenas aparece el diálogo (para forzar el caso de carrera) — no debe quedar grabando
   "fantasma"; debe cancelar limpiamente.
6. Confirmar que las 4 capturas del reporte original (chooser con 2×Cámara/Grabadora/
   Fotos y videos) ya no aparecen tras el deploy.

### No hecho (fuera de alcance / requiere autorización)
- **No se desplegó** el fix a Firebase Hosting ni se hizo push — pendiente de autorización
  explícita del usuario.
- No se agregó click-outside para cerrar los menús desplegables (Cámara, Plantillas) —
  es una limitación preexistente, no relacionada al bug reportado.

## Corrección del diagnóstico (mismo día, 2026-09-04)

El usuario corrigió el enfoque: el menú de adjuntos **sí se despliega bien** (Foto/Video/
Galería aparecen). El problema real es el **recorrido completo desde el tap hasta que el
archivo capturado/seleccionado vuelve al chat como adjunto y se puede enviar** — no solo
que se abra la fuente correcta. Se pidió NO dar por cerrado el diagnóstico solo con el
fix de `Permissions-Policy` (se mantiene, es correcto, pero es una pieza, no la historia
completa) y auditar explícitamente: ref del input → `.click()` → `onChange` →
`event.target.files` → procesamiento del `File` → preview → estado de attachment →
upload → envío. También se pidió instrumentación temporal con tags específicos y
verificar si cerrar el menú desmonta los inputs mientras Android tiene la cámara/galería
abierta (posible pérdida del evento `change` al volver).

### Auditoría del flujo completo (Foto / Video / Galería)

Resultado de leer el componente línea por línea desde el botón hasta `sendMessage`:

- **Ciclo de vida del input — descartado como causa**: los 4 `<input type="file">`
  (`fileInputRef`, `cameraInputRef`, `cameraVideoInputRef`, `galleryInputRef`) están
  declarados como hijos **directos e incondicionales** del `<form>`, ANTES del bloque
  `{showCameraChoice && (...)}` que renderiza el dropdown. Cerrar el dropdown
  (`setShowCameraChoice(false)`) no los desmonta: viven en una posición de árbol distinta
  y estable independientemente del estado del menú. Confirmado leyendo el JSX y con un
  chequeo automatizado (`scripts/check-mobile-capture-config.mjs`) que verifica su
  posición relativa. **No es la causa.**
- **Botón → `.click()` — correcto**: cada opción del menú llama
  `xInputRef.current?.click()` de forma síncrona, en el mismo handler que cierra el
  menú (antes de que React aplique el re-render por el `setState`), sobre el mismo nodo
  DOM del input. No hay pérdida de gesto de usuario ahí.
- **`onChange` → `handleFileUpload` — riesgo de robustez encontrado (no confirmado como
  causa raíz)**: los 4 inputs limpiaban `e.target.value = ''` **inmediatamente después de
  llamar** `handleFileUpload(f)` sin esperarlo (`handleFileUpload` es `async` pero no se
  hacía `await`). Esto significa que el input se resetea *mientras* el archivo todavía se
  está subiendo (o incluso antes de que el navegador termine de materializar el `File`
  desde el content-provider de la cámara/galería de Android). Es un patrón de riesgo
  documentado en algunos navegadores móviles: limpiar el `value` de un
  `<input type="file">` antes de terminar de leer el `File` puede invalidar el blob
  subyacente. **No hay evidencia de este dispositivo/sesión de que esto haya causado el
  problema reportado** — es una mejora de robustez razonable que se aplica de todas
  formas porque elimina una fuente de riesgo real, documentada, sin costo. Aplicado: ahora
  cada `onChange` es `async`, hace `await handleFileUpload(f, <origen>)` y solo después
  limpia `e.target.value`.
- **`handleFileUpload` → `uploadToStorage` → `setMediaUrl`/`setMediaFilename` → preview
  — correcto**: si el upload tiene éxito, setea `mediaUrl`/`mediaFilename`, que renderiza
  el bloque de preview (imagen/audio/documento) arriba del textarea, dentro del mismo
  `<form>`. Si falla, hay `addToast('Error al subir archivo')` (usa `ToastContainer`,
  montado globalmente en `MainLayout`, funciona igual en todo el resto de la app). No se
  encontró ninguna rama donde el archivo se pierda en absoluto silencio: o llega a
  `setMediaUrl`, o dispara un toast de error, o (si `file.size > 16MB`) un toast
  explicando el límite de WhatsApp — este último es candidato realista para "el video no
  aparece" si el video grabado pesa más de 16MB (WhatsApp Cloud API no acepta más).
- **Envío final**: el botón "Enviar" llama `handleSendMessage`, que exige
  `cleanText || mediaUrl` — con `mediaUrl` seteado, el envío funciona igual que con texto.

### Hipótesis NO descartable desde este entorno (requiere validación en el dispositivo)

No se pudo reproducir el chooser nativo de Android ni el regreso de la app de cámara/
galería en este entorno (sin hardware, sin forma de simular el intent de Android). La
hipótesis más plausible que **no** se puede confirmar ni descartar sin un teléfono real:
en dispositivos con poca RAM, Android puede matar el proceso de la pestaña de Chrome
mientras la app de cámara está en foreground (memory pressure); al volver, Chrome hace
un reload completo de la SPA, perdiendo todo el estado de React (incluida la conversación
activa) — el resultado del picker se pierde porque no hay un `<input>` montado a tiempo
para recibirlo. Esto se agrava por el tamaño del bundle actual (`dist/assets/index-*.js`
≈2.6MB + `pdf.worker-*.js` ≈2.2MB sin code-splitting real), que aumenta la presión de
memoria en móviles de gama baja. **No se tocó el bundling en esta sesión** (es un cambio
de arquitectura grande, fuera del alcance de "corrección mínima"); se deja anotado para
decidir si vale la pena abordarlo si la instrumentación en el dispositivo confirma esta
hipótesis (ver logs `PHOTO_CHANGE`/`VIDEO_CHANGE`/`GALLERY_CHANGE` — si nunca aparecen
tras volver de la cámara/galería, la pestaña se recicló).

### Cambios aplicados (además de los de la sección anterior)

- [ConversationsPageView.tsx](src/modules/conversations/ConversationsPageView.tsx):
  - `handleFileUpload` ahora recibe un segundo parámetro `source:
    'PHOTO'|'VIDEO'|'GALLERY'|'ATTACH'` solo para etiquetar los logs de diagnóstico.
  - Los 4 `onChange` (`fileInputRef`, `cameraInputRef`, `cameraVideoInputRef`,
    `galleryInputRef`) ahora son `async`, hacen `await handleFileUpload(...)` y **recién
    después** limpian `e.target.value = ''` (antes se limpiaba sin esperar).
  - **Instrumentación temporal** (`debugAttach`, un `console.log` con prefijo
    `[ATTACH]`): `PHOTO_CLICK` / `PHOTO_INPUT_TRIGGERED` en el botón "Foto",
    `PHOTO_CHANGE` en su `onChange`, y análogos `VIDEO_*` / `GALLERY_*`; dentro de
    `handleFileUpload`: `{source}_FILE_RECEIVED`, `{source}_ABORTED_NO_TENANT`,
    `{source}_REJECTED_TOO_LARGE`, `{source}_ATTACHMENT_CREATED`,
    `{source}_UPLOAD_ERROR`. Pensado para revisar vía remote debugging
    (`chrome://inspect`) en un Android real y ver exactamente en qué paso se corta cada
    flujo. **Quitar (o silenciar tras un flag) una vez confirmado el fix en producción**
    — no debe quedar como logging permanente.
- [scripts/check-mobile-capture-config.mjs](scripts/check-mobile-capture-config.mjs):
  ampliado con chequeos de (a) posición de los inputs fuera del dropdown condicional,
  (b) que el reset de `e.target.value` ocurra después del `await`, y (c) presencia de
  los 9 tags de instrumentación pedidos. Verificado en rojo (18/18) contra el commit
  anterior y en verde contra el estado actual.

### Verificado en este entorno (ronda 2)
- `npx tsc -b` → sin errores.
- `npx eslint src/modules/conversations/ConversationsPageView.tsx` → mismos 8 problemas
  preexistentes, ninguno nuevo.
- `npm run build` → build de producción exitoso.
- `node scripts/check-mobile-capture-config.mjs` → 18/18 en verde contra el fix, 18/18 en
  rojo contra el commit anterior (`git stash` + re-run + `stash pop`).

### ⚠️ Qué queda OBLIGATORIAMENTE por validar en Android real (no simulable aquí)
1. **Foto**: tap Foto → cámara abre directo → tomar foto → confirmar → volver al chat →
   la foto debe aparecer en el preview sobre el textarea y poder enviarse.
2. **Galería**: tap Galería → selector de fotos/videos del teléfono (no cámara) → elegir
   una foto → volver → debe aparecer adjunta y poder enviarse.
3. **Video**: tap Video → cámara en modo video (o selector, según dispositivo) → grabar/
   elegir → volver → debe aparecer adjunto. Si el video pesa más de 16MB debe aparecer el
   toast de error explicando el límite (no un silencio).
4. Con la consola remota abierta (`chrome://inspect` conectado por USB, o Safari Web
   Inspector en iOS), confirmar que aparecen en orden `*_CLICK` → `*_INPUT_TRIGGERED` →
   `*_CHANGE` → `*_FILE_RECEIVED` → `*_ATTACHMENT_CREATED` para cada flujo. Si la cadena
   se corta antes de `*_CHANGE`, el problema es que Android/iOS nunca disparó el evento
   de vuelta (posible reciclado de la pestaña — ver hipótesis de arriba). Si se corta
   después de `*_CHANGE` pero antes de `*_ATTACHMENT_CREATED`, el problema está en el
   upload (revisar `*_UPLOAD_ERROR` en consola y las reglas de Storage/CORS).
5. Repetir el punto 5 de la sección anterior (condición de carrera del micrófono).
6. Probar en un segundo dispositivo/navegador si es posible (iOS Safari) — el
   comportamiento de `capture` y el reciclado de pestañas en background difiere de
   Android Chrome.

## Deploy controlado a producción (mismo día, 2026-09-04)

El usuario aprobó desplegar lo de arriba a producción, con dos condiciones: (1) corregir
el lenguaje de este documento para no afirmar "causa raíz confirmada" sin prueba física
(ver "⚠️ Aclaración sobre causa raíz" más arriba — se corrigió ANTES de este deploy), y
(2) agregar logs mínimos de ciclo de vida de la página para detectar si Android/Chrome
recicla el proceso de la SPA al volver de la cámara.

### Cambio agregado antes del deploy: instrumentación de ciclo de vida

Nuevo archivo [src/utils/attachLifecycleDebug.ts](src/utils/attachLifecycleDebug.ts),
importado una sola vez (por efecto secundario) desde
[src/app/main.tsx](src/app/main.tsx). No altera arquitectura ni componentes existentes —
solo registra listeners globales al arrancar la app:

- `APP_MOUNT` — se loguea una vez cuando el módulo de JS se evalúa (arranque de la SPA).
- `PAGE_HIDE` / `PAGE_SHOW` — eventos `pagehide`/`pageshow` de `window`, incluyen
  `persisted` (si `pageshow.persisted` es `true`, la página volvió del back-forward cache
  de Chrome sin re-ejecutar JS; si es `false` y hay un `APP_MOUNT` nuevo en el medio, hubo
  una recarga completa).
- `VISIBILITY_HIDDEN` / `VISIBILITY_VISIBLE` — `document.visibilitychange`.

Todos los logs llevan `{ sessionId, mountId, mountCount }`:
- `sessionId`: se genera una vez y se guarda en `sessionStorage` — estable mientras la
  pestaña/tab no se cierre, sobrevive a recargas.
- `mountId`: se genera de nuevo cada vez que el módulo se evalúa (cada vez que el JS
  arranca desde cero).
- `mountCount`: contador en `sessionStorage`, se incrementa en cada `APP_MOUNT`.

**Cómo leerlo**: si dentro de la misma `sessionId` aparece un segundo `APP_MOUNT` con
`mountCount` incrementado justo después de volver de la cámara/galería (entre el
`*_CLICK` y el `*_CHANGE` esperado), eso confirma que Chrome recicló el proceso de la
pestaña y por eso el archivo nunca llega — la SPA arrancó de cero y perdió el input
pendiente. Si `mountCount` se mantiene en 1 durante todo el ciclo, el proceso sobrevivió
y la causa está en otra parte del flujo (ver la guía de diagnóstico más abajo).

`scripts/check-mobile-capture-config.mjs` se amplió para verificar que este archivo
exista, esté importado desde `main.tsx`, y contenga los 5 tags y los 3 identificadores
(`sessionId`/`mountId`/`mountCount`).

### Verificado antes del deploy
- `npx tsc -b` → sin errores.
- `npx eslint` sobre los 3 archivos tocados (`ConversationsPageView.tsx`, `main.tsx`,
  `attachLifecycleDebug.ts`) → mismos 8 problemas preexistentes en
  `ConversationsPageView.tsx` (confirmado antes que no eran nuevos), 0 en los otros dos.
- `node scripts/check-mobile-capture-config.mjs` → 24/24 en verde.
- `npm run build` → build de producción exitoso.

### Datos del deploy
- **Desplegado**: 2026-09-04, ~20:05 UTC, vía `firebase deploy --only hosting:app`
  (proyecto `paneles-solares-bcs-mx`, target `app` únicamente — no se tocaron `landing`
  ni `blog`).
- **URL desplegada**: https://paneles-solares-bcs-mx.web.app (dominio por defecto de
  Firebase) y **https://hub.smartflow-suite.com** (dominio personalizado conectado a este
  mismo sitio de Hosting — confirmado con `curl`, ver header abajo; es el dominio real que
  el usuario probó en las capturas de pantalla — la barra de direcciones truncada
  "…nartflow-suite.com" corresponde a `hub.smartflow-suite.com`, no al apex
  `smartflow-suite.com` ni a `www.`/`app.smartflow-suite.com`, que son sitios **distintos
  en Vercel**, no relacionados con este repo).
- **⚠️ Aclaración de dominios** (para evitar confusión futura): `smartflow-suite.com` y
  `www.smartflow-suite.com` y `app.smartflow-suite.com` están servidos por **Vercel**
  (`Server: Vercel`), son páginas estáticas distintas de este CRM. El chat de
  WhatsApp/CRM de este repo vive específicamente en `hub.smartflow-suite.com` →
  Firebase Hosting, sitio `paneles-solares-bcs-mx`. Cualquier prueba futura de este
  bug debe hacerse en `hub.smartflow-suite.com`.
- **Commit/hash desplegado**: **no hay commit** — el deploy se hizo directo desde el
  working tree (`npm run build` + `firebase deploy`) sobre el último commit
  `f20278b` ("fix: nota de voz podia quedar colgada..."), con los cambios de esta sesión
  aún sin commitear (`git status` los lista como modificados/sin trackear:
  `firebase.json`, `src/app/main.tsx`, `src/modules/conversations/ConversationsPageView.tsx`,
  `CHANGELOG.md`, `PROJECT_STATE.md`, `scripts/check-mobile-capture-config.mjs`,
  `src/utils/attachLifecycleDebug.ts`). Si se quiere un hash de referencia exacto para lo
  desplegado, hay que commitear explícitamente (no se hizo por defecto, según las reglas
  del proyecto de no commitear sin pedido explícito).
- **Header `Permissions-Policy` efectivo en producción** (verificado con
  `curl -sI https://hub.smartflow-suite.com/`):
  ```
  Permissions-Policy: camera=(self), microphone=(self), geolocation=()
  ```
  Confirmado en vivo, con el mismo CSP que `firebase.json` define para el target `app`.
  `Last-Modified` del documento coincide con la hora del deploy.

### Lista exacta de logs a observar en Android real (después de este deploy)
Todos con prefijo `[ATTACH]` en la consola remota (`chrome://inspect` por USB, o Safari
Web Inspector en iOS):

**Ciclo de vida de la página** (para detectar reciclado de proceso):
`APP_MOUNT`, `PAGE_HIDE`, `PAGE_SHOW`, `VISIBILITY_HIDDEN`, `VISIBILITY_VISIBLE`
(cada uno con `sessionId`/`mountId`/`mountCount` — comparar si `mountId` cambia entre el
tap y el regreso).

**Flujo Foto**: `PHOTO_CLICK` → `PHOTO_INPUT_TRIGGERED` → `PHOTO_CHANGE` →
`PHOTO_FILE_RECEIVED` → `PHOTO_ATTACHMENT_CREATED` (o `PHOTO_REJECTED_TOO_LARGE` /
`PHOTO_UPLOAD_ERROR` / `PHOTO_ABORTED_NO_TENANT` si falla en el camino).

**Flujo Video**: `VIDEO_CLICK` → `VIDEO_INPUT_TRIGGERED` → `VIDEO_CHANGE` →
`VIDEO_FILE_RECEIVED` → `VIDEO_ATTACHMENT_CREATED` (mismas variantes de error con
prefijo `VIDEO_`).

**Flujo Galería**: `GALLERY_CLICK` → `GALLERY_INPUT_TRIGGERED` → `GALLERY_CHANGE` →
`GALLERY_FILE_RECEIVED` → `GALLERY_ATTACHMENT_CREATED` (mismas variantes de error con
prefijo `GALLERY_`).

**Diagnóstico según dónde se corte la cadena**:
- Nunca aparece `*_CHANGE` después del `*_INPUT_TRIGGERED` → Android/iOS nunca devolvió
  el resultado al input. Revisar si hubo un `APP_MOUNT` nuevo (proceso reciclado) o si
  el chooser de apps (como en las capturas originales) sigue apareciendo.
- Aparece `*_CHANGE` pero nunca `*_FILE_RECEIVED` → el archivo llegó vacío/nulo
  (`e.target.files` vacío) — revisar `filesLength` en el log de `*_CHANGE`.
- Aparece `*_FILE_RECEIVED` pero nunca `*_ATTACHMENT_CREATED` → revisar
  `*_REJECTED_TOO_LARGE` (video > 16MB) o `*_UPLOAD_ERROR` (falla de red/Storage) en la
  misma consola.
- Todo aparece hasta `*_ATTACHMENT_CREATED` pero no se ve el preview en pantalla → ahí sí
  sería un bug de render, no de captura (no encontrado en la auditoría de código; poco
  probable pero a confirmar).

Los logs `[ATTACH]` (tanto los del chat como los de ciclo de vida) **quedan activos
deliberadamente** tras este deploy — no retirar hasta confirmar la causa raíz real con
el dispositivo.
