import admin from 'firebase-admin';
delete process.env.FIRESTORE_EMULATOR_HOST;
admin.initializeApp({ projectId: 'paneles-solares-bcs-mx' });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('integrations').where('tenantId', '==', 'zapaterasdesanjos').get();
  console.log(`Integraciones de zapaterasdesanjos: ${snap.size}\n`);
  snap.docs.forEach(d => {
    const x = d.data();
    // ocultar secretos largos
    const mask = v => (typeof v === 'string' && v.length > 12) ? v.slice(0, 6) + '…(' + v.length + ')' : v;
    console.log(`--- ${d.id} ---`);
    console.log(`  provider: ${x.provider}`);
    console.log(`  isActive: ${x.isActive}`);
    console.log(`  phoneNumberId: ${x.phoneNumberId || '(vacío)'}`);
    console.log(`  displayPhoneNumber: ${x.displayPhoneNumber || '(no cacheado)'}`);
    console.log(`  verifiedName: ${x.verifiedName || '(n/a)'}`);
    console.log(`  whatsappBusinessAccountId: ${x.whatsappBusinessAccountId || '(vacío)'}`);
    console.log(`  accessToken: ${x.accessToken ? mask(x.accessToken) : '(vacío)'}`);
    console.log(`  appSecret: ${x.appSecret ? mask(x.appSecret) : '(vacío)'}`);
    console.log(`  isAiAutomated: ${x.isAiAutomated}`);
  });
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
