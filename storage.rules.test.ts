import { describe, it, beforeAll, afterAll } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { setDoc, doc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

// Corre contra los emuladores REALES de Firestore + Storage:
//   firebase emulators:exec --only firestore,storage "npx vitest run storage.rules.test.ts"
// (storage.rules consulta users/{uid} vía firestore.get para isSuperAdmin).
const QA_UID = 'Bw4GC41RiSQ1s3pw4RpypL2eEcz1';
const OTHER_UID = 'otroUsuario1';
const SA_UID = 'superAdminTest1'; // SuperAdmin vía users/{uid}.isSuperAdmin
const small = new Uint8Array([1, 2, 3]);
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'smartflow-storage-rules-test',
    firestore: { rules: 'rules_version = "2"; service cloud.firestore { match /databases/{d}/documents { match /{x=**} { allow read, write: if true; } } }', host: 'localhost', port: 8080 },
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: 'localhost', port: 9199 },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', SA_UID), { isSuperAdmin: true });
    await setDoc(doc(ctx.firestore(), 'users', QA_UID), { name: 'EDUARDO ADMIN' });
    await setDoc(doc(ctx.firestore(), 'users', OTHER_UID), { name: 'vendedor' });
  });
});
afterAll(async () => { await env.cleanup(); });

const st = (uid: string) => env.authenticatedContext(uid).storage();
const path = (uid: string, f = 'c0000') => `live-video-qa/${uid}/job12345/${f}`;

describe('live-video-qa — excepción QA acotada', () => {
  it('A. EDUARDO ADMIN escribe en su ruta → ALLOW', async () => {
    await assertSucceeds(uploadBytes(ref(st(QA_UID), path(QA_UID)), small));
  });
  it('B. EDUARDO ADMIN lee su propia ruta → ALLOW', async () => {
    await assertSucceeds(getBytes(ref(st(QA_UID), path(QA_UID))));
  });
  it('C. EDUARDO ADMIN en la ruta de otro UID (escribir y leer) → DENY', async () => {
    await assertFails(uploadBytes(ref(st(QA_UID), path(OTHER_UID)), small));
    await assertFails(getBytes(ref(st(QA_UID), path(SA_UID))));
  });
  it('D. vendedor en su propia ruta QA → DENY', async () => {
    await assertFails(uploadBytes(ref(st(OTHER_UID), path(OTHER_UID)), small));
    await assertFails(getBytes(ref(st(OTHER_UID), path(OTHER_UID))));
  });
  it('E. sin autenticar → DENY', async () => {
    const anon = env.unauthenticatedContext().storage();
    await assertFails(uploadBytes(ref(anon, path(QA_UID)), small));
    await assertFails(getBytes(ref(anon, path(QA_UID))));
  });
  it('F. EDUARDO ADMIN en admin_attachments → sigue DENY (no se amplía)', async () => {
    await assertFails(uploadBytes(ref(st(QA_UID), 'admin_attachments/x.bin'), small));
    await assertFails(getBytes(ref(st(QA_UID), 'admin_attachments/x.bin')));
  });
  it('G. SuperAdmin escribe y lee su ruta QA → ALLOW (y no la de otro)', async () => {
    await assertSucceeds(uploadBytes(ref(st(SA_UID), path(SA_UID)), small));
    await assertSucceeds(getBytes(ref(st(SA_UID), path(SA_UID))));
    await assertFails(uploadBytes(ref(st(SA_UID), path(QA_UID, 'c0009')), small));
  });
  it('H. chunk que excede el límite (5 MB) → DENY', async () => {
    await assertFails(uploadBytes(ref(st(QA_UID), path(QA_UID, 'big')), new Uint8Array(5 * 1024 * 1024)));
  });
});
