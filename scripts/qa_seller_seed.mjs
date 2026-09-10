// ═══════════════════════════════════════════════════════════════════════
// QA LOCAL DEL PUESTO DEL VENDEDOR — datos de prueba en los EMULADORES.
//
// Arma un negocio como USADITOS (Owner + Asesor Comercial vinculado con
// código, conversación de WhatsApp con la ventana de 24 h abierta, catálogo,
// plantillas, Multi-Agente en Modo Libre) usando las Cloud Functions reales:
// setVendorPin → loginWithPin → acceptTenantInvite → registerDevice. Deja el
// teléfono "vinculado" exactamente como queda después del primer ingreso:
// identidad + deviceId + credencial de dispositivo. El código de acceso NO se
// guarda en ningún lado; solo se usa acá, contra el emulador.
//
// Nunca toca producción: exige FIRESTORE_EMULATOR_HOST y el proyecto
// smartflow-e2e.
//
// Uso (con los emuladores de firebase.e2e.json levantados):
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9098 \
//   GCLOUD_PROJECT=smartflow-e2e FUNCTIONS_EMULATOR_PORT=5011 \
//   node scripts/qa_seller_seed.mjs <salida.json>
// ═══════════════════════════════════════════════════════════════════════
import admin from 'firebase-admin';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const PROJECT = process.env.GCLOUD_PROJECT;
if (!process.env.FIRESTORE_EMULATOR_HOST || PROJECT !== 'smartflow-e2e') {
  console.error('Solo contra los emuladores (FIRESTORE_EMULATOR_HOST + GCLOUD_PROJECT=smartflow-e2e).');
  process.exit(1);
}
const FN_BASE = `http://127.0.0.1:${process.env.FUNCTIONS_EMULATOR_PORT || '5001'}/${PROJECT}/us-central1`;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const OUT = process.argv[2] || 'qa_seller_seed.json';

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const TS = admin.firestore.Timestamp;

async function callFn(name, data, idToken) {
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const json = await res.json().catch(() => ({}));
  if (json.error) throw new Error(`${name}: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function signIn(path, body) {
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:${path}?key=fake-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, returnSecureToken: true }),
  });
  const j = await res.json();
  if (!j.idToken) throw new Error(`${path}: ${JSON.stringify(j)}`);
  return j.idToken;
}

const TA = 't-qa-usaditos';
const TB = 't-qa-otro-negocio';
const FEATURES = {
  hasCrm: true, hasQuotes: true, hasPackages: true, hasAgenda: true, hasIntegrations: true,
  hasCatalog: true, hasPaymentLinks: true, hasTasks: true, hasMultiAgent: true, hasMultiAgentPanel: true,
};

(async () => {
  await db.collection('tenants').doc(TA).set({ name: 'USADITOS QA', createdBy: 'seed', features: FEATURES, status: 'active' });
  await db.collection('tenants').doc(TB).set({ name: 'Otro Negocio QA', createdBy: 'seed', features: FEATURES, status: 'active' });

  const owner = await admin.auth().createUser({ email: 'owner@qa.test', password: 'Secret123!', displayName: 'Eduardo Owner' });
  await db.collection('users').doc(owner.uid).set({ id: owner.uid, name: 'Eduardo Owner', email: 'owner@qa.test', isActive: true });
  await db.collection('memberships').doc(`${owner.uid}_${TA}`).set({
    tenantId: TA, userId: owner.uid, name: 'Eduardo Owner', email: 'owner@qa.test', role: 'Owner', status: 'active',
  });

  // Asesor cargado por el Owner (prepared) y vinculado con su código.
  const prepared = await db.collection('memberships').add({
    tenantId: TA, userId: null, name: 'Asesor QA', role: 'Asesor Comercial', status: 'prepared', email: null,
  });
  const ownerToken = await signIn('signInWithPassword', { email: 'owner@qa.test', password: 'Secret123!' });
  const gen = await callFn('setVendorPin', { membershipId: prepared.id }, ownerToken);
  const login = await callFn('loginWithPin', { tenantId: TA, loginHandle: gen.loginHandle, pin: gen.pin });
  let vendorToken = await signIn('signInWithCustomToken', { token: login.customToken });
  await callFn('acceptTenantInvite', {}, vendorToken);
  vendorToken = await signIn('signInWithCustomToken', { token: login.customToken });

  const deviceId = randomUUID();
  const reg = await callFn('registerDevice', { deviceId, tenantId: TA, label: 'Teléfono QA' }, vendorToken);
  if (!reg.deviceSecret) throw new Error('registerDevice no emitió credencial de dispositivo');

  const vendorUid = JSON.parse(Buffer.from(vendorToken.split('.')[1], 'base64url').toString()).user_id;
  await callFn('setOperationalStatus', { tenantId: TA, status: 'working' }, vendorToken);

  await db.collection('settings').doc(TA).set({
    templates: {
      welcomeMessage: 'Hola {{leadName}}, bienvenido a {{companyName}}.',
      quoteMessage: 'Hola {{leadName}}, te comparto la cotización {{quoteNumber}}.',
      meetingReminder: 'Hola {{leadName}}, te recuerdo nuestra cita.',
      followUpMessage: 'Hola {{leadName}}, ¿pudiste revisar la información?',
    },
    multiAgentConfig: { mode: 'free', includedUserIds: [vendorUid] },
    // El menú lee los feature flags de settings/{tenantId}, no del doc del tenant.
    features: FEATURES,
    company: { tradeName: 'USADITOS QA', legalName: 'USADITOS QA', phone: '+50688880000' },
    commercial: { currency: 'USD' },
    sinpePhone: '8888-0000', sinpeOwner: 'USADITOS QA', sinpeId: '3-101-000000',
    bankAccounts: [{ id: 'qa-bank-1', bankName: 'Banco QA', accountNumber: 'CR00 0000 0000 0000 0000', owner: 'USADITOS QA' }],
  }, { merge: true });

  for (const [i, p] of [['Sofá 3 plazas', 450], ['Refrigeradora', 780], ['Juego de comedor', 620]].entries()) {
    await db.collection('catalog').doc(`qa-item-${i}`).set({
      tenantId: TA, name: p[0], description: `${p[0]} usado en buen estado`, rate: p[1], currency: 'USD',
      imageUrl: '', createdAt: new Date().toISOString(),
    });
  }

  // Conversación sin asignar (Modo Libre) con un mensaje entrante de hace 5 min:
  // la ventana de 24 h está abierta, así que se ve la barra de mensajes.
  const now = Date.now();
  const convs = [
    { id: 'qa-conv-1', name: 'Cliente Prueba Uno', text: 'Hola, ¿tienen el sofá disponible?', minutesAgo: 5 },
    { id: 'qa-conv-2', name: 'Cliente Prueba Dos', text: 'Buenas, quiero info de la refri', minutesAgo: 12 },
  ];
  for (const c of convs) {
    const at = TS.fromMillis(now - c.minutesAgo * 60000);
    await db.collection('conversations').doc(c.id).set({
      tenantId: TA, contactName: c.name, source: 'whatsapp', phoneRaw: '88887777', phoneE164: '+50688887777',
      phoneSearchKey: '88887777', lastMessage: c.text, lastMessageDate: at, lastInboundDate: at,
      lastMessageSender: 'lead', unreadCount: 1, advisorId: '', status: 'active', updatedAt: at,
    });
    await db.collection('conversations').doc(c.id).collection('messages').add({
      text: c.text, sender: 'lead', direction: 'inbound', timestamp: at, type: 'text',
    });
  }
  // Conversación de OTRO negocio: el asesor no debe verla nunca.
  await db.collection('conversations').doc('qa-conv-ajena').set({
    tenantId: TB, contactName: 'Cliente Ajeno', source: 'whatsapp', phoneRaw: '1', phoneE164: '+1', phoneSearchKey: '1',
    lastMessage: 'no deberías ver esto', lastMessageDate: TS.now(), lastMessageSender: 'lead', unreadCount: 1,
    advisorId: '', status: 'active', updatedAt: TS.now(),
  });

  writeFileSync(OUT, JSON.stringify({
    tenantId: TA,
    vendorUid,
    identity: { tenantId: TA, loginHandle: gen.loginHandle, displayName: login.displayName || 'Asesor QA' },
    deviceId,
    deviceSecret: reg.deviceSecret,
  }, null, 2));
  console.log(`SEED OK — asesor ${gen.loginHandle} (${vendorUid}) vinculado; datos del teléfono en ${OUT}`);
  process.exit(0);
})().catch((e) => { console.error('SEED FALLÓ', e); process.exit(1); });
