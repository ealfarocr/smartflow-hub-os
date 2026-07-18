import admin from 'firebase-admin';

delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

admin.initializeApp({ projectId: 'paneles-solares-bcs-mx' });
const db = admin.firestore();

(async () => {
  console.log('=== TODOS LOS TENANTS ===');
  const tenants = await db.collection('tenants').get();
  for (const d of tenants.docs) {
    const x = d.data();
    console.log(`docId="${d.id}" | name="${x.name}" | tradeName="${x.tradeName}" | status=${x.status}`);
  }

  console.log('\n=== BUSCANDO "Zapater" ===');
  const target = tenants.docs.find(d => (d.data().name || '').toLowerCase().includes('zapater'));
  if (!target) { console.log('NO encontrado por nombre.'); process.exit(0); }

  const id = target.id;
  console.log(`\nTenant docId = "${id}"`);
  console.log('Data:', JSON.stringify(target.data(), null, 2));

  // ¿Existe el doc al que apunta la URL de enter-tenant?
  const urlSlug = 'zapaterasdesanjos';
  const urlDoc = await db.collection('tenants').doc(urlSlug).get();
  console.log(`\ntenants/${urlSlug} existe? ${urlDoc.exists}`);

  // Settings
  const settings = await db.collection('settings').doc(id).get();
  console.log(`settings/${id} existe? ${settings.exists}`);

  // Memberships del tenant
  const mems = await db.collection('memberships').where('tenantId', '==', id).get();
  console.log(`\nMemberships (tenantId="${id}"): ${mems.docs.length}`);
  mems.docs.forEach(m => console.log(`  ${m.id} | email=${m.data().email} | role=${m.data().role} | status=${m.data().status}`));

  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
