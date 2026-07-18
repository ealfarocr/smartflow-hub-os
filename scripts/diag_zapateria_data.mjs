import admin from 'firebase-admin';
delete process.env.FIRESTORE_EMULATOR_HOST;
admin.initializeApp({ projectId: 'paneles-solares-bcs-mx' });
const db = admin.firestore();

const IDS = ['zapaterasdesanjos', 'zapateriadesanjose'];

(async () => {
  for (const id of IDS) {
    console.log(`\n========== TENANT "${id}" ==========`);
    const t = await db.collection('tenants').doc(id).get();
    const s = await db.collection('settings').doc(id).get();
    console.log(`  tenants/${id}: ${t.exists ? 'EXISTE' : 'NO existe'}`);
    console.log(`  settings/${id}: ${s.exists ? 'EXISTE' : 'NO existe'}`);

    for (const col of ['leads', 'conversations', 'catalog', 'agenda_items', 'quotes', 'packages', 'integrations']) {
      const c = await db.collection(col).where('tenantId', '==', id).get();
      if (c.size > 0) console.log(`  ${col}: ${c.size}`);
    }
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
