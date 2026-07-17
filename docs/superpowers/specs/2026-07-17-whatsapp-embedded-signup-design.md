# WhatsApp Embedded Signup — Design

## Contexto

Meta aprobó (14 jul 2026, Advanced Access) los permisos `whatsapp_business_messaging` y
`whatsapp_business_management` para la app `SmartFlow Hub Connect` (App ID
`265699977219364152`), y la cuenta ya tiene estado de **Proveedor de tecnología verificado**.

El backend (`functions/src/index.ts`) ya tiene un flujo de mensajería WhatsApp completo y en
producción: `whatsappWebhook` (mensajes entrantes, descarga de media, disparo del Agente IA),
`sendWhatsappMessage` (envío), `getWhatsappNumbers` (panel SuperAdmin). Todo lee/escribe la
colección Firestore `integrations` (esquema "BYOA" — Bring Your Own App).

El problema: no existe ningún camino para que un negocio nuevo (tenant) cree su propio
documento de integración. Hoy se hace a mano, directo en Firestore. El componente
`src/modules/conversations/WhatsappConnectionModal.tsx` que el usuario ve en la UI es
enteramente decorativo — no llama a ningún SDK de Meta ni crea ningún documento; el "QR" que
muestra es una imagen generada con datos aleatorios (`api.qrserver.com`).

## Objetivo

Que un tenant pueda conectar su propio WhatsApp Business (API estándar o coexistencia con la
app de WhatsApp Business) desde la UI de SmartFlow Hub OS, sin intervención manual de
Eduardo en Firestore.

## No-objetivos

- No se toca la lógica de mensajería ya existente (`sendWhatsappMessage`, `whatsappWebhook`,
  ventana de 24h, descarga de media, Agente IA). Esas funciones ya leen `integrations` con el
  esquema actual y no requieren cambios.
- No se implementa gestión de plantillas de mensaje ni WhatsApp Flows (ya existen como
  secciones separadas en Meta y no forman parte de este alcance).
- No se cambia la versión de Graph API usada en el resto del código (`v17.0`); la función
  nueva usa la misma versión por consistencia, no por ser la más reciente.

## Identificadores conocidos

- `META_APP_ID` = `265699977219364152` (público, ya expuesto como `VITE_META_APP_ID`)
- `WHATSAPP_CONFIG_ID` = `2116583245566996` (público, config de Embedded Signup ya creada en
  Meta con nombre "ES Config", versión de registro `v4`, versión de sesión `3`)
- El App Secret (`VITE_META_APP_SECRET` en `.env`) **nunca debe usarse en el frontend**. Hoy
  no se importa en `src/`, pero al tener el prefijo `VITE_` se empaquetaría en el bundle si
  alguien lo referenciara. Se retira de las variables `VITE_*` y se deja únicamente como
  Secret de Firebase Functions (`WHATSAPP_APP_SECRET`, ya usado como fallback en
  `whatsappWebhook`).

## Arquitectura

```
[WhatsappConnectionModal.tsx]
   │  (usuario elige "API" o "Coexistente")
   │  carga Facebook JS SDK, FB.login({config_id, response_type:'code', override_default_response_type:true, extras:{ setup:{}, featureType, sessionInfoVersion:'3' }})
   ▼
[Popup de Meta] ── postMessage('WA_EMBEDDED_SIGNUP', {phone_number_id, waba_id}) ──► modal (solo para mostrar progreso)
   │
   ▼ FB.login callback entrega `code` (auth code de negocio)
[completeWhatsappEmbeddedSignup] (Cloud Function onCall, nueva)
   1. Verifica request.auth + membership activa del uid en tenantId (mismo check que sendWhatsappMessage)
   2. Intercambia code → access_token: GET graph.facebook.com/v17.0/oauth/access_token
      (client_id=META_APP_ID, client_secret=WHATSAPP_APP_SECRET, code)
   3. POST /{waba_id}/subscribed_apps (suscribe la app a los webhooks de esa WABA)
   4. GET /{phone_number_id}?fields=display_phone_number,verified_name (para confirmar en UI)
   5. Upsert en Firestore integrations: { tenantId, provider:'whatsapp', isActive:true,
      phoneNumberId, wabaId, accessToken, connectionType:'api'|'coexistent',
      displayPhoneNumber, verifiedName, connectedAt }
      (sin appSecret por tenant — todas las integraciones nuevas comparten el
      WHATSAPP_APP_SECRET de la plataforma, ya que todas pasan por la misma App de Meta)
   ▼
[Firestore integrations] ── ya consumido sin cambios por whatsappWebhook / sendWhatsappMessage / getWhatsappNumbers
```

## Frontend — cambios en `WhatsappConnectionModal.tsx`

- Se agrega un loader del SDK de Facebook (`connect.facebook.net/es_LA/sdk.js`), inicializado
  con `FB.init({ appId: import.meta.env.VITE_META_APP_ID, version: 'v17.0' })`.
- El paso 2 ("Configurando API de Meta" / "Sincronizando WhatsApp Coexistente") deja de ser
  un `setTimeout` decorativo. En su lugar:
  - Se registra un listener de `window.addEventListener('message', ...)` filtrando origen
    `https://www.facebook.com` para leer el evento `WA_EMBEDDED_SIGNUP` (trae `phone_number_id`
    y `waba_id` en cuanto el usuario termina el flujo dentro del popup, antes de que se cierre).
  - Se llama `FB.login(callback, { config_id: import.meta.env.VITE_WHATSAPP_CONFIG_ID, response_type: 'code', override_default_response_type: true, extras: { featureType: selected === 'coexistent' ? 'coexistence' : '', sessionInfoVersion: '3' } })`.
  - En el callback, si `response.authResponse?.code` existe, se invoca la Cloud Function
    `completeWhatsappEmbeddedSignup({ code, tenantId, wabaId, phoneNumberId, connectionType })`.
  - Éxito → pantalla de confirmación con el `displayPhoneNumber`/`verifiedName` devueltos.
  - Error (usuario cancela el popup, Meta devuelve error, o la función falla) → estado de
    error explícito con el mensaje devuelto por la función; nunca se simula éxito.
- El botón "Continuar" pasa de `disabled={!selected}` a además exigir que el SDK haya cargado.

## Backend — nueva función `completeWhatsappEmbeddedSignup`

Ubicada junto a `sendWhatsappMessage` en `functions/src/index.ts`, mismo patrón `onCall` +
`secrets: ['WHATSAPP_APP_SECRET']`. Reutiliza el mismo check de membership
(`memberships/{uid}_{tenantId}`, `status === 'active'`) que ya usa `sendWhatsappMessage`.

Errores mapeados a `HttpsError`:
- `unauthenticated` — sin sesión
- `permission-denied` — sin membership activa en el tenant
- `invalid-argument` — falta `code`, `tenantId`, `phoneNumberId` o `wabaId`
- `failed-precondition` — el intercambio de código con Meta falla (token inválido/expirado) o
  la suscripción a webhooks falla — se expone el mensaje de error de Meta tal cual, sin
  reintentos silenciosos.

## Datos — cambios en el esquema `integrations`

Campos nuevos (no rompen a los consumidores existentes, que ya ignoran campos desconocidos):
- `wabaId: string` — necesario para `subscribed_apps` y para la futura gestión de plantillas.
- `connectionType: 'api' | 'coexistent'` — de dónde vino la integración, solo informativo.
- `connectedAt: Timestamp`.

Campo que se deja de requerir para integraciones nuevas: `appSecret` (queda como opcional,
el fallback a `process.env.WHATSAPP_APP_SECRET` en `whatsappWebhook` ya cubre este caso).

## Riesgo abierto: Coexistencia

El flujo de "WhatsApp Business App / Coexistente" (vincular un número que el negocio ya usa
en la app normal de WhatsApp Business) usa el mismo popup de Embedded Signup pero con
`featureType: 'coexistence'`. La documentación pública de Meta sobre el paso posterior al
`code` (cómo se vincula el dispositivo/QR una vez que el número entra en modo coexistencia) es
menos estable que la del flujo estándar. Durante la implementación se debe verificar contra la
documentación vigente de Meta si `subscribed_apps` + `register` son suficientes o si hace
falta un paso adicional (p. ej. `POST /{phone_number_id}/register` con `pin` sigue siendo
igual en modo coexistencia). Si Meta exige algo que la cuenta no tiene habilitado, la función
debe devolver un error claro en vez de reportar éxito falso.

## Testing

- Prueba manual end-to-end con un tenant de prueba (p. ej. "abc123", que hoy no tiene número
  conectado): completar el flujo de "WhatsApp Business API" y confirmar que:
  1. Aparece el documento nuevo en `integrations` con los campos esperados.
  2. `sendWhatsappMessage` puede enviar un mensaje de prueba usando esa integración sin
     ningún cambio en esa función.
  3. Un mensaje entrante real llega al webhook y se enruta al `tenantId` correcto.
- Prueba manual del flujo "Coexistente" con un número real que ya use la app de WhatsApp
  Business, documentando cualquier paso adicional que pida Meta (ver riesgo abierto arriba).
- No se agregan tests automatizados nuevos: el proyecto no tiene suite de tests para
  `functions/src/index.ts` hoy (no hay `*.test.ts` en `functions/`), así que se mantiene
  consistencia con el resto del archivo en vez de introducir un framework de testing aislado
  para una sola función.
