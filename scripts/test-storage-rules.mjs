// Prueba las reglas de seguridad de Firebase Storage contra el emulador.
// Uso: firebase emulators:exec --project smartflow-hub-os-test --only firestore,storage "node scripts/test-storage-rules.mjs"
// El flag --project DEBE coincidir con PROJECT_ID abajo: sin él, el emulador usa el
// proyecto por defecto de .firebaserc (paneles-solares-bcs-mx) y las llamadas
// cross-service firestore.exists()/get() desde Storage Rules no encuentran los
// documentos sembrados por este script (bug conocido: firebase/firebase-js-sdk#6803).
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
