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

// ---------------------------------------------------------------------------
// chat-live-video (Live Video productivo) — WRITE con membership + conversation.
// Nota: el emulador NO aplica el límite productivo de 2 documentos Firestore por
// evaluación; ese límite lo cubre la guarda estática en storage.rules.limit.test.ts.
// ---------------------------------------------------------------------------
describe('chat-live-video — escritura aislada por tenant, conversación, uid y rol', () => {
  const T1 = 't-clv-1';
  const T2 = 't-clv-2';
  const CONV1 = 'conv-clv-1'; // pertenece a T1
  const CONV2 = 'conv-clv-2'; // pertenece a T2
  const OWNER = 'clvOwner1';
  const ADVISOR = 'clvAdvisor1';
  const READONLY = 'clvReadonly1';
  const SUSPENDED = 'clvSuspended1';
  const INACTIVE = 'clvInactive1';
  const OTHER_TENANT_MEMBER = 'clvMemberT2'; // solo tiene membership en T2
  const NO_MEMBERSHIP = 'clvNoMember1';
  const SA_NO_MEMBERSHIP = 'superAdminTest1'; // isSuperAdmin:true en users/{uid}, sin membership
  const SA_WITH_MEMBERSHIP = 'clvSuperWithMember1';
  const mp4 = { contentType: 'video/mp4' };
  const clvPath = (tenant: string, conv: string, uid: string, f = 'c0000') => `chat-live-video/${tenant}/${conv}/${uid}/job1234567890/${f}`;
  const up = (uid: string, p: string, bytes: Uint8Array = small, meta: { contentType: string } = mp4) =>
    uploadBytes(ref(st(uid), p), bytes, meta);

  beforeAll(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      const mem = (uid: string, tenantId: string, status: string, role: string) =>
        setDoc(doc(fs, 'memberships', `${uid}_${tenantId}`), { userId: uid, tenantId, status, role });
      await setDoc(doc(fs, 'conversations', CONV1), { tenantId: T1 });
      await setDoc(doc(fs, 'conversations', CONV2), { tenantId: T2 });
      await mem(OWNER, T1, 'active', 'Owner');
      await mem(ADVISOR, T1, 'active', 'Asesor');
      await mem(READONLY, T1, 'active', 'Solo lectura');
      await mem(SUSPENDED, T1, 'suspended', 'Asesor');
      await mem(INACTIVE, T1, 'inactive', 'Asesor');
      await mem(OTHER_TENANT_MEMBER, T2, 'active', 'Owner');
      await mem(SA_WITH_MEMBERSHIP, T1, 'active', 'Owner');
      await setDoc(doc(fs, 'users', SA_WITH_MEMBERSHIP), { isSuperAdmin: true });
    });
  });

  it('1. Owner activo + conversación del mismo tenant + video/mp4 <5MB → ALLOW', async () => {
    await assertSucceeds(up(OWNER, clvPath(T1, CONV1, OWNER)));
  });
  it('2. Asesor activo → ALLOW', async () => {
    await assertSucceeds(up(ADVISOR, clvPath(T1, CONV1, ADVISOR)));
  });
  it('3. Solo lectura → DENY', async () => {
    await assertFails(up(READONLY, clvPath(T1, CONV1, READONLY)));
  });
  it('4. membership suspended / inactive → DENY', async () => {
    await assertFails(up(SUSPENDED, clvPath(T1, CONV1, SUSPENDED)));
    await assertFails(up(INACTIVE, clvPath(T1, CONV1, INACTIVE)));
  });
  it('5. uid del path distinto de request.auth.uid → DENY', async () => {
    await assertFails(up(OWNER, clvPath(T1, CONV1, ADVISOR)));
  });
  it('6. conversación de otro tenant → DENY', async () => {
    await assertFails(up(OWNER, clvPath(T1, CONV2, OWNER)));
  });
  it('7. membership de otro tenant (path del tenant donde no es miembro) → DENY', async () => {
    await assertFails(up(OTHER_TENANT_MEMBER, clvPath(T1, CONV1, OTHER_TENANT_MEMBER)));
  });
  it('8. image/png → DENY', async () => {
    await assertFails(up(OWNER, clvPath(T1, CONV1, OWNER, 'img'), small, { contentType: 'image/png' }));
  });
  it('9. >= 5 MB → DENY', async () => {
    await assertFails(up(OWNER, clvPath(T1, CONV1, OWNER, 'big'), new Uint8Array(5 * 1024 * 1024)));
  });
  it('10. usuario sin membership → DENY', async () => {
    await assertFails(up(NO_MEMBERSHIP, clvPath(T1, CONV1, NO_MEMBERSHIP)));
  });
  it('11. SuperAdmin SIN membership del tenant → DENY', async () => {
    await assertFails(up(SA_NO_MEMBERSHIP, clvPath(T1, CONV1, SA_NO_MEMBERSHIP)));
  });
  it('12. SuperAdmin CON membership activa del tenant → ALLOW', async () => {
    await assertSucceeds(up(SA_WITH_MEMBERSHIP, clvPath(T1, CONV1, SA_WITH_MEMBERSHIP)));
  });
  it('sin autenticar → DENY', async () => {
    const anon = env.unauthenticatedContext().storage();
    await assertFails(uploadBytes(ref(anon, clvPath(T1, CONV1, OWNER)), small, mp4));
  });
});
