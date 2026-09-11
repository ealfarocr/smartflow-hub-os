// ═══════════════════════════════════════════════════════════════════════
// QA LOCAL DEL PUESTO DEL VENDEDOR — un "teléfono" Chromium con pantalla
// táctil de Android manejando la app real contra los emuladores.
//
// No simula clicks en JS: los toques van por el pipeline de entrada del
// navegador (CDP Input.dispatchTouchEvent → hit-test → gesture tap → click),
// igual que un dedo. Para los adjuntos usa la intercepción del selector de
// archivos de Chromium: waitForFileChooser() SOLO resuelve si el navegador
// realmente iba a abrir el diálogo nativo — es la prueba de "el clip abre".
// El micrófono es el dispositivo falso de Chromium (--use-fake-device…).
//
// Requisitos:
//   1. Emuladores: FUNCTIONS_DISCOVERY_TIMEOUT=90 npx firebase-tools emulators:start \
//        --config firebase.e2e.json --only functions,firestore,auth,storage --project smartflow-e2e
//   2. Datos: node scripts/qa_seller_seed.mjs <qa_seed.json>  (ver su cabecera)
//   3. La app en modo qalocal. Recomendado el BUILD (sin StrictMode, igual que
//      producción): npx vite build --mode qalocal --outDir <dir> &&
//      npx vite preview --mode qalocal --outDir <dir> --port 5175
//      (o el dev server: npx vite --mode qalocal --port 5174)
//   4. puppeteer-core instalado en cualquier carpeta (QA_PUPPETEER_FROM=<esa
//      carpeta>/package.json) y un Chromium o Edge (QA_BROWSER).
//   QA_BASE=http://localhost:5175 QA_SEED=<qa_seed.json> node scripts/qa_seller_workstation.mjs
// QA_SOAK_MINUTES=N agrega N minutos de uso continuo al final.
// ═══════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(process.env.QA_PUPPETEER_FROM || import.meta.url);
const puppeteer = require('puppeteer-core');

const BASE = process.env.QA_BASE || 'http://localhost:5174';
const SEED = JSON.parse(readFileSync(process.env.QA_SEED, 'utf8'));
const BROWSER = process.env.QA_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SOAK_MIN = Number(process.env.QA_SOAK_MINUTES || 0);
const FN_BASE = `http://127.0.0.1:5011/smartflow-e2e/us-central1`;
const OUT_DIR = process.env.QA_OUT || join(tmpdir(), 'smartflow-qa');
mkdirSync(OUT_DIR, { recursive: true });

// Archivos de prueba reales (cabeceras válidas) con el nombre que les pone un teléfono.
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const MP4 = Buffer.concat([Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex'), Buffer.alloc(40 * 1024, 1)]);
const files = {
  jpg: join(OUT_DIR, 'IMG_20260910_101500.jpg'),
  png: join(OUT_DIR, 'Screenshot_20260910.png'),
  mp4: join(OUT_DIR, 'VID_20260910_101600.mp4'),
};
writeFileSync(files.jpg, JPG); writeFileSync(files.png, PNG); writeFileSync(files.mp4, MP4);
// Videos de cámara reales pesan: 15 MB (entra, muestra el avance de la subida
// reanudable) y 17 MB (pasa el límite de 16 MB de WhatsApp: aviso claro).
files.mp4_15mb = join(OUT_DIR, 'VID_20260911_091500.mp4');
files.mp4_17mb = join(OUT_DIR, 'VID_20260911_091700.mp4');
writeFileSync(files.mp4_15mb, Buffer.concat([MP4.subarray(0, 24), Buffer.alloc(15 * 1024 * 1024, 7)]));
writeFileSync(files.mp4_17mb, Buffer.concat([MP4.subarray(0, 24), Buffer.alloc(17 * 1024 * 1024, 7)]));

const results = {};
const notes = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function record(key, ok, detail = '') {
  results[key] = ok ? 'YES' : 'NO';
  console.log(`${ok ? '  OK  ' : ' FALLA'} ${key}${detail ? ` — ${detail}` : ''}`);
}

const browser = await puppeteer.launch({
  executablePath: BROWSER,
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-first-run', '--lang=es-CR'],
});
const page = await browser.newPage();
await page.emulate({
  viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
});
const origin = new URL(BASE).origin;
await browser.defaultBrowserContext().overridePermissions(origin, ['microphone', 'camera', 'clipboard-read', 'clipboard-sanitized-write']);

// Foto de cámara realista (4000x3000, más de 5 MB): la codifica el propio Chromium.
await page.goto('about:blank');
const bigJpgB64 = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 4000; c.height = 3000;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(4000, 3000); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = Math.random() * 255; d[i + 1] = (i >> 6) % 255; d[i + 2] = Math.random() * 255; d[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  const buf = new Uint8Array(await b.arrayBuffer()); let out = '';
  for (let i = 0; i < buf.length; i += 0x8000) out += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(out);
});
files.bigJpg = join(OUT_DIR, 'IMG_20260911_090000.jpg');
writeFileSync(files.bigJpg, Buffer.from(bigJpgB64, 'base64'));
console.log(`foto de cámara de prueba: ${(Buffer.from(bigJpgB64, 'base64').length / 1048576).toFixed(1)} MB`);

const consoleErrors = [];
await page.evaluateOnNewDocument(() => {
  window.__toastLog = [];
  new MutationObserver(() => {
    document.querySelectorAll('[data-toasts] > *').forEach((n) => { const t = n.innerText.trim(); if (t && !n.__seen) { n.__seen = true; window.__toastLog.push(t); } });
  }).observe(document, { childList: true, subtree: true });
});
const toasts = new Set();
let burstDuplicates = 0;
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('dialog', (d) => d.accept()); // "¿Cerrar sesión?"
page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR ${e.message}`));

const diag = () => page.evaluate(() => (window.__sfMediaDiag?.() || []).map((e) => e.step));
const diagFull = () => page.evaluate(() => window.__sfMediaDiag?.() || []);
const clearDiag = () => page.evaluate(() => { const l = window.__sfMediaDiag?.(); if (l) l.length = 0; });
const hasStep = async (step) => (await diag()).includes(step);
async function waitStep(step, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await hasStep(step)) return true; await sleep(150); }
  return false;
}
const path = () => page.evaluate(() => location.pathname);
async function waitPath(p, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if ((await path()) === p) return true; await sleep(150); }
  return false;
}
const bodyText = () => page.evaluate(() => document.body.innerText);
async function waitText(t, timeout = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if ((await bodyText()).includes(t)) return true; await sleep(150); }
  return false;
}
async function collectToasts() {
  const list = await page.evaluate(() => { const l = window.__toastLog || []; window.__toastLog = []; return l; });
  list.forEach((t) => toasts.add(t));
  if (new Set(list).size !== list.length) burstDuplicates++;
  return list;
}

/** Centro visible de un elemento + qué elemento recibe realmente el toque en ese punto. */
async function tapTarget(handle) {
  // Solo se desplaza si el elemento está fuera de la pantalla, como haría una persona.
  await handle.evaluate((el) => { const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) el.scrollIntoView({ block: 'nearest' }); });
  const box = await handle.boundingBox();
  if (!box) throw new Error('elemento sin caja (oculto)');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const hit = await page.evaluate((x, y, el) => {
    const top = document.elementFromPoint(x, y);
    return { ok: !!top && (top === el || el.contains(top)), top: top ? `${top.tagName.toLowerCase()}.${String(top.className).split(' ').slice(0, 2).join('.')}` : 'nada' };
  }, x, y, handle);
  return { x, y, hit };
}
async function tap(handle, label) {
  const { x, y, hit } = await tapTarget(handle);
  if (!hit.ok) {
    notes.push(`${label}: el punto de toque lo recibe ${hit.top} (TAPADO)`);
    await page.screenshot({ path: join(OUT_DIR, `tapado-${label.replace(/\W+/g, '_')}.png`) }).catch(() => {});
  }
  await page.touchscreen.tap(x, y);
  return hit;
}
const $text = async (text, root = 'button', exact = false) => {
  const hs = await page.$$(root);
  for (const h of hs) {
    const t = await h.evaluate((el) => el.innerText || el.getAttribute('title') || el.getAttribute('aria-label') || '');
    const a = t.trim().toLowerCase(), b = text.toLowerCase();
    if (exact ? a === b : a.includes(b)) return h;
  }
  return null;
};

async function chooserFlow(label, input, file, { expectAccept, expectCapture, expectMultiple, diagPrefix, tapStep, focusFirst }) {
  await clearDiag();
  let chooser = null;
  try {
    [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 6000 }), tap(input, label)]);
  } catch {
    const ev = await diagFull();
    record(`${label}_OPENS_OK`, false, `el selector NO abrió · panel: ${ev.map((e) => e.step).join(', ') || '(nada)'}`);
    return false;
  }
  const attrs = await input.evaluate((el) => ({ accept: el.accept, capture: el.getAttribute('capture'), multiple: el.multiple }));
  const detail = attrs ? `accept=${attrs.accept} capture=${attrs.capture || '-'} multiple=${attrs.multiple}` : '';
  const attrsOk = !attrs || (attrs.accept === expectAccept && (attrs.capture || null) === expectCapture && attrs.multiple === expectMultiple);
  // El click tiene que haber llegado AL input (listener nativo) — es lo que en
  // el teléfono nunca aparecía.
  const tapSeen = !tapStep || (await diag()).includes(tapStep);
  record(`${label}_OPENS_OK`, attrsOk && tapSeen, `${detail}${tapStep ? ` ${tapStep}:${tapSeen ? 'ok' : 'x'}` : ''}`);
  // Orden REAL de Android al volver de la cámara: la ventana recupera el foco
  // ANTES de que llegue el archivo (change). Se reproduce ese orden.
  if (focusFirst) { await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(150); }
  await chooser.accept([file]);
  const ready = await waitStep(`${diagPrefix}_ATTACHMENT_READY`, 20000);
  const steps = await diag();
  const pipeline = ['FILE_SELECTED', 'AUTH_OK', 'TOKEN_REFRESH_OK', 'UPLOAD_START', 'UPLOAD_OK', 'DOWNLOAD_URL_OK', 'ATTACHMENT_READY']
    .map((s) => `${s}:${steps.includes(`${diagPrefix}_${s}`) ? 'ok' : 'x'}`).join(' ');
  record(`${label}_UPLOAD_OK`, ready, pipeline + (steps.find((s) => s.endsWith('_FAILED_AT')) ? ' · FAILED_AT' : ''));
  return ready;
}

// Cada corrida vincula un teléfono NUEVO, igual que en la vida real: el Owner
// genera el código, se entra una vez con él y el servidor emite la credencial de
// dispositivo. (La corrida anterior termina revocando el equipo a propósito.)
async function callFn(name, data, idToken) {
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const j = await res.json().catch(() => ({}));
  if (j.error) throw new Error(`${name}: ${JSON.stringify(j.error)}`);
  return j.result;
}
async function signIn(kind, body) {
  const r = await fetch(`http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:${kind}?key=fake-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, returnSecureToken: true }),
  }).then((x) => x.json());
  return r.idToken;
}
const ownerToken = () => signIn('signInWithPassword', { email: 'owner@qa.test', password: 'Secret123!' });
const gen = await callFn('setVendorPin', { membershipId: `${SEED.vendorUid}_${SEED.tenantId}` }, await ownerToken());
const pinLogin = await callFn('loginWithPin', { tenantId: SEED.tenantId, loginHandle: gen.loginHandle, pin: gen.pin });
const DEVICE = { deviceId: crypto.randomUUID() };
DEVICE.deviceSecret = (await callFn('registerDevice', { deviceId: DEVICE.deviceId, tenantId: SEED.tenantId, label: 'Teléfono QA' },
  await signIn('signInWithCustomToken', { token: pinLogin.customToken }))).deviceSecret;
await callFn('setOperationalStatus', { tenantId: SEED.tenantId, status: 'working' }, await signIn('signInWithCustomToken', { token: pinLogin.customToken }));

// Cada corrida empieza con las conversaciones sin asignar (Modo Libre).
for (const id of ['qa-conv-1', 'qa-conv-2']) {
  await fetch(`http://127.0.0.1:8085/v1/projects/smartflow-e2e/databases/(default)/documents/conversations/${id}?updateMask.fieldPaths=advisorId`, {
    method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { advisorId: { stringValue: '' } } }),
  });
}

try {
  // ── A. ACCESO: teléfono ya vinculado, sesión cerrada ─────────────────
  console.log('\n== A. Acceso / reentrada ==');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('smartflow_vendor_identity', JSON.stringify(s.identity));
    localStorage.setItem('smartflow_device_id', s.deviceId);
    localStorage.setItem('smartflow_device_secret', s.deviceSecret);
    localStorage.setItem('smartflow_qa', '1');
  }, { ...SEED, ...DEVICE });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await waitPath('/acceso');
  const saludo = (await waitText(SEED.identity.displayName)) && /hola/i.test(await bodyText());
  const pideCodigo = await page.$('input[inputmode="numeric"], input[type="password"]');
  record('LOGOUT_PRESERVES_DEVICE_OK', saludo && !pideCodigo, `saludo=${saludo} campoCodigo=${!!pideCodigo}`);

  const hold = await page.waitForSelector('button[aria-label="Mantené presionado para entrar"]');
  // Toque corto: NO debe entrar (el gesto exige 500 ms).
  const hb = await tapTarget(hold);
  await page.touchscreen.tap(hb.x, hb.y);
  await sleep(1500);
  const shortTapStays = (await path()) === '/acceso';
  // Mantener 700 ms.
  await page.touchscreen.touchStart(hb.x, hb.y); await sleep(700); await page.touchscreen.touchEnd();
  const inWhatsapp = await waitPath('/conversaciones', 20000);
  record('QUICK_REENTRY_500MS_OK', shortTapStays && inWhatsapp, `toqueCortoNoEntra=${shortTapStays} → ${await path()}`);
  record('ADVISOR_DEFAULT_WHATSAPP_OK', inWhatsapp);

  // ── B. WhatsApp: inbound + tomar conversación ───────────────────────
  console.log('\n== B. WhatsApp ==');
  await waitText('Cliente Prueba Uno');
  const txt = await bodyText();
  record('INBOUND_WHATSAPP_OK', txt.includes('Cliente Prueba Uno') && txt.includes('¿tienen el sofá disponible?'));
  record('CROSS_TENANT_SAFE', !txt.includes('Cliente Ajeno'), 'la conversación de otro negocio no aparece');
  const conv = await page.waitForSelector('::-p-text(Cliente Prueba Uno)');
  await tap(conv, 'conversación');
  await page.waitForSelector('textarea', { timeout: 8000 }).catch(() => {});
  // La tarjeta de PRUEBA MEDIA NATIVA del modo QA va arriba y tapa la cabecera
  // del chat (Tomar): se pliega para el flujo normal y se usa en la fase C2.
  const toggleProbe = async () => { const b = await $text('prueba', 'button', true); if (b) { await tap(b, 'prueba'); await sleep(300); } };
  await page.screenshot({ path: join(OUT_DIR, 'chat-modo-qa.png') }).catch(() => {});
  if (await page.$('[data-qa-probe]')) await toggleProbe();
  const tomar = await $text('Tomar');
  if (tomar) {
    await tap(tomar, 'Tomar');
    const ok = await waitText('Ya es tuya', 10000);
    record('CLAIM_CONVERSATION_OK', ok, ok ? '' : (await collectToasts()).join(' | '));
  } else record('CLAIM_CONVERSATION_OK', false, 'no aparece el botón Tomar');

  // ── C. MEDIA ─────────────────────────────────────────────────────────
  console.log('\n== C. Media ==');
  const clip = await page.waitForSelector('[data-media-input="gallery"]');
  await chooserFlow('CLIP', clip, files.jpg, { expectAccept: 'image/*,video/*', expectCapture: null, expectMultiple: true, diagPrefix: 'CLIP', tapStep: 'CLIP_TAP' });
  results.GALLERY_IMAGE_OK = results.CLIP_UPLOAD_OK;
  const clip2 = await page.$('[data-media-input="gallery"]');
  await chooserFlow('CLIP_PNG', clip2, files.png, { expectAccept: 'image/*,video/*', expectCapture: null, expectMultiple: true, diagPrefix: 'CLIP', tapStep: 'CLIP_TAP' });
  const clip3 = await page.$('[data-media-input="gallery"]');
  await chooserFlow('CLIP_VIDEO', clip3, files.mp4, { expectAccept: 'image/*,video/*', expectCapture: null, expectMultiple: true, diagPrefix: 'CLIP', tapStep: 'CLIP_TAP' });

  const openCameraMenu = async () => {
    const cam = await page.waitForSelector('button[title="Cámara"]');
    await tap(cam, 'cámara');
    // El menú está siempre montado (oculto con CSS): se espera a que esté ABIERTO.
    await page.waitForSelector('[data-camera-menu="abierto"]', { timeout: 4000 });
  };
  await openCameraMenu();
  const photo = await page.$('[data-media-input="photo"]');
  await chooserFlow('CAMERA_PHOTO', photo, files.bigJpg, { expectAccept: 'image/*', expectCapture: 'environment', expectMultiple: false, diagPrefix: 'PHOTO', tapStep: 'PHOTO_TAP', focusFirst: true });
  const comp = (await diagFull()).find((e) => e.step === 'PHOTO_IMAGE_COMPRESSED')?.data;
  record('PHOTO_COMPRESSED_OK', !!comp && comp.despuesKb < 5 * 1024, comp ? `${comp.antesKb} KB → ${comp.despuesKb} KB` : 'no se comprimió');
  // Al volver de la cámara la ventana recupera el foco y el menú se cierra.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sleep(300);
  await openCameraMenu();
  const video = await page.$('[data-media-input="video"]');
  await chooserFlow('CAMERA_VIDEO', video, files.mp4_15mb, { expectAccept: 'video/*', expectCapture: 'environment', expectMultiple: false, diagPrefix: 'VIDEO', tapStep: 'VIDEO_TAP', focusFirst: true });
  const prog = (await diagFull()).filter((e) => e.step === 'VIDEO_UPLOAD_PROGRESS').map((e) => e.data?.pct);
  record('VIDEO_UPLOAD_PROGRESS_OK', prog.length > 0, `avance: ${prog.reverse().join('% → ')}%`);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));

  const previews = await page.evaluate(() => document.querySelectorAll('form .w-16.h-16').length);
  const errores = await page.evaluate(() => document.querySelectorAll('form .w-16.h-16 .bg-red-500\\/70').length);
  record('ATTACHMENT_READY_OK', previews >= 5 && errores === 0, `previews=${previews} conError=${errores}`);

  // Video de 17 MB (más que el límite de WhatsApp): aviso claro, sin subir, sin salir de la sesión.
  await clearDiag(); await collectToasts();
  const clipBig = await page.$('[data-media-input="gallery"]');
  const [chBig] = await Promise.all([page.waitForFileChooser({ timeout: 6000 }), tap(clipBig, 'clip')]);
  await chBig.accept([files.mp4_17mb]);
  await sleep(1500);
  const tBig = await collectToasts();
  const stBig = await diag();
  record('MEDIA_TOO_LARGE_IS_CLEAR', stBig.includes('CLIP_REJECTED_TOO_LARGE') && !stBig.includes('CLIP_UPLOAD_START')
    && tBig.some((t) => t.includes('máximo 16MB para video')) && (await path()) === '/conversaciones', tBig.join(' | '));

  // ── C2. PRUEBA MEDIA NATIVA (fuera del chat) + copia del clip + DOM ──
  console.log('\n== C2. Prueba nativa del panel QA ==');
  await toggleProbe();
  const nat = (k) => page.$(`input[data-qa-native="${k}"]`);
  await chooserFlow('QA_NATIVE_GALLERY', await nat('GALLERY'), files.jpg, { expectAccept: 'image/*,video/*', expectCapture: null, expectMultiple: true, diagPrefix: 'CLIP', tapStep: 'QA_GALLERY_TAP' });
  await chooserFlow('QA_NATIVE_PHOTO', await nat('PHOTO'), files.jpg, { expectAccept: 'image/*', expectCapture: 'environment', expectMultiple: false, diagPrefix: 'PHOTO', tapStep: 'QA_PHOTO_TAP' });
  await chooserFlow('QA_NATIVE_VIDEO', await nat('VIDEO'), files.mp4, { expectAccept: 'video/*', expectCapture: 'environment', expectMultiple: false, diagPrefix: 'VIDEO', tapStep: 'QA_VIDEO_TAP' });
  const copy = await page.$('[data-qa-probe] input[type=file]:not([data-qa-native])');
  await chooserFlow('QA_CHATCOPY', copy, files.png, { expectAccept: 'image/*,video/*', expectCapture: null, expectMultiple: true, diagPrefix: 'CLIP', tapStep: 'QA_CHATCOPY_TAP' });
  await toggleProbe();
  // Foto del DOM desde la pastilla: el clip y la cámara reciben su propio toque.
  await clearDiag();
  const domBtn = await $text('DOM', 'button', true);
  await tap(domBtn, 'DOM');
  await sleep(300);
  const dom = await diagFull();
  const domClip = dom.find((e) => e.step === 'DOM_CLIP')?.data;
  const domCam = dom.find((e) => e.step === 'DOM_CAMERA')?.data;
  record('DOM_AUDIT_OK', !!domClip?.loRecibeElInput && !!domCam?.loRecibeElInput && domClip?.deshabilitado === false,
    `clip: ${JSON.stringify(domClip)} · cámara: ${JSON.stringify(domCam)}`);

  // ── C3. Copiar diagnóstico, limpiar y detector con la lista abierta ──
  console.log('\n== C3. Panel QA: copiar / limpiar / detector ==');
  const copyBtn = await $text('📋 COPIAR DIAGNÓSTICO', 'button', true);
  await tap(copyBtn, 'copiar diagnóstico');
  const copiedFeedback = await waitText('Diagnóstico copiado', 4000);
  const copied = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => `ERROR ${e.message}`);
  const clipOk = ['Navegador:', 'showPicker:', 'Táctil:', 'Controles del chat: visibles: clip, camera', 'DOM_CLIP', 'CONTROL_RENDERED']
    .every((s) => copied.includes(s));
  record('COPY_DIAGNOSTIC_OK', copiedFeedback && clipOk, `aviso=${copiedFeedback} · portapapeles ${copied.length} caracteres · primera línea: ${copied.split('\n')[0]}`);
  const clearBtn = await $text('🧹 LIMPIAR', 'button', true);
  await tap(clearBtn, 'limpiar');
  await sleep(300);
  const afterClear = (await diag()).length;
  record('CLEAR_DIAGNOSTIC_OK', afterClear === 0 && (await waitText('Registro limpio', 2000)), `eventos tras limpiar: ${afterClear}`);
  // Con la LISTA abierta no hay composer: el detector debe decirlo con palabras.
  const backBtn = await page.$('button[aria-label="Volver a las conversaciones"]');
  await tap(backBtn, 'volver');
  await sleep(400);
  const listTitle = await page.waitForSelector('::-p-text(WhatsApp Business)');
  await tap(listTitle, 'título de la lista');
  await sleep(300);
  const toqueLista = (await diagFull()).find((e) => e.step === 'TOQUE')?.data?.control || '';
  const estadoLista = (await diagFull()).find((e) => e.step === 'CHAT_STATE')?.data?.conversacion || '';
  record('CONTROL_DETECTION_FIXED', /no hay conversación abierta/.test(toqueLista) && /lista/.test(estadoLista), `TOQUE.control="${toqueLista}" · CHAT_STATE="${estadoLista}"`);
  const conv1 = await page.waitForSelector('::-p-text(Cliente Prueba Uno)');
  await tap(conv1, 'conversación');
  await page.waitForSelector('textarea', { timeout: 8000 }).catch(() => {});

  // Enviar: Meta bloqueado (en el emulador no hay integración) → mensaje claro, sin logout.
  await clearDiag();
  const send = await page.$('button[type=submit]');
  await tap(send, 'enviar');
  await sleep(4000);
  const tSend = await collectToasts();
  const technical = tSend.some((t) => /unknown error|functions\/|failed-precondition|INTERNAL/i.test(t));
  record('SEND_ERROR_IS_CLEAR', tSend.some((t) => t.includes('requiere atención del administrador')) && !technical, tSend.join(' | ') || '(sin aviso)');
  record('NO_UNEXPECTED_LOGOUT_AFTER_SEND', (await path()) === '/conversaciones');

  // ── Nota de voz (micrófono falso de Chromium) ───────────────────────
  await clearDiag();
  const mic = await page.$('button[title="Tocá para grabar"]');
  await tap(mic, 'micrófono');
  const recording = await waitStep('RECORDER_START', 8000);
  await sleep(2500);
  const stopBtn = await page.$('button[title="Enviar nota de voz"]');
  if (stopBtn) await tap(stopBtn, 'enviar nota');
  const blob = await waitStep('VOICE_BLOB_CREATED', 15000);
  const upl = await waitStep('VOICE_ATTACHMENT_READY', 20000);
  const vs = await diag();
  record('VOICE_RECORD_OK', vs.includes('VOICE_TAP') && vs.includes('MIC_PERMISSION_OK') && recording && vs.includes('RECORDER_STOP') && blob,
    ['VOICE_TAP', 'MIC_PERMISSION_OK', 'RECORDER_START', 'RECORDER_STOP', 'VOICE_BLOB_CREATED', 'VOICE_ATTACHMENT_READY'].map((s) => `${s}:${vs.includes(s) ? 'ok' : 'x'}`).join(' '));
  record('VOICE_UPLOAD_OK', upl, vs.filter((s) => s.startsWith('VOICE_')).join(','));
  await sleep(2500);
  record('NO_UNEXPECTED_LOGOUT_AFTER_VOICE', (await path()) === '/conversaciones');

  // ── D. COMERCIAL ─────────────────────────────────────────────────────
  console.log('\n== D. Comercial ==');
  const tools = await $text('Plantillas, catálogo y más');
  await tap(tools, 'panel de herramientas');
  await sleep(400);
  const order = await page.evaluate(() => {
    const row = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Cobrar / Enviar pago'))?.parentElement;
    if (!row) return null;
    const btns = [...row.querySelectorAll(':scope > button, :scope > div > button')];
    const visual = btns.map((b) => ({ t: b.innerText.trim().split('\n')[0], y: b.getBoundingClientRect().top, x: b.getBoundingClientRect().left, h: b.getBoundingClientRect().height, bg: getComputedStyle(b).backgroundColor }));
    return visual.sort((a, b) => a.y - b.y || a.x - b.x);
  });
  const cobro = order?.find((b) => b.t.includes('Cobrar'));
  record('PAYMENT_CTA_PRIORITY_OK', !!cobro && order[0].t.includes('Cobrar') && cobro.h >= 44, order ? order.map((b) => `${b.t}(${Math.round(b.h)}px)`).join(' → ') : 'sin fila');

  const catBtn = await $text('Catálogo', 'button', true);
  await tap(catBtn, 'Catálogo');
  const catOpen = await waitText('Insertá productos en el chat', 5000);
  const hasItems = (await bodyText()).includes('Sofá 3 plazas');
  const insertar = await $text('Insertar', 'button', true);
  if (insertar) await tap(insertar, 'Insertar');
  await sleep(600);
  const composer = await page.$eval('textarea', (t) => t.value).catch(() => '');
  const inserted = composer.includes('*Precio:*');
  record('CATALOG_FROM_CHAT_OK', catOpen && hasItems && inserted, `drawer=${catOpen} items=${hasItems} producto en el editor=${inserted} "${composer.split('\n')[0]}"`);

  const tools2 = await $text('Plantillas, catálogo y más');
  if (!(await $text('Cotizar', 'button', true))) { await tap(tools2, 'panel'); await sleep(300); }
  await page.$eval('textarea', (t) => { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })); });
  const cot = await $text('Cotizar', 'button', true);
  await tap(cot, 'Cotizar');
  await sleep(500);
  const afterQuote = await page.$eval('textarea', (t) => t.value).catch(() => '');
  record('QUOTE_FROM_CHAT_OK', (await path()) === '/conversaciones' && afterQuote.includes('cotización'), `sigue en el chat · editor="${afterQuote.slice(0, 50)}"`);

  const pay = await $text('Cobrar / Enviar pago');
  await tap(pay, 'Cobrar');
  const modal = await waitText('SINPE', 5000);
  const amount = await page.$('input[type="number"]');
  if (amount) { await amount.tap(); await amount.type('450'); }
  const concept = await page.$('input[placeholder^="Ej: Anticipo"]');
  if (concept) { await concept.tap(); await concept.type('Sofá 3 plazas'); }
  await clearDiag();
  const sendPay = await page.evaluateHandle(() => document.querySelector('.fixed.inset-0 button[type=submit]'));
  if (sendPay.asElement()) await tap(sendPay.asElement(), 'enviar cobro');
  await sleep(4000);
  const tPay = await collectToasts();
  const payDocs = await fetch(`http://127.0.0.1:8085/v1/projects/smartflow-e2e/databases/(default)/documents/payment_requests`, { headers: { Authorization: 'Bearer owner' } }).then((r) => r.json()).catch(() => ({}));
  const payCount = (payDocs.documents || []).length;
  const payTechnical = tPay.some((t) => /functions\/|Error al enviar instrucciones|failed-precondition/i.test(t));
  record('PAYMENT_FROM_CHAT_OK', modal && payCount > 0 && !payTechnical, `modal=${modal} cobrosRegistrados=${payCount} aviso="${tPay.join(' | ')}"`);
  const closeModal = await page.evaluateHandle(() => document.querySelector('.fixed.inset-0 button.absolute'));
  if (closeModal.asElement()) await tap(closeModal.asElement(), 'cerrar cobro');
  await sleep(500);

  // ── E. PERMISOS ──────────────────────────────────────────────────────
  console.log('\n== E. Permisos ==');
  const menuBtn = await page.$('header button.md\\:hidden');
  if (menuBtn) { await tap(menuBtn, 'menú'); await sleep(500); }
  const nav = await page.evaluate(() => [...document.querySelectorAll('aside a, aside button')].map((a) => a.innerText.trim()).filter(Boolean));
  const esperado = ['Dashboard', 'Mis Tareas', 'CRM', 'WhatsApp', 'Agenda'];
  const prohibido = ['Usuarios', 'Suscripción', 'Multi-Agente', 'Agente IA', 'Auditor', 'Integraciones', 'Configuración', 'Paquetes', 'Tienda', 'Cobros', 'Cotizaciones', 'Catálogo'];
  const faltan = esperado.filter((e) => !nav.some((n) => n.includes(e)));
  const sobran = prohibido.filter((p) => nav.some((n) => n.includes(p)));
  record('ADVISOR_MENU_OK', !faltan.length && !sobran.length, `faltan=[${faltan}] sobran=[${sobran}]`);
  const closeMenu = await page.$('aside button.md\\:hidden');
  if (closeMenu) { await tap(closeMenu, 'cerrar menú'); await sleep(400); }
  const rutas = ['/usuarios', '/configuracion', '/integraciones', '/multi-agent', '/ai-agent', '/auditoria', '/suscripcion', '/paquetes', '/tienda', '/pagos', '/cotizaciones', '/catalogo'];
  const abiertas = [];
  for (const r of rutas) {
    await page.evaluate((r) => { history.pushState({}, '', r); dispatchEvent(new PopStateEvent('popstate')); }, r);
    await sleep(700);
    const t = await bodyText();
    if (!/Acceso restringido|no tenés acceso|No tenés permiso/i.test(t) && (await path()) === r) abiertas.push(r);
  }
  record('ADMIN_ROUTES_DENIED', abiertas.length === 0, abiertas.length ? `abiertas: ${abiertas}` : `${rutas.length} rutas bloqueadas`);
  await page.evaluate(() => { history.pushState({}, '', '/conversaciones'); dispatchEvent(new PopStateEvent('popstate')); });
  await waitText('Cliente Prueba Uno');

  // ── F. ESTABILIDAD ───────────────────────────────────────────────────
  console.log('\n== F. Estabilidad ==');
  // La tarjeta de prueba vuelve abierta al remontar la página; en la lista de
  // conversaciones quedaría sobre los contactos, así que se pliega.
  if (await page.$('[data-qa-probe]')) await toggleProbe();
  const soakEnd = Date.now() + SOAK_MIN * 60000;
  let vueltas = 0, soakFail = '';
  do {
    for (const name of ['Cliente Prueba Dos', 'Cliente Prueba Uno']) {
      if ((await path()) !== '/conversaciones') { soakFail = `salió a ${await path()}`; break; }
      const back = await page.$('button[aria-label="Volver a las conversaciones"]');
      if (back && await back.boundingBox()) { await tap(back, 'volver'); await sleep(300); }
      const c = await page.waitForSelector(`::-p-text(${name})`, { timeout: 8000 }).catch(() => null);
      if (!c) { soakFail = `no aparece ${name}`; break; }
      await tap(c, name);
      await page.waitForSelector('textarea', { timeout: 8000 }).catch(() => {});
      const cl = await page.$('[data-media-input="gallery"]');
      await clearDiag();
      const [ch] = await Promise.all([page.waitForFileChooser({ timeout: 6000 }).catch(() => null), tap(cl, 'clip')]);
      if (!ch) { soakFail = `clip no abrió en la vuelta ${vueltas}`; break; }
      await ch.accept([files.png]);
      if (!(await waitStep('CLIP_ATTACHMENT_READY', 20000))) { soakFail = `adjunto no quedó listo en la vuelta ${vueltas}`; break; }
      const quitar = await page.$('button[title="Quitar"]');
      if (quitar) await tap(quitar, 'quitar');
    }
    vueltas++;
    if (soakFail) break;
    if (SOAK_MIN) await sleep(20000);
  } while (Date.now() < soakEnd);
  const authOk = await page.evaluate(() => window.__sfQaAuth?.currentUser() ?? false);
  record('SESSION_STABLE_OK', !soakFail && authOk, `${vueltas} vueltas${SOAK_MIN ? ` en ${SOAK_MIN} min` : ''}${soakFail ? ` · ${soakFail}` : ''} · sesión=${authOk}`);
  await collectToasts();
  record('NO_DUPLICATE_ERRORS', burstDuplicates === 0, `ráfagas con aviso repetido: ${burstDuplicates}`);
  record('NO_DEAD_CONTROLS', !notes.some((n) => n.includes('TAPADO')), notes.join(' | '));

  // ── A2. Cerrar sesión → vuelve el acceso rápido, sin código ─────────
  console.log('\n== A2. Cerrar sesión / cambiar usuario / revocar ==');
  const logout = await page.$('button[title="Cerrar Sesión"]');
  await tap(logout, 'cerrar sesión');
  const back = await waitPath('/acceso', 10000) || await waitPath('/login', 2000);
  const hold2 = await page.$('button[aria-label="Mantené presionado para entrar"]');
  const keptSecret = await page.evaluate(() => !!localStorage.getItem('smartflow_device_secret'));
  record('LOGOUT_KEEPS_QUICK_ENTRY', back && !!hold2 && keptSecret, `ruta=${await path()} botónRápido=${!!hold2} credencial=${keptSecret}`);
  if (hold2) {
    const b2 = await tapTarget(hold2);
    await page.touchscreen.touchStart(b2.x, b2.y); await sleep(700); await page.touchscreen.touchEnd();
    record('REENTRY_AFTER_LOGOUT_OK', await waitPath('/conversaciones', 20000));
  }

  // Revocar el equipo (lo hace el Owner): la reentrada rápida deja de servir con un mensaje claro.
  const ownerTok = await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@qa.test', password: 'Secret123!', returnSecureToken: true }),
  }).then((r) => r.json()).then((j) => j.idToken);
  const rv = await fetch(`${FN_BASE}/revokeDevice`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerTok}` }, body: JSON.stringify({ data: { deviceId: DEVICE.deviceId, tenantId: SEED.tenantId } }) }).then((r) => r.json());
  const logout2 = await page.$('button[title="Cerrar Sesión"]');
  if (logout2) await tap(logout2, 'cerrar sesión');
  await waitPath('/acceso', 10000);
  const hold3 = await page.$('button[aria-label="Mantené presionado para entrar"]');
  if (hold3) {
    const b3 = await tapTarget(hold3);
    await page.touchscreen.touchStart(b3.x, b3.y); await sleep(700); await page.touchscreen.touchEnd();
    await sleep(4000);
  }
  await waitText('Usá tu código', 8000);
  await page.screenshot({ path: join(OUT_DIR, 'revocado.png') }).catch(() => {});
  const t3 = await bodyText();
  notes.push(`pantalla tras revocar: ${t3.replace(/\s+/g, ' ').slice(0, 160)}`);
  record('REVOKED_DEVICE_NEEDS_CODE', !rv.error && (await path()) !== '/conversaciones' && /código/i.test(t3), rv.error ? JSON.stringify(rv.error) : `ruta=${await path()}`);

  const cambiar = await $text('Cambiar de usuario');
  if (cambiar) {
    await tap(cambiar, 'cambiar de usuario');
    await sleep(1500);
    const left = await page.evaluate(() => ['smartflow_vendor_identity', 'smartflow_device_id', 'smartflow_device_secret'].filter((k) => localStorage.getItem(k)));
    record('SWITCH_USER_CLEARS_DEVICE', left.length === 0, `quedan=[${left}]`);
  } else record('SWITCH_USER_CLEARS_DEVICE', false, 'no aparece "Cambiar de usuario"');

  // ── G. OWNER intacto: menú administrativo, rutas admin y chat ─────────
  console.log('\n== G. Owner ==');
  const { default: admin } = await import('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: 'smartflow-e2e' });
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9098';
  const ownerUid = (await admin.auth().getUserByEmail('owner@qa.test')).uid;
  const ownerCustom = await admin.auth().createCustomToken(ownerUid);
  const ctx = await browser.createBrowserContext();
  const op = await ctx.newPage();
  await op.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36' });
  await op.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  // Gancho que solo existe en el modo qalocal (ver src/lib/firebase.ts).
  await op.waitForFunction(() => !!window.__sfQaAuth, { timeout: 10000 });
  await op.evaluate((t) => window.__sfQaAuth.signInWithCustomToken(t), ownerCustom);
  await op.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  // Los feature flags llegan con la suscripción a settings, un momento después.
  await op.waitForFunction(() => [...document.querySelectorAll('aside a')].some((a) => a.innerText.includes('WhatsApp')), { timeout: 10000 }).catch(() => {});
  const ownerLanding = await op.evaluate(() => location.pathname);
  const ownerNav = await op.evaluate(() => [...document.querySelectorAll('aside a, aside button')].map((a) => a.innerText.trim()).filter(Boolean));
  const ownerNeeds = ['Usuarios', 'Cobros', 'Cotizaciones', 'Catálogo', 'WhatsApp'];
  const ownerMissing = ownerNeeds.filter((n) => !ownerNav.some((x) => x.includes(n)));
  await op.evaluate(() => { history.pushState({}, '', '/usuarios'); dispatchEvent(new PopStateEvent('popstate')); });
  await sleep(1500);
  const usuariosOk = !/Acceso restringido/i.test(await op.evaluate(() => document.body.innerText));
  await op.evaluate(() => { history.pushState({}, '', '/conversaciones'); dispatchEvent(new PopStateEvent('popstate')); });
  await sleep(1500);
  const bannerEnChat = await op.evaluate(() => !!document.querySelector('.fixed.bottom-6.right-6'));
  record('OWNER_ADMIN_OK', ownerLanding === '/dashboard' && !ownerMissing.length && usuariosOk && !bannerEnChat,
    `aterriza=${ownerLanding} faltan=[${ownerMissing}] /usuarios=${usuariosOk} bannerEnChat=${bannerEnChat}`);
  await ctx.close();
} catch (e) {
  console.error('\nERROR DEL SCRIPT', e);
  notes.push(`error del script: ${e.message}`);
} finally {
  await page.screenshot({ path: join(OUT_DIR, 'final.png') }).catch(() => {});
  const summary = { results, notes, toasts: [...toasts], consoleErrors: consoleErrors.filter((e) => !/emulator|DevTools|favicon/i.test(e)).slice(0, 15) };
  writeFileSync(join(OUT_DIR, 'qa_results.json'), JSON.stringify(summary, null, 2));
  console.log('\n' + JSON.stringify(summary, null, 2));
  await browser.close();
}
