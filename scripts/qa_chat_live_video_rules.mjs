// Prueba de las Storage Rules de chat-live-video/ contra los EMULADORES (nunca producción).
// Requiere: npx firebase-tools emulators:start --only firestore,storage --project smartflow-e2e --config firebase.e2e.json
// Uso: node scripts/qa_chat_live_video_rules.mjs
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

const PROJECT = 'smartflow-e2e';
const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { host: '127.0.0.1', port: 8085, rules: 'rules_version = "2"; service cloud.firestore { match /databases/{d}/documents { match /{x=**} { allow read, write: if true; } } }' },
  storage: { host: '127.0.0.1', port: 9198, rules: readFileSync('storage.rules', 'utf8') },
});

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await db.doc('memberships/asesor_tA').set({ tenantId: 'tA', userId: 'asesor', status: 'active', role: 'Asesor Comercial' });
  await db.doc('memberships/lector_tA').set({ tenantId: 'tA', userId: 'lector', status: 'active', role: 'Solo lectura' });
  await db.doc('memberships/baja_tA').set({ tenantId: 'tA', userId: 'baja', status: 'suspended', role: 'Asesor Comercial' });
  await db.doc('memberships/otro_tB').set({ tenantId: 'tB', userId: 'otro', status: 'active', role: 'Owner' });
  await db.doc('users/root').set({ isSuperAdmin: true });
  await db.doc('conversations/convA').set({ tenantId: 'tA' });
  await db.doc('conversations/convB').set({ tenantId: 'tB' });
});

const chunk = new Uint8Array(1024);
const meta = { contentType: 'video/mp4' };
const path = (t, c, u, j = 'job12345', f = 'c0000') => `chat-live-video/${t}/${c}/${u}/${j}/${f}`;
const put = (uid, p, m = meta, data = chunk) => uploadBytes(ref(env.authenticatedContext(uid).storage(), p), data, m);

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log('PASS', name); } catch (e) { fails++; console.log('FAIL', name, '-', String(e.message || e).slice(0, 160)); }
};

await check('asesor activo escribe su chunk en su tenant/conversación', () => assertSucceeds(put('asesor', path('tA', 'convA', 'asesor'))));
await check('asesor NO escribe en la carpeta de otro uid', () => assertFails(put('asesor', path('tA', 'convA', 'lector'))));
await check('asesor NO escribe en otro tenant (aunque la conversación sea de ese tenant)', () => assertFails(put('asesor', path('tB', 'convB', 'asesor'))));
await check('asesor NO escribe con conversación de otro tenant en su propio tenant', () => assertFails(put('asesor', path('tA', 'convB', 'asesor'))));
await check('miembro de OTRO tenant NO escribe en tA', () => assertFails(put('otro', path('tA', 'convA', 'otro'))));
await check('miembro de otro tenant sí escribe en SU tenant', () => assertSucceeds(put('otro', path('tB', 'convB', 'otro'))));
await check('Solo lectura NO escribe', () => assertFails(put('lector', path('tA', 'convA', 'lector'))));
await check('membresía suspendida NO escribe', () => assertFails(put('baja', path('tA', 'convA', 'baja'))));
await check('sin sesión NO escribe', () => assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(), path('tA', 'convA', 'x')), chunk, meta)));
await check('conversación inexistente NO escribe', () => assertFails(put('asesor', path('tA', 'noexiste', 'asesor'))));
await check('contentType no-video NO escribe', () => assertFails(put('asesor', path('tA', 'convA', 'asesor', 'job12345', 'c0001'), { contentType: 'text/html' })));
await check('chunk >= 5 MB NO escribe', () => assertFails(put('asesor', path('tA', 'convA', 'asesor', 'job12345', 'c0002'), meta, new Uint8Array(5 * 1024 * 1024 + 1))));
await check('SuperAdmin escribe su carpeta de una conversación del tenant', () => assertSucceeds(put('root', path('tA', 'convA', 'root'))));
await check('SuperAdmin NO escribe con conversación de otro tenant', () => assertFails(put('root', path('tA', 'convB', 'root'))));
await check('lectura: miembro del tenant lee', () => assertSucceeds(getBytesAs('asesor', path('tA', 'convA', 'asesor'))));
await check('lectura: miembro de otro tenant NO lee', () => assertFails(getBytesAs('otro', path('tA', 'convA', 'asesor'))));

function getBytesAs(uid, p) { return getBytes(ref(env.authenticatedContext(uid).storage(), p)); }

await env.cleanup();
console.log(fails === 0 ? 'ALL_PASS' : `FAILED=${fails}`);
process.exit(fails === 0 ? 0 : 1);
