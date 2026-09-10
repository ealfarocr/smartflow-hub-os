// Reproduce el "Error al subir archivo" del teléfono contra las Storage Rules
// REALES, con el mismo shape de datos que tiene USADITOS: un ASESOR COMERCIAL
// con membership {uid}_{tenantId} subiendo a chat-attachments/{tenantId}/...
//
// Uso:
//   npx firebase-tools emulators:exec --config firebase.e2e.json \
//     --only firestore,storage --project smartflow-hub-os-test \
//     "node scripts/diag_chat_upload_rules.mjs"
//
// El --project DEBE coincidir con PROJECT_ID: sin él, las llamadas cross-service
// firestore.exists() desde Storage Rules no encuentran lo sembrado acá.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { ref, uploadBytes } from 'firebase/storage';
import { setDoc, doc } from 'firebase/firestore';

const PROJECT_ID = 'smartflow-hub-os-test';
const TENANT = 't-1788554584458';
const UID_ASESOR = 'nqjpQTo7teOOsJNoog5EsLQXfKt1';
const UID_AJENO = 'uid-de-otro-negocio';

let pass = 0;
const fails = [];
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`  OK    ${label}`); }
  else { fails.push(label); console.log(`  FALLA ${label} ${extra}`); }
};

const bytes = (n) => new Uint8Array(n).fill(1);

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8085 },
  storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9198 },
});

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  // Mismo shape que producción: el asesor tiene membership activa en el tenant.
  await setDoc(doc(db, 'memberships', `${UID_ASESOR}_${TENANT}`), {
    userId: UID_ASESOR, tenantId: TENANT, role: 'Asesor Comercial', status: 'active', name: 'eduardo pruebas',
  });
});

const asesor = testEnv.authenticatedContext(UID_ASESOR).storage();
const ajeno = testEnv.authenticatedContext(UID_AJENO).storage();

console.log('\n=== Adjuntos de chat como ASESOR COMERCIAL ===');

const intento = async (label, storage, path, size, contentType) => {
  try {
    await uploadBytes(ref(storage, path), bytes(size), { contentType });
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e.code || e.message };
  }
};

const img = await intento('img', asesor, `chat-attachments/${TENANT}/${Date.now()}-foto.jpg`, 2048, 'image/jpeg');
check('sube una imagen al chat', img.ok, img.code || '');

const video = await intento('video', asesor, `chat-attachments/${TENANT}/${Date.now()}-clip.mp4`, 4096, 'video/mp4');
check('sube un video al chat', video.ok, video.code || '');

// Nota de voz: Chrome Android graba en webm/opus, Safari en mp4. Se prueban los dos.
const webm = await intento('webm', asesor, `chat-attachments/${TENANT}/${Date.now()}-nota.webm`, 3072, 'audio/webm;codecs=opus');
check('sube una nota de voz webm/opus (Chrome Android)', webm.ok, webm.code || '');

const mp4a = await intento('mp4a', asesor, `chat-attachments/${TENANT}/${Date.now()}-nota.mp4`, 3072, 'audio/mp4');
check('sube una nota de voz audio/mp4 (Safari)', mp4a.ok, mp4a.code || '');

// Nombre de archivo tal como llega de una cámara Android, con espacios y paréntesis.
const raro = await intento('raro', asesor, `chat-attachments/${TENANT}/${Date.now()}-IMG 20260910 (1).jpg`, 2048, 'image/jpeg');
check('sube con nombre de archivo con espacios y paréntesis', raro.ok, raro.code || '');

// MIME vacío: pasa en algunos Android al elegir de galería.
const sinMime = await intento('sinMime', asesor, `chat-attachments/${TENANT}/${Date.now()}-sinmime.jpg`, 2048, '');
check('sube con contentType vacío (Android suele no informarlo)', sinMime.ok, sinMime.code || '');

console.log('\n=== Aislamiento ===');
const cruzado = await intento('cruzado', ajeno, `chat-attachments/${TENANT}/${Date.now()}-intruso.jpg`, 2048, 'image/jpeg');
check('alguien de otro negocio NO puede subir a este tenant', !cruzado.ok, JSON.stringify(cruzado));

const grande = await intento('grande', asesor, `chat-attachments/${TENANT}/${Date.now()}-enorme.mp4`, 21 * 1024 * 1024, 'video/mp4');
check('un archivo de más de 20MB es rechazado', !grande.ok, JSON.stringify(grande));

console.log(`\n=== RESULTADO: ${pass} OK, ${fails.length} fallos ===`);
fails.forEach((f) => console.log(`  FALLO: ${f}`));
await testEnv.cleanup();
process.exit(fails.length ? 1 : 0);
