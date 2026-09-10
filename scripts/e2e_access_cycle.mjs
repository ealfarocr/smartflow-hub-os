// ═══════════════════════════════════════════════════════════════════════
// E2E del CICLO DE ACCESO completo, contra los emuladores reales de
// Firebase (Functions + Firestore + Auth). No es un mock: corre las
// Cloud Functions de verdad (setVendorPin, loginWithPin, acceptTenantInvite,
// getVendorAccessInfo, getTenantAccessOverview, setMembershipActive) con
// tokens de Auth de verdad, y verifica los documentos que quedan escritos.
//
// Cubre el bug reportado en producción (una membership 'active' sin
// credencial resoluble no podía generar PIN) y su causa raíz: el ID de la
// membership cambia cuando acceptTenantInvite la re-indexa, y
// vendor_credentials/login_handles quedaban apuntando al ID viejo.
//
// Uso:
//   npx firebase-tools emulators:exec --only functions,firestore,auth \
//     --project smartflow-e2e "node scripts/e2e_access_cycle.mjs"
// ═══════════════════════════════════════════════════════════════════════
import admin from 'firebase-admin';

const PROJECT = process.env.GCLOUD_PROJECT || 'smartflow-e2e';
const FN_PORT = process.env.FUNCTIONS_EMULATOR_PORT || "5001";
const FN_BASE = `http://127.0.0.1:${FN_PORT}/${PROJECT}/us-central1`;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

let pass = 0;
const failures = [];
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  OK   ${label}`); }
  else { failures.push(label); console.log(`  FALLA ${label} ${extra}`); }
}

// El rate limiter de loginWithPin cuenta 20 intentos por minuto POR IP de
// origen, y este script hace muchos mas logins seguidos que una persona real.
// Cuando se satura NO es un fallo del producto (es la proteccion funcionando),
// asi que se espera a que se libere la ventana y se reintenta una vez. La
// prueba que verifica el rate limit a proposito (seccion 15) usa callFn en
// crudo, sin este reintento.
let rateLimitTestMode = false;
async function loginPin(data) {
  const first = await callFn('loginWithPin', data);
  if (!rateLimitTestMode && first.error?.status === 'RESOURCE_EXHAUSTED') {
    console.log('     (ventana de rate limit saturada por el propio script; esperando 62s)');
    await new Promise((r) => setTimeout(r, 62000));
    return callFn('loginWithPin', data);
  }
  return first;
}

async function callFn(name, data, idToken) {
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  const json = await res.json().catch(() => ({}));
  if (json.error) return { error: json.error };
  return { result: json.result };
}

async function idTokenForPassword(email, password) {
  const res = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) },
  );
  const j = await res.json();
  if (!j.idToken) throw new Error(`signInWithPassword fallo: ${JSON.stringify(j)}`);
  return j.idToken;
}

async function idTokenForCustomToken(customToken) {
  const res = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) },
  );
  const j = await res.json();
  if (!j.idToken) throw new Error(`signInWithCustomToken fallo: ${JSON.stringify(j)}`);
  return j.idToken;
}

/** Crea una persona con cuenta de Auth real + users/{uid} + membership. */
async function seedPerson({ tenantId, name, role, status, email, password }) {
  const user = await admin.auth().createUser({ email, password, displayName: name });
  await db.collection('users').doc(user.uid).set({ id: user.uid, name, email, isActive: true });
  const id = `${user.uid}_${tenantId}`;
  await db.collection('memberships').doc(id).set({ tenantId, userId: user.uid, name, email, role, status });
  return { uid: user.uid, membershipId: id, email, password, name };
}

const TA = 't-e2e-usaditos';
const TB = 't-e2e-otro-negocio';

(async () => {
  console.log(`\n=== SEED (proyecto ${PROJECT}) ===`);
  await db.collection('tenants').doc(TA).set({ name: 'USADITOS E2E', createdBy: 'seed' });
  await db.collection('tenants').doc(TB).set({ name: 'Otro Negocio', createdBy: 'seed' });

  const owner = await seedPerson({ tenantId: TA, name: 'EDUARDO ADMIN', role: 'Owner', status: 'active', email: 'owner@e2e.test', password: 'Secret123!' });
  const asesor = await seedPerson({ tenantId: TA, name: 'Asesor Comun', role: 'Asesor Comercial', status: 'active', email: 'asesor@e2e.test', password: 'Secret123!' });
  const ownerB = await seedPerson({ tenantId: TB, name: 'Owner Ajeno', role: 'Owner', status: 'active', email: 'ownerb@e2e.test', password: 'Secret123!' });

  // Vendedora nueva, cargada por el Admin: 'prepared', doc id aleatorio, sin userId.
  const preparedRef = await db.collection('memberships').add({
    tenantId: TA, userId: null, name: 'eduardo pruebas', role: 'Asesor Comercial', status: 'prepared', email: null,
  });
  const preparedId = preparedRef.id;
  console.log(`  membership prepared: ${preparedId}`);

  const ownerToken = await idTokenForPassword(owner.email, owner.password);
  const asesorToken = await idTokenForPassword(asesor.email, asesor.password);
  const ownerBToken = await idTokenForPassword(ownerB.email, ownerB.password);

  // --- 1. prepared -> generar acceso ---------------------------------
  console.log('\n=== 1. prepared -> Generar acceso ===');
  const gen1 = await callFn('setVendorPin', { membershipId: preparedId }, ownerToken);
  check('Owner genera el PIN inicial de un prepared', !!gen1.result?.pin, JSON.stringify(gen1.error || {}));
  check('modo bootstrap (crea la cuenta tecnica)', gen1.result?.mode === 'bootstrap', `mode=${gen1.result?.mode}`);
  const pin1 = gen1.result?.pin;
  const handle = gen1.result?.loginHandle;
  check('loginHandle derivado del nombre', handle === 'eduardopruebas', `handle=${handle}`);

  // --- 2. primer acceso (la membership esta en 'pending') ------------
  console.log('\n=== 2. Primer acceso con PIN (membership en pending) ===');
  const login1 = await loginPin({ tenantId: TA, loginHandle: handle, pin: pin1 });
  check('PRIMER login con PIN permitido (antes se denegaba y nadie nuevo podia entrar)', !!login1.result?.customToken, JSON.stringify(login1.error || {}));

  const vendorIdToken = await idTokenForCustomToken(login1.result.customToken);
  const accept = await callFn('acceptTenantInvite', {}, vendorIdToken);
  check('acceptTenantInvite vincula y activa la membership', accept.result?.linkedCount === 1, JSON.stringify(accept.result || accept.error));

  // --- 3. re-indexado: la credencial viaja con la membership ---------
  console.log('\n=== 3. Re-indexado de la membership (la causa raiz) ===');
  const vendorUid = (await admin.auth().getUserByEmail(`vendedor.${preparedId}@${TA}.usuarios.smartflow.internal`.toLowerCase())).uid;
  const newId = `${vendorUid}_${TA}`;
  const newMem = await db.collection('memberships').doc(newId).get();
  check('membership re-indexada a {uid}_{tenantId} y activa', newMem.exists && newMem.data().status === 'active', `status=${newMem.data()?.status}`);
  check('el doc de membership viejo fue borrado', !(await db.collection('memberships').doc(preparedId).get()).exists);
  check('vendor_credentials viajo al ID nuevo', (await db.collection('vendor_credentials').doc(newId).get()).exists);
  check('vendor_credentials viejo fue borrado', !(await db.collection('vendor_credentials').doc(preparedId).get()).exists);
  const handleDoc = await db.collection('login_handles').doc(`${TA}_${handle}`).get();
  check('login_handles apunta al ID nuevo', handleDoc.data()?.membershipId === newId, `apunta a ${handleDoc.data()?.membershipId}`);

  // --- 4. la UI ve el estado real ------------------------------------
  console.log('\n=== 4. La UI ve el estado real (sin "PIN no configurado" falso) ===');
  const info = await callFn('getVendorAccessInfo', { membershipId: newId }, ownerToken);
  check('getVendorAccessInfo reporta acceso configurado', info.result?.hasPinAccess === true, JSON.stringify(info.result || info.error));
  check('estado = active-with-access', info.result?.state === 'active-with-access', `state=${info.result?.state}`);
  check('accion principal = copiar acceso', info.result?.primaryAction === 'copy', `primaryAction=${info.result?.primaryAction}`);

  const overview = await callFn('getTenantAccessOverview', { tenantId: TA }, ownerToken);
  check('getTenantAccessOverview devuelve el estado de toda la lista en UNA llamada', !!overview.result?.access?.[newId], JSON.stringify(overview.error || {}));
  check('overview: el Owner mismo aparece sin acceso por PIN y con accion "generate"', overview.result?.access?.[owner.membershipId]?.primaryAction === 'generate', JSON.stringify(overview.result?.access?.[owner.membershipId] || {}));

  // --- 5. re-login (la regresion que dejaba a todos afuera) ----------
  console.log('\n=== 5. Volver a entrar con el MISMO PIN ===');
  const login2 = await loginPin({ tenantId: TA, loginHandle: handle, pin: pin1 });
  check('re-login permitido despues del re-indexado', !!login2.result?.customToken, JSON.stringify(login2.error || {}));

  // --- 6. regenerar: invalida el anterior ---------------------------
  console.log('\n=== 6. Regenerar acceso ===');
  const gen2 = await callFn('setVendorPin', { membershipId: newId }, ownerToken);
  check('regenerar sobre una membership active ALLOW', !!gen2.result?.pin, JSON.stringify(gen2.error || {}));
  check('modo regenerate', gen2.result?.mode === 'regenerate', `mode=${gen2.result?.mode}`);
  const pin2 = gen2.result?.pin;
  check('el PIN nuevo es distinto del anterior', pin2 !== pin1);
  check('el loginHandle se conserva (no se inventa uno nuevo)', gen2.result?.loginHandle === handle, `handle=${gen2.result?.loginHandle}`);

  const oldPinTry = await loginPin({ tenantId: TA, loginHandle: handle, pin: pin1 });
  check('PIN VIEJO denegado', !!oldPinTry.error && !oldPinTry.result, JSON.stringify(oldPinTry.result || {}));
  const newPinTry = await loginPin({ tenantId: TA, loginHandle: handle, pin: pin2 });
  check('PIN NUEVO permitido', !!newPinTry.result?.customToken, JSON.stringify(newPinTry.error || {}));

  // --- 7. suspender --------------------------------------------------
  console.log('\n=== 7. Desactivar usuario ===');
  const deact = await callFn('setMembershipActive', { membershipId: newId, isActive: false }, ownerToken);
  check('desactivacion aplicada', deact.result?.status === 'suspended', JSON.stringify(deact.error || {}));
  const susLogin = await loginPin({ tenantId: TA, loginHandle: handle, pin: pin2 });
  check('login de un usuario desactivado DENEGADO', !!susLogin.error && !susLogin.result, JSON.stringify(susLogin.result || {}));
  const susGen = await callFn('setVendorPin', { membershipId: newId }, ownerToken);
  check('generar PIN sobre un suspendido: rechazo explicito y accionable', !!susGen.error && /[Rr]eactiva/.test(susGen.error.message || ''), JSON.stringify(susGen.error || susGen.result));
  const susMem = await db.collection('memberships').doc(newId).get();
  check('el historial del usuario se conserva (nombre y rol intactos)', susMem.data()?.name === 'eduardo pruebas' && susMem.data()?.role === 'Asesor Comercial');

  // --- 8. reactivar y generar acceso nuevo ---------------------------
  console.log('\n=== 8. Reactivar y generar acceso nuevo ===');
  const react = await callFn('setMembershipActive', { membershipId: newId, isActive: true }, ownerToken);
  check('reactivacion aplicada', react.result?.status === 'active', JSON.stringify(react.error || {}));
  const gen3 = await callFn('setVendorPin', { membershipId: newId }, ownerToken);
  check('tras reactivar, generar acceso nuevo ALLOW', !!gen3.result?.pin, JSON.stringify(gen3.error || {}));
  const pin3 = gen3.result?.pin;
  const login3 = await loginPin({ tenantId: TA, loginHandle: handle, pin: pin3 });
  check('login con el acceso nuevo permitido', !!login3.result?.customToken, JSON.stringify(login3.error || {}));
  const pin2AfterReact = await loginPin({ tenantId: TA, loginHandle: handle, pin: pin2 });
  check('el PIN anterior sigue invalido despues de reactivar', !!pin2AfterReact.error && !pin2AfterReact.result);

  // --- 9. autorizacion ----------------------------------------------
  console.log('\n=== 9. Autorizacion ===');
  const asesorTry = await callFn('setVendorPin', { membershipId: newId }, asesorToken);
  check('un Asesor Comercial NO puede generar accesos', !!asesorTry.error && !asesorTry.result, JSON.stringify(asesorTry.result || {}));
  const crossTry = await callFn('setVendorPin', { membershipId: newId }, ownerBToken);
  check('un Owner de OTRO tenant NO puede generar accesos aca', !!crossTry.error && !crossTry.result, JSON.stringify(crossTry.result || {}));
  const crossInfo = await callFn('getVendorAccessInfo', { membershipId: newId }, ownerBToken);
  check('un Owner de OTRO tenant NO puede leer el acceso de aca', !!crossInfo.error && !crossInfo.result, JSON.stringify(crossInfo.result || {}));
  const crossOverview = await callFn('getTenantAccessOverview', { tenantId: TA }, ownerBToken);
  check('un Owner de OTRO tenant NO puede leer el overview de aca', !!crossOverview.error && !crossOverview.result, JSON.stringify(crossOverview.result || {}));
  const anonTry = await callFn('setVendorPin', { membershipId: newId });
  check('sin sesion NO se puede generar accesos', !!anonTry.error && !anonTry.result);

  // --- 10. el estado exacto ya roto en produccion se cura solo -------
  console.log('\n=== 10. Datos ya desfasados en produccion: se resuelven sin migracion ===');
  // Reproduce la foto real: la credencial quedo bajo un ID de membership que
  // ya no existe, y login_handles apuntando a ese mismo ID viejo.
  const staleId = 'StaleMembershipId123';
  const credNow = await db.collection('vendor_credentials').doc(newId).get();
  await db.collection('vendor_credentials').doc(staleId).set({ ...credNow.data(), membershipId: staleId });
  await db.collection('vendor_credentials').doc(newId).delete();
  await db.collection('login_handles').doc(`${TA}_${handle}`).set({ tenantId: TA, membershipId: staleId }, { merge: true });

  const staleInfo = await callFn('getVendorAccessInfo', { membershipId: newId }, ownerToken);
  check('credencial huerfana: getVendorAccessInfo la resuelve por authUid', staleInfo.result?.hasPinAccess === true, JSON.stringify(staleInfo.result || staleInfo.error));
  const staleLogin = await loginPin({ tenantId: TA, loginHandle: handle, pin: pin3 });
  check('credencial huerfana: el login sigue funcionando', !!staleLogin.result?.customToken, JSON.stringify(staleLogin.error || {}));
  const staleGen = await callFn('setVendorPin', { membershipId: newId }, ownerToken);
  check('credencial huerfana: regenerar ALLOW (ya no es un estado muerto)', staleGen.result?.mode === 'regenerate', JSON.stringify(staleGen.error || staleGen.result));
  const repointed = await db.collection('login_handles').doc(`${TA}_${handle}`).get();
  check('el indice login_handles queda repuntado al ID actual', repointed.data()?.membershipId === newId, `apunta a ${repointed.data()?.membershipId}`);

  // --- 11. dispositivos: liberar y reusar el telefono corporativo -----
  console.log('\n=== 11. Dispositivos: liberar y reusar el telefono corporativo ===');
  const vendorToken3 = await idTokenForCustomToken(login3.result.customToken);
  const regDev = await callFn('registerDevice', { deviceId: 'telefono-corporativo-1', tenantId: TA, label: 'Moto G Bodeguita' }, vendorToken3);
  check('el vendedor registra el telefono corporativo', regDev.result?.status === 'active', JSON.stringify(regDev.error || {}));
  const revDev = await callFn('revokeDevice', { deviceId: 'telefono-corporativo-1' }, ownerToken);
  check('el Owner libera (revoca) el dispositivo', !!revDev.result?.deviceId, JSON.stringify(revDev.error || {}));
  const devDoc = await db.collection('trusted_devices').doc('telefono-corporativo-1').get();
  check('queda auditado quien y cuando lo revoco', devDoc.data()?.status === 'revoked' && !!devDoc.data()?.revokedBy);
  const reviveTry = await callFn('registerDevice', { deviceId: 'telefono-corporativo-1', tenantId: TA, label: 'Moto G' }, vendorToken3);
  check('un dispositivo revocado NO se puede revivir desde el cliente', !!reviveTry.error && !reviveTry.result, JSON.stringify(reviveTry.result || {}));
  // Mismo telefono fisico, otra persona: el cliente olvida su identidad y
  // genera un deviceId nuevo (forgetDeviceAndIdentity en el frontend).
  const samePhoneNewUser = await callFn('registerDevice', { deviceId: 'telefono-corporativo-1-reasignado', tenantId: TA, label: 'Moto G Bodeguita' }, asesorToken);
  check('el MISMO telefono queda usable por otra persona con identidad nueva', samePhoneNewUser.result?.status === 'active', JSON.stringify(samePhoneNewUser.error || {}));

  // --- 12. EL HUECO QUE DEJO PASAR LA REGRESION ----------------------
  // La seccion 10 verificaba que regenerar sobre una credencial desubicada
  // fuera ALLOW y que el indice quedara repuntado... pero NUNCA intentaba
  // entrar con el PIN nuevo. Justo ahi estaba el bug: el indice apuntaba a la
  // membership actual y la credencial seguia en el doc viejo, asi que el login
  // no la encontraba y respondia "Usuario o PIN incorrecto" con un PIN recien
  // generado. Este bloque entra DESPUES de regenerar, que es lo que de verdad
  // le importa al vendedor.
  console.log('\n=== 12. Login con el PIN RECIEN generado sobre una credencial desubicada ===');
  const pinStale = staleGen.result?.pin;
  const loginAfterStaleRegen = await loginPin({ tenantId: TA, loginHandle: handle, pin: pinStale });
  check('el PIN recien generado ENTRA (regresion del PIN nuevo que no servia)', !!loginAfterStaleRegen.result?.customToken, JSON.stringify(loginAfterStaleRegen.error || {}));
  const pin3AfterStale = await loginPin({ tenantId: TA, loginHandle: handle, pin: pin3 });
  check('el PIN anterior quedo invalidado', !!pin3AfterStale.error && !pin3AfterStale.result);

  // La credencial tiene que haber quedado en su lugar canonico y el indice
  // apuntando ahi mismo: una sola fuente de verdad, no dos mitades que se
  // contradicen.
  const canonCred = await db.collection('vendor_credentials').doc(newId).get();
  check('la credencial quedo en su lugar canonico (vendor_credentials/{membershipId})', canonCred.exists);
  check('la credencial vieja se borro (no quedan dos)', !(await db.collection('vendor_credentials').doc('StaleMembershipId123').get()).exists);
  const idxDoc = await db.collection('login_handles').doc(`${TA}_${handle}`).get();
  check('el indice guarda credDocId apuntando a la credencial real', idxDoc.data()?.credDocId === newId, `credDocId=${idxDoc.data()?.credDocId}`);
  check('el indice guarda authUid (el unico id que no cambia)', idxDoc.data()?.authUid === vendorUid, `authUid=${idxDoc.data()?.authUid}`);

  // Entrar dos veces mas seguidas = recargar la pagina / volver a entrar tras
  // cerrar sesion. No debe degradarse.
  const reload1 = await loginPin({ tenantId: TA, loginHandle: handle, pin: pinStale });
  const reload2 = await loginPin({ tenantId: TA, loginHandle: handle, pin: pinStale });
  check('login repetido (recargar pagina / volver a entrar) sigue funcionando', !!reload1.result?.customToken && !!reload2.result?.customToken);

  // Y si el indice vuelve a quedar roto por cualquier motivo, el login se
  // recupera por loginHandle/authUid en vez de decir "PIN incorrecto".
  console.log('\n=== 13. Indice roto a proposito: el login se recupera solo ===');
  await db.collection('login_handles').doc(`${TA}_${handle}`).set({ tenantId: TA, membershipId: 'IdQueNoExiste999', credDocId: 'TampocoExiste999' }, { merge: true });
  const recovered = await loginPin({ tenantId: TA, loginHandle: handle, pin: pinStale });
  check('con el indice apuntando a la nada, el login igual entra (red de seguridad)', !!recovered.result?.customToken, JSON.stringify(recovered.error || {}));
  const wrongTenant = await loginPin({ tenantId: TB, loginHandle: handle, pin: pinStale });
  check('esa red de seguridad NO cruza tenants', !!wrongTenant.error && !wrongTenant.result, JSON.stringify(wrongTenant.result || {}));

  // --- 14. REENTRADA DESDE /login (sin el enlace de WhatsApp) --------
  // El vendedor cierra sesion y cae en /login. Antes esa pantalla solo ofrecia
  // Google y email/password, y /acceso sin el enlace decia "Este enlace no es
  // valido": quedaba afuera salvo que conservara el mensaje de WhatsApp. Ahora
  // escribe SOLO su usuario y su PIN — nunca un tenantId ni ningun dato
  // tecnico — y el backend resuelve el negocio internamente.
  console.log('\n=== 14. Reentrada desde /login: usuario + PIN, sin tenantId ===');
  const noTenant = await loginPin({ loginHandle: handle, pin: pinStale });
  check('entra con usuario + PIN, SIN mandar tenantId', !!noTenant.result?.customToken, JSON.stringify(noTenant.error || {}));
  check('la respuesta trae el tenant para poder registrar el dispositivo', noTenant.result?.tenantId === TA, `tenantId=${noTenant.result?.tenantId}`);
  check('la respuesta trae el nombre visible (de la membership, no del correo tecnico)', noTenant.result?.displayName === 'eduardo pruebas', `displayName=${noTenant.result?.displayName}`);
  check('la respuesta NO filtra authUid ni ids de credencial', !('authUid' in (noTenant.result || {})) && !('credDocId' in (noTenant.result || {})) && !('membershipId' in (noTenant.result || {})));
  check('la respuesta NO filtra el correo tecnico interno', !JSON.stringify(noTenant.result || {}).includes('usuarios.smartflow.internal'));

  const noTenantBadPin = await loginPin({ loginHandle: handle, pin: '000000' });
  check('PIN incorrecto sin tenantId -> DENY', !!noTenantBadPin.error && !noTenantBadPin.result);
  const unknownUser = await loginPin({ loginHandle: 'noexisteestapersona', pin: '123456' });
  check('usuario inexistente -> mismo error generico', unknownUser.error?.message === noTenantBadPin.error?.message, `"${unknownUser.error?.message}" vs "${noTenantBadPin.error?.message}"`);

  // Aislamiento: el usuario existe en TA; pedir entrar diciendo que es de TB
  // no debe funcionar aunque el PIN sea correcto.
  const wrongTenantExplicit = await loginPin({ tenantId: TB, loginHandle: handle, pin: pinStale });
  check('usuario de un tenant no entra declarando otro tenant', !!wrongTenantExplicit.error && !wrongTenantExplicit.result);

  // Suspendido: tampoco entra por esta puerta nueva.
  await callFn('setMembershipActive', { membershipId: newId, isActive: false }, ownerToken);
  const suspendedNoTenant = await loginPin({ loginHandle: handle, pin: pinStale });
  check('usuario desactivado -> DENY tambien entrando por usuario+PIN', !!suspendedNoTenant.error && !suspendedNoTenant.result);
  await callFn('setMembershipActive', { membershipId: newId, isActive: true }, ownerToken);
  const backAfterReactivate = await loginPin({ loginHandle: handle, pin: pinStale });
  check('reactivado -> vuelve a entrar por usuario+PIN', !!backAfterReactivate.result?.customToken, JSON.stringify(backAfterReactivate.error || {}));

  // Dispositivo reconocido = el cliente ya guardo tenantId+handle y los manda:
  // mismo endpoint, mismo resultado, sin volver a escribir el usuario.
  const knownDevice = await loginPin({ tenantId: TA, loginHandle: handle, pin: pinStale });
  check('dispositivo reconocido (tenant ya guardado) sigue entrando solo con PIN', !!knownDevice.result?.customToken, JSON.stringify(knownDevice.error || {}));

  // --- 15. RATE LIMITING --------------------------------------------
  // Va al final a proposito: el limitador cuenta tambien por IP de origen, asi
  // que saturarlo antes afectaria a las demas pruebas. Se usa un usuario que
  // NO existe para no tocar los contadores de una credencial real.
  console.log('\n=== 15. Rate limiting ===');
  rateLimitTestMode = true;
  let exhausted = false;
  for (let i = 0; i < 25 && !exhausted; i++) {
    const r = await callFn('loginWithPin', { loginHandle: 'usuarioinventadoparaellimite', pin: '111111' });
    if (r.error?.status === 'RESOURCE_EXHAUSTED') exhausted = true;
  }
  check('los intentos repetidos terminan bloqueados por rate limit', exhausted);

  console.log(`\n=== RESULTADO: ${pass} OK, ${failures.length} fallos ===`);
  if (failures.length) {
    failures.forEach((f) => console.log(`  FALLO: ${f}`));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => { console.error('\nERROR FATAL:', e); process.exit(1); });
