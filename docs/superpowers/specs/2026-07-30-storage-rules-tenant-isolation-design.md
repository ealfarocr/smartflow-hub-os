# Aislamiento de Tenants en Firebase Storage — Design

## Contexto

`storage.rules` protege hoy casi todos los paths solo con `request.auth != null` —
"¿está logueado?" — sin verificar a qué negocio (tenant) pertenece ese usuario. Esto
contradice el requisito explícito de la plataforma: los negocios deben estar
"totalmente separados entre sí, no mezclar nada".

`firestore.rules` ya resuelve este mismo problema correctamente con los helpers
`isTenantMember(tenantId)` (línea 15-17) e `isSuperAdmin()` (línea 39-45), pero
`storage.rules` nunca los replicó — el propio archivo lo documenta en un comentario
(líneas 13-18): asumía que las Storage Rules no podían consultar Firestore. Eso ya no
es cierto: Firebase Storage Rules v2 soporta `firestore.exists()` / `firestore.get()`
(cross-service rules), lo que permite aplicar exactamente la misma lógica de
membresía.

**El hallazgo más grave**: `agent-global/{fileName}` (línea 78-82) — la carpeta de
conocimiento base que alimenta el prompt de **todos** los negocios — permite
`allow write: if request.auth != null`. Cualquier usuario autenticado de cualquier
negocio, no solo el SuperAdmin, puede hoy sobrescribir el conocimiento global que
afecta a todos los demás tenants.

## Objetivo

Que ningún usuario pueda leer o escribir archivos de Storage que pertenecen a un
tenant del que no es miembro, y que solo el SuperAdmin pueda escribir en las rutas
verdaderamente globales (`agent-global`, `admin_attachments`). Mantener sin cambios
las rutas de lectura pública que existen a propósito para servir contenido a
clientes finales sin login (WhatsApp, PDFs de cotización, catálogo).

## No-objetivos

- No se toca `firestore.rules` (ya está correctamente aislado).
- No se cambia el modelo de datos, ni el código de la aplicación (frontend o
  Cloud Functions) — es un cambio de reglas únicamente. Ningún flujo legítimo
  existente deja de funcionar porque todo código de app ya opera dentro del tenant
  correcto del usuario autenticado.
- No se restringe la lectura de rutas pensadas para el cliente final del negocio
  (no autenticado): `logos`, `catalog`, `chat-attachments`, `media-library`,
  descargas vía `getDownloadURL()` con token. El usuario priorizó explícitamente
  la experiencia ágil del cliente final por sobre restringir esas lecturas.
- No se agrega UI ni mensajes de error nuevos; un `allow` denegado simplemente
  resulta en el comportamiento estándar de Firebase (403), igual que ya ocurre en
  otras partes de la plataforma.

## Diseño

Se agregan a `storage.rules` los mismos helpers que ya existen en `firestore.rules`,
adaptados a la sintaxis cross-service (`firestore.exists(...)` /
`firestore.get(...).data`):

```
function isTenantMember(tenantId) {
  return request.auth != null &&
    firestore.exists(/databases/(default)/documents/memberships/$(request.auth.uid + '_' + tenantId));
}

function isSuperAdmin() {
  return request.auth != null && (
    request.auth.uid == 'qsiEuc1lBWUOkjUQRiYvsRf3Syn2' ||
    request.auth.token.email == 'publicidadynegociosenlinea@gmail.com' ||
    firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data.isSuperAdmin == true
  );
}
```

(Los mismos fallbacks de UID/email que ya usa `firestore.rules:41` para el
SuperAdmin, para no depender de un único mecanismo.)

### Cambios por ruta

| Ruta | Hoy | Después |
|---|---|---|
| `tenants/{tenantId}/ai-agent/{type}/{fileName}` | write/read: cualquier autenticado | write/read: `isTenantMember(tenantId) \|\| isSuperAdmin()` |
| `quotes/{tenantId}/{fileName}` | write: cualquier autenticado; read: cualquier autenticado | write/read: `isTenantMember(tenantId) \|\| isSuperAdmin()` |
| `logos/{tenantId}/{fileName}` | write: cualquier autenticado; read: pública | write: `isTenantMember(tenantId) \|\| isSuperAdmin()`; **read: sin cambio (pública)** |
| `catalog/{tenantId}/{fileName}` | write: cualquier autenticado; read: pública | write: `isTenantMember(tenantId) \|\| isSuperAdmin()`; **read: sin cambio (pública)** |
| `chat-attachments/{tenantId}/{fileName}` | write: cualquier autenticado; read: pública | write: `isTenantMember(tenantId) \|\| isSuperAdmin()`; **read: sin cambio (pública)** |
| `media-library/{tenantId}/{fileName}` | write: cualquier autenticado; read: pública | write: `isTenantMember(tenantId) \|\| isSuperAdmin()`; **read: sin cambio (pública)** |
| `whatsapp-media/{tenantId}/{fileName}` | write: nadie (correcto, solo Admin SDK); read: pública sin auth | write: sin cambio; read: `isTenantMember(tenantId) \|\| isSuperAdmin()` (son fotos/audios de clientes, no deben ser públicas sin login) |
| `agent-global/{fileName}` | write: cualquier autenticado; read: pública | **write: `isSuperAdmin()` únicamente**; read: sin cambio (pública — es contenido base no sensible, compartido a propósito) |
| `admin_attachments/{fileName}` | write/read: cualquier autenticado | write: `isSuperAdmin()`; read: sin cambio |

Todas las validaciones de tamaño/tipo MIME existentes se mantienen igual, solo se
añade la condición de membresía con `&&`.

### Por qué las lecturas públicas quedan como están

El usuario priorizó explícitamente la experiencia del cliente final: logos, catálogo,
adjuntos de chat y medios del agente deben cargar rápido en WhatsApp/web sin fricción
de login, y ya se documentó (comentario original, líneas 5-7 y 17-18) que estas URLs
llevan un token de descarga que de todas formas evita la enumeración trivial. El
cambio real de seguridad está en cerrar **quién puede escribir/contaminar** esas
carpetas, no en quién puede leerlas.

## Pruebas

No existe hoy infraestructura de test para reglas de seguridad en el repo. Se añade:

1. Dependencia de desarrollo `@firebase/rules-unit-testing` (solo devDependency, no
   afecta el build de producción).
2. Script `scripts/test-storage-rules.mjs` que levanta el emulador de Storage +
   Firestore (vía `firebase-tools`) y verifica, por cada ruta de la tabla:
   - Un usuario del tenant A **no puede** escribir en la carpeta del tenant B.
   - Un usuario del tenant A **sí puede** escribir en su propia carpeta.
   - Un usuario cualquiera (no SuperAdmin) **no puede** escribir en `agent-global` ni
     `admin_attachments`.
   - El SuperAdmin **sí puede** escribir en ambas.
   - Las rutas de lectura pública siguen siendo legibles sin autenticación.
3. Se agrega el emulador `storage` (puerto `9199`) a `firebase.json` `emulators`,
   que hoy no está declarado.
4. El script corre vía `firebase emulators:exec --only firestore,storage "node scripts/test-storage-rules.mjs"` y se documenta el comando en el propio script (comentario de cabecera) para que sea repetible.

## Riesgos / consideraciones

- Cada verificación de membresía en Storage ahora dispara una lectura a Firestore
  (costo/latencia adicional, del orden de milisegundos y fracciones de centavo por
  operación). Aceptable dado el volumen actual de subidas de archivos (no es un path
  de alta frecuencia como el envío de mensajes).
- Si en el futuro se necesita que un archivo de `ai-agent` o `quotes` sea accedido
  por un proceso que no tiene membresía Firestore (p. ej. un webhook externo), deberá
  pasar por una Cloud Function con Admin SDK (que ya bypasea Storage rules), no por
  acceso directo del cliente — patrón que la plataforma ya usa en otros lados.
