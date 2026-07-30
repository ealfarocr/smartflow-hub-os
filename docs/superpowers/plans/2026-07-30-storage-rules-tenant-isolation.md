# Aislamiento de Tenants en Firebase Storage — Plan de Implementación

> **Para workers agénticos:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para ejecutar este plan tarea por tarea. Los pasos usan sintaxis de checkbox (`- [ ]`) para seguimiento.

**Objetivo:** Cerrar el hueco de aislamiento en `storage.rules` para que ningún usuario de un negocio (tenant) pueda leer o escribir archivos de otro negocio, y para que solo el SuperAdmin pueda escribir en las rutas globales (`agent-global`, `admin_attachments`).

**Arquitectura:** Se replican en `storage.rules` los mismos helpers `isTenantMember(tenantId)` / `isSuperAdmin()` que ya existen en `firestore.rules`, usando las funciones cross-service `firestore.exists()` / `firestore.get()` disponibles en Firebase Storage Rules v2. Se añade una prueba automatizada con el emulador (`@firebase/rules-unit-testing`) que primero demuestra la vulnerabilidad contra las reglas actuales (fase roja) y luego confirma que la corrección la cierra (fase verde), siguiendo TDD.

**Tech Stack:** Firebase Storage Rules v2, Firebase Emulator Suite (Firestore + Storage), `@firebase/rules-unit-testing`, Node.js (`.mjs`, ESM — el repo ya usa `"type": "module"` en `package.json`).

## Restricciones Globales

- Ningún cambio de código de aplicación (frontend ni Cloud Functions) — solo `storage.rules`, `firebase.json` y un script de test nuevo.
- Las siguientes rutas mantienen lectura **pública** sin cambios (requisito explícito del usuario: priorizar experiencia ágil del cliente final): `logos/{tenantId}`, `catalog/{tenantId}`, `chat-attachments/{tenantId}`, `media-library/{tenantId}`, `agent-global/{fileName}`.
- `whatsapp-media/{tenantId}` pasa de lectura pública a lectura solo para miembros del tenant (contiene medios de clientes, no debe ser público).
- Todas las validaciones de tamaño/tipo MIME existentes en `storage.rules` se conservan intactas.
- El SuperAdmin se identifica igual que en `firestore.rules:39-45`: UID `qsiEuc1lBWUOkjUQRiYvsRf3Syn2`, email `publicidadynegociosenlinea@gmail.com`, o campo `isSuperAdmin == true` en `users/{uid}`.
- El despliegue a producción (`firebase deploy --only storage`) NO se ejecuta automáticamente al final de este plan — requiere confirmación explícita del usuario en el momento, por tratarse de un cambio de seguridad en una plataforma multi-tenant en vivo.

---

### Task 1: Emulador de Storage y dependencia de testing

**Archivos:**
- Modificar: `firebase.json` (bloque `emulators`)
- Modificar: `package.json` (bloque `devDependencies`)

**Interfaces:**
- Produce: emulador de Storage disponible en `127.0.0.1:9199`, paquete `@firebase/rules-unit-testing` instalado y disponible para `import` en scripts `.mjs`.

- [ ] **Paso 1: Agregar el emulador de Storage a `firebase.json`**

En `firebase.json`, dentro del bloque `"emulators"` (líneas 21-35), agregar la entrada `"storage"` junto a las existentes:

```json
  "emulators": {
    "auth": {
      "port": 9099
    },
    "firestore": {
      "port": 8080
    },
    "storage": {
      "port": 9199
    },
    "functions": {
      "port": 5001
    },
    "ui": {
      "enabled": true
    },
    "singleProjectMode": true
  },
```

- [ ] **Paso 2: Instalar la dependencia de testing de reglas**

Ejecutar en la raíz del repo:

```bash
npm install --save-dev @firebase/rules-unit-testing
```

- [ ] **Paso 3: Verificar que los emuladores arrancan correctamente**

```bash
firebase emulators:exec --only firestore,storage "echo emuladores-ok"
```

Esperado: la salida incluye `emuladores-ok` y el comando termina con código de salida `0` (sin errores de arranque de Firestore ni de Storage).

- [ ] **Paso 4: Commit**

```bash
git add firebase.json package.json package-lock.json
git commit -m "chore: agregar emulador de Storage y rules-unit-testing para pruebas de aislamiento"
```

---

### Task 2: Script de prueba que demuestra la vulnerabilidad (fase roja)

**Archivos:**
- Crear: `scripts/test-storage-rules.mjs`

**Interfaces:**
- Consume: emulador de Storage/Firestore de la Task 1, `storage.rules` y `firestore.rules` actuales (sin modificar todavía).
- Produce: script ejecutable standalone que imprime `OK`/`FALLO` por cada verificación y termina con código de salida `1` si alguna falla, `0` si todas pasan. Task 3 y Task 4 reutilizan este mismo script sin cambiarlo.

- [ ] **Paso 1: Crear `scripts/test-storage-rules.mjs`**

```javascript
// Prueba las reglas de seguridad de Firebase Storage contra el emulador.
// Uso: firebase emulators:exec --project smartflow-hub-os-test --only firestore,storage "node scripts/test-storage-rules.mjs"
// El flag --project DEBE coincidir con el projectId hardcodeado abajo (PROJECT_ID):
// sin él, el emulador usa el proyecto por defecto de .firebaserc (paneles-solares-bcs-mx),
// lo que rompe las llamadas cross-service firestore.exists()/get() desde Storage Rules
// (bug documentado: https://github.com/firebase/firebase-js-sdk/issues/6803).
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
import { setDoc, doc } from 'firebase/firestore';

const PROJECT_ID = 'smartflow-hub-os-test';
const TENANT_A = 'tenantA';
const TENANT_B = 'tenantB';
const UID_A = 'userA';
const UID_B = 'userB';
const UID_SUPERADMIN = 'qsiEuc1lBWUOkjUQRiYvsRf3Syn2';

async function seedFirestore(testEnv) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'memberships', `${UID_A}_${TENANT_A}`), {
      userId: UID_A, tenantId: TENANT_A, role: 'Owner',
    });
    await setDoc(doc(db, 'memberships', `${UID_B}_${TENANT_B}`), {
      userId: UID_B, tenantId: TENANT_B, role: 'Owner',
    });
  });
}

async function check(label, promise, expected, failures) {
  try {
    await promise;
    if (expected === 'deny') {
      console.error(`FALLO: ${label} — se esperaba DENY pero se permitió`);
      failures.count++;
    } else {
      console.log(`OK: ${label}`);
    }
  } catch (err) {
    if (expected === 'allow') {
      console.error(`FALLO: ${label} — se esperaba ALLOW pero se denegó (${err.message})`);
      failures.count++;
    } else {
      console.log(`OK: ${label}`);
    }
  }
}

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });

  await seedFirestore(testEnv);

  const userA = testEnv.authenticatedContext(UID_A, { email: 'a@test.com' }).storage();
  const superAdmin = testEnv.authenticatedContext(UID_SUPERADMIN, { email: 'super@test.com' }).storage();
  const anonymous = testEnv.unauthenticatedContext().storage();

  const fakeFile = new Uint8Array([1, 2, 3]);
  const failures = { count: 0 };

  await check(
    'tenant A no puede escribir en ai-agent de tenant B',
    uploadBytes(ref(userA, `tenants/${TENANT_B}/ai-agent/knowledge/f.txt`), fakeFile, { contentType: 'text/plain' }),
    'deny', failures
  );

  await check(
    'tenant A puede escribir en su propia carpeta ai-agent',
    uploadBytes(ref(userA, `tenants/${TENANT_A}/ai-agent/knowledge/f.txt`), fakeFile, { contentType: 'text/plain' }),
    'allow', failures
  );

  await check(
    'usuario normal no puede escribir en agent-global',
    uploadBytes(ref(userA, 'agent-global/base.txt'), fakeFile, { contentType: 'text/plain' }),
    'deny', failures
  );

  await check(
    'SuperAdmin puede escribir en agent-global',
    uploadBytes(ref(superAdmin, 'agent-global/base.txt'), fakeFile, { contentType: 'text/plain' }),
    'allow', failures
  );

  await check(
    'usuario normal no puede escribir en admin_attachments',
    uploadBytes(ref(userA, 'admin_attachments/f.txt'), fakeFile, { contentType: 'text/plain' }),
    'deny', failures
  );

  await check(
    'lectura anónima de logos sigue permitida (experiencia pública)',
    (async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await uploadBytes(ref(ctx.storage(), `logos/${TENANT_A}/logo.png`), fakeFile, { contentType: 'image/png' });
      });
      return getBytes(ref(anonymous, `logos/${TENANT_A}/logo.png`));
    })(),
    'allow', failures
  );

  await check(
    'lectura anónima de whatsapp-media ahora se deniega (medios de clientes)',
    (async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await uploadBytes(ref(ctx.storage(), `whatsapp-media/${TENANT_A}/audio.ogg`), fakeFile, { contentType: 'audio/ogg' });
      });
      return getBytes(ref(anonymous, `whatsapp-media/${TENANT_A}/audio.ogg`));
    })(),
    'deny', failures
  );

  await testEnv.cleanup();

  if (failures.count > 0) {
    console.error(`\n${failures.count} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nTodas las verificaciones de aislamiento pasaron.');
}

run();
```

- [ ] **Paso 2: Ejecutar el script contra las reglas ACTUALES (sin corregir) y confirmar que falla**

```bash
firebase emulators:exec --project smartflow-hub-os-test --only firestore,storage "node scripts/test-storage-rules.mjs"
```

(El flag `--project smartflow-hub-os-test` es obligatorio y debe coincidir exactamente con `PROJECT_ID` en el script — sin él, el emulador arranca con el proyecto por defecto de `.firebaserc`, `paneles-solares-bcs-mx`, y las llamadas cross-service a Firestore dentro de `storage.rules` no encuentran los documentos que el script siembra, aunque en esta Task específica eso no se nota porque las reglas viejas no hacen ninguna llamada cross-service todavía.)

Esperado: termina con código de salida distinto de `0`, y la salida muestra `FALLO` específicamente en:
- `tenant A no puede escribir en ai-agent de tenant B`
- `usuario normal no puede escribir en agent-global`
- `usuario normal no puede escribir en admin_attachments`
- `lectura anónima de whatsapp-media ahora se deniega`

Estas cuatro fallas son exactamente las vulnerabilidades que este plan corrige — su presencia aquí confirma que el script las detecta correctamente antes de tocar `storage.rules`.

- [ ] **Paso 3: Commit**

```bash
git add scripts/test-storage-rules.mjs
git commit -m "test: agregar prueba de aislamiento de Storage (demuestra la vulnerabilidad actual)"
```

---

### Task 3: Corregir `storage.rules`

**Archivos:**
- Modificar: `storage.rules` (archivo completo, 96 líneas actuales)

**Interfaces:**
- Consume: script de la Task 2 (`scripts/test-storage-rules.mjs`), sin cambios.
- Produce: `storage.rules` con los helpers `isTenantMember` / `isSuperAdmin` y las reglas por ruta descritas en el spec.

- [ ] **Paso 1: Reemplazar el contenido completo de `storage.rules`**

```
rules_version = '2';

// Aislamiento de tenants: se replican en Storage los mismos helpers que ya
// existen en firestore.rules (isTenantMember / isSuperAdmin), usando las
// funciones cross-service firestore.exists() / firestore.get() de Storage
// Rules v2. Antes, casi todas las rutas solo verificaban "¿está logueado?"
// sin comprobar a qué negocio pertenece — esto permitía que cualquier
// usuario autenticado leyera/escribiera archivos de OTRO negocio, y que
// cualquier usuario (no solo el SuperAdmin) escribiera en agent-global,
// el conocimiento base que alimenta el prompt de todos los negocios.
service firebase.storage {
  match /b/{bucket}/o {

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

    // Cotizaciones PDF — solo miembros del tenant, max 10MB, solo PDF.
    // Los enlaces compartidos vía getDownloadURL llevan token y bypasean
    // estas reglas, que es el comportamiento esperado para enviar el PDF
    // al cliente vía WhatsApp.
    match /quotes/{tenantId}/{fileName} {
      allow write: if (isTenantMember(tenantId) || isSuperAdmin())
                   && request.resource.size < 10 * 1024 * 1024
                   && request.resource.contentType == 'application/pdf';
      allow read: if isTenantMember(tenantId) || isSuperAdmin();
    }

    // Logos — escritura solo del propio tenant; lectura pública sin cambios
    // (se usan en PDFs, branding y previews externos para el cliente final).
    match /logos/{tenantId}/{fileName} {
      allow write: if (isTenantMember(tenantId) || isSuperAdmin())
                   && request.resource.size < 2 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
      allow read: if true;
    }

    // Catálogo de productos — escritura solo del propio tenant; lectura
    // pública sin cambios (cotizaciones, WhatsApp).
    match /catalog/{tenantId}/{fileName} {
      allow write: if (isTenantMember(tenantId) || isSuperAdmin())
                   && request.resource.size < 5 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
      allow read: if true;
    }

    // Adjuntos admin — ahora solo el SuperAdmin puede escribir/leer
    // (antes cualquier usuario autenticado de cualquier negocio podía).
    match /admin_attachments/{fileName} {
      allow write: if isSuperAdmin() && request.resource.size < 10 * 1024 * 1024;
      allow read: if isSuperAdmin();
    }

    // Documentos de entrenamiento del Agente IA — solo miembros del propio
    // tenant, max 5MB, tipos MIME restringidos.
    match /tenants/{tenantId}/ai-agent/{type}/{fileName} {
      allow write: if (isTenantMember(tenantId) || isSuperAdmin())
                   && request.resource.size < 5 * 1024 * 1024
                   && (
                        request.resource.contentType == 'application/pdf'
                     || request.resource.contentType == 'text/plain'
                     || request.resource.contentType == 'application/json'
                     || request.resource.contentType.matches('image/.*')
                   );
      allow read: if isTenantMember(tenantId) || isSuperAdmin();
    }

    // Adjuntos de chat (asesor humano enviando archivos al cliente) —
    // escritura solo del propio tenant; lectura pública sin cambios
    // (el cliente final los recibe por WhatsApp sin login).
    match /chat-attachments/{tenantId}/{fileName} {
      allow write: if (isTenantMember(tenantId) || isSuperAdmin())
                   && request.resource.size < 20 * 1024 * 1024;
      allow read: if true;
    }

    // Biblioteca de medios del Agente IA — escritura solo del propio
    // tenant; lectura pública sin cambios (el bot los envía por WhatsApp).
    match /media-library/{tenantId}/{fileName} {
      allow write: if (isTenantMember(tenantId) || isSuperAdmin())
                   && request.resource.size < 20 * 1024 * 1024;
      allow read: if true;
    }

    // Documentos GLOBALES del Agente IA (base común a todos los negocios).
    // Escritura SOLO SuperAdmin (antes: cualquier autenticado — el hueco
    // más grave, permitía que un negocio contaminara el conocimiento base
    // de todos los demás). Lectura pública sin cambios (contenido no
    // sensible, compartido a propósito).
    match /agent-global/{fileName} {
      allow write: if isSuperAdmin() && request.resource.size < 20 * 1024 * 1024;
      allow read: if true;
    }

    // Medios de WhatsApp entrantes (audio, imágenes de clientes) — solo
    // escritura desde servidor (Admin SDK bypasea reglas). Lectura ahora
    // restringida a miembros del tenant (antes: pública sin autenticación,
    // exponiendo fotos/audios de clientes de un negocio a cualquiera).
    match /whatsapp-media/{tenantId}/{fileName} {
      allow read: if isTenantMember(tenantId) || isSuperAdmin();
      allow write: if false;
    }

    // Default deny
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Paso 2: Ejecutar el script de prueba y confirmar que todas las verificaciones pasan**

```bash
firebase emulators:exec --project smartflow-hub-os-test --only firestore,storage "node scripts/test-storage-rules.mjs"
```

(El flag `--project smartflow-hub-os-test` es obligatorio — ver nota en Task 2 Paso 2. En esta Task SÍ importa, porque `storage.rules` ya usa `firestore.exists()`/`firestore.get()`: sin el flag correcto, esas llamadas no encuentran los documentos de membership sembrados por el test y todo se deniega incorrectamente.)

Esperado: código de salida `0`, última línea `Todas las verificaciones de aislamiento pasaron.`, sin ninguna línea `FALLO`.

- [ ] **Paso 3: Commit**

```bash
git add storage.rules
git commit -m "fix: aislar Storage por tenant y restringir escritura de agent-global a SuperAdmin"
```

---

### Task 4: Verificación final y preparación de despliegue

**Archivos:** ninguno (solo comandos de verificación).

**Interfaces:**
- Consume: `storage.rules` corregido de la Task 3, script de la Task 2.

- [ ] **Paso 1: Re-ejecutar la suite completa una vez más de forma limpia**

```bash
firebase emulators:exec --project smartflow-hub-os-test --only firestore,storage "node scripts/test-storage-rules.mjs"
```

Esperado: mismo resultado que en Task 3 Paso 2 (todo `OK`, salida `0`) — confirma que el resultado es reproducible, no accidental.

- [ ] **Paso 2: Validar sintaxis de las reglas contra el proyecto real (dry-run, no despliega)**

```bash
firebase deploy --only storage --dry-run
```

Esperado: Firebase compila y valida `storage.rules` sin errores de sintaxis (este comando NO sube nada a producción).

- [ ] **Paso 3: Pausa para confirmación humana antes de desplegar a producción**

No ejecutar `firebase deploy --only storage` (sin `--dry-run`) todavía. Este es un cambio de seguridad en una plataforma multi-tenant en producción — pedir confirmación explícita al usuario antes de desplegar, aunque los pasos anteriores hayan pasado. Una vez confirmado:

```bash
firebase deploy --only storage
```

---

## Auto-revisión del plan

- **Cobertura del spec:** las 9 filas de la tabla del spec (`quotes`, `logos`, `catalog`, `chat-attachments`, `media-library`, `whatsapp-media`, `agent-global`, `admin_attachments`, `tenants/.../ai-agent`) están cubiertas en el nuevo `storage.rules` de la Task 3, y las 7 verificaciones del script de la Task 2 cubren los casos más críticos (cruce entre tenants, escritura global no autorizada, lectura pública que debe mantenerse).
- **Placeholders:** ninguno — todo el código de cada paso está completo y es el contenido real a escribir.
- **Consistencia de nombres:** `isTenantMember(tenantId)` / `isSuperAdmin()` se usan con la misma firma en todas las rutas de `storage.rules`; el UID/email del SuperAdmin coincide exactamente con `firestore.rules:41-42`.
