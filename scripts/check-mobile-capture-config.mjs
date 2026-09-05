// Chequeo de regresión: la cámara/galería del chat móvil (ConversationsPageView) depende
// de que el header Permissions-Policy de Firebase Hosting NO desactive "camera" para el
// propio sitio. Si vuelve a quedar en camera=(), el navegador ignora silenciosamente el
// atributo capture="environment" de los <input type="file"> y Android cae a un chooser
// genérico de apps en vez de abrir la cámara directo — sin ningún error en consola.
// Uso: node scripts/check-mobile-capture-config.mjs
import { readFileSync } from 'node:fs';

const failures = [];

function check(label, ok) {
  if (ok) console.log(`OK: ${label}`);
  else { console.error(`FALLO: ${label}`); failures.push(label); }
}

const firebaseJson = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url)));
const appTarget = firebaseJson.hosting.find((h) => h.target === 'app');
const headerBlock = appTarget.headers.find((h) => h.source === '**');
const permissionsPolicy = headerBlock.headers.find((h) => h.key === 'Permissions-Policy')?.value || '';

check(
  'Permissions-Policy no desactiva "camera" para el propio sitio (no debe ser camera=())',
  /camera=\(\s*self\s*\)|camera=\*/i.test(permissionsPolicy)
);
check(
  'Permissions-Policy no desactiva "microphone" para el propio sitio (grabadora de audio)',
  /microphone=\(\s*self\s*\)|microphone=\*/i.test(permissionsPolicy)
);

const source = readFileSync(
  new URL('../src/modules/conversations/ConversationsPageView.tsx', import.meta.url),
  'utf8'
);

check(
  'Existe una opción de Galería (input sin capture, accept image/video) separada de la Cámara',
  /galleryInputRef[\s\S]{0,200}accept="image\/\*,video\/\*"/.test(source) &&
  !/galleryInputRef[\s\S]{0,300}capture=/.test(source.slice(source.indexOf('galleryInputRef'), source.indexOf('galleryInputRef') + 400))
);

check(
  'startRecording cancela si el usuario ya soltó el dedo mientras esperaba el permiso de micrófono',
  /if \(!recordStartRef\.current && !lockedRef\.current\)/.test(source)
);

// Los 4 <input type="file"> deben vivir como hijos directos del <form>, ANTES del bloque
// condicional del dropdown de cámara — si estuvieran dentro de `{showCameraChoice && (...)}`
// se desmontarían al cerrar el menú, perdiendo el archivo si Android tarda en devolver el
// control a la pestaña (cámara/galería abiertas de por medio).
const idxCameraInput = source.indexOf('ref={cameraInputRef}');
const idxGalleryInput = source.indexOf('ref={galleryInputRef}');
const idxVideoInput = source.indexOf('ref={cameraVideoInputRef}');
const idxDropdownBlock = source.indexOf('{showCameraChoice && (');
check(
  'Los inputs de Foto/Video/Galería están fuera (antes) del dropdown condicional, no se desmontan al cerrarlo',
  idxCameraInput > -1 && idxGalleryInput > -1 && idxVideoInput > -1 && idxDropdownBlock > -1 &&
  idxCameraInput < idxDropdownBlock && idxGalleryInput < idxDropdownBlock && idxVideoInput < idxDropdownBlock
);

// El reset de e.target.value debe ocurrir DESPUÉS de esperar handleFilesSelected, no antes —
// limpiarlo antes de terminar de leer el archivo puede invalidar el File en algunos
// navegadores móviles (Android/iOS) y el archivo nunca llega al composer del chat.
// (handleFileUpload de un solo archivo fue reemplazado por handleFilesSelected para
// soportar selección múltiple; el invariante que este check protege es el mismo.)
for (const [label, ref] of [['Foto', 'cameraInputRef'], ['Video', 'cameraVideoInputRef'], ['Galería', 'galleryInputRef'], ['Adjuntar', 'fileInputRef']]) {
  const inputBlockStart = source.indexOf(`ref={${ref}}`);
  const inputBlockEnd = source.indexOf('/>', inputBlockStart);
  const block = source.slice(inputBlockStart, inputBlockEnd);
  const awaitIdx = block.indexOf('await handleFilesSelected');
  const resetIdx = block.indexOf("e.target.value = ''");
  check(
    `Input "${label}": el reset de e.target.value ocurre después de "await handleFilesSelected"`,
    awaitIdx > -1 && resetIdx > -1 && awaitIdx < resetIdx
  );
}

// Instrumentación temporal pedida para depurar en dispositivo real vía remote debugging.
for (const tag of [
  'PHOTO_CLICK', 'PHOTO_INPUT_TRIGGERED', 'PHOTO_CHANGE',
  'VIDEO_CLICK', 'VIDEO_INPUT_TRIGGERED', 'VIDEO_CHANGE',
  'GALLERY_CLICK', 'GALLERY_INPUT_TRIGGERED', 'GALLERY_CHANGE',
]) {
  check(`Log de instrumentación presente: ${tag}`, source.includes(`'${tag}'`));
}
check(
  'addPendingMedia registra FILE_RECEIVED y ATTACHMENT_CREATED/UPLOAD_ERROR por origen (PHOTO/VIDEO/GALLERY/ATTACH)',
  /debugAttach\(`\$\{source\}_FILE_RECEIVED`/.test(source) &&
  /debugAttach\(`\$\{source\}_ATTACHMENT_CREATED`/.test(source)
);

// Logs de ciclo de vida de la página (detectan si Android/Chrome recicla el proceso de
// la SPA al volver de la cámara/galería) — ver src/utils/attachLifecycleDebug.ts.
check(
  'main.tsx importa la instrumentación de ciclo de vida (attachLifecycleDebug)',
  readFileSync(new URL('../src/app/main.tsx', import.meta.url), 'utf8').includes('attachLifecycleDebug')
);
const lifecycleSource = readFileSync(
  new URL('../src/utils/attachLifecycleDebug.ts', import.meta.url),
  'utf8'
);
for (const tag of ['APP_MOUNT', 'PAGE_HIDE', 'PAGE_SHOW', 'VISIBILITY_HIDDEN', 'VISIBILITY_VISIBLE']) {
  check(`Log de ciclo de vida presente: ${tag}`, lifecycleSource.includes(tag));
}
check(
  'El log de ciclo de vida incluye un identificador de sesión y de mount para distinguir recargas',
  /sessionId/.test(lifecycleSource) && /mountId/.test(lifecycleSource) && /mountCount/.test(lifecycleSource)
);

if (failures.length > 0) {
  console.error(`\n${failures.length} chequeo(s) fallaron.`);
  process.exit(1);
}
console.log('\nTodos los chequeos pasaron.');
