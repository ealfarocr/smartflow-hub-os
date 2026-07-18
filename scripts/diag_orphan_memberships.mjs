import admin from 'firebase-admin';
delete process.env.FIRESTORE_EMULATOR_HOST;
admin.initializeApp({ projectId: 'paneles-solares-bcs-mx' });
const db = admin.firestore();

(async () => {
  const tenants = await db.collection('tenants').get();
  const tenantIds = new Set(tenants.docs.map(d => d.id));
  console.log(`Tenants existentes: ${tenantIds.size} -> ${[...tenantIds].join(', ')}`);

  const mems = await db.collection('memberships').get();
  console.log(`\nMembresías totales: ${mems.size}`);

  const orphans = [];
  const byUser = {};
  for (const d of mems.docs) {
    const x = d.data();
    if (x.tenantId && !tenantIds.has(x.tenantId)) {
      orphans.push({ id: d.id, ...x });
    }
    (byUser[x.userId] ||= []).push(x.tenantId);
  }

  console.log(`\n=== MEMBRESÍAS HUÉRFANAS (tenant inexistente): ${orphans.length} ===`);
  orphans.forEach(o => console.log(`  ${o.id} | email="${o.email}" | tenantId=${o.tenantId} | status=${o.status}`));

  console.log(`\n=== USUARIOS CON >1 MEMBRESÍA (posible duplicado por slug) ===`);
  Object.entries(byUser).filter(([, t]) => t.length > 1).forEach(([uid, t]) => {
    console.log(`  uid=${uid} -> [${t.join(', ')}]`);
  });

  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
