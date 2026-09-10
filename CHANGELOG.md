# Changelog

Formato libre, en español, más reciente primero. Un cambio por línea, agrupado por fecha.

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
