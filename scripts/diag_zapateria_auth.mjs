import admin from 'firebase-admin';

delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

admin.initializeApp({ projectId: 'paneles-solares-bcs-mx' });
const db = admin.firestore();
const authAdmin = admin.auth();

const EMAILS = ['Mizapateria652@gmail.com', 'mizapateria652@gmail.com'];
const OWNER_UID = '3FE76LWoCrhgOborC3ClWt3QSHu1';

(async () => {
  console.log('=== CUENTAS AUTH POR EMAIL ===');
  for (const e of EMAILS) {
    try {
      const u = await authAdmin.getUserByEmail(e);
      console.log(`\n[OK] getUserByEmail("${e}")`);
      console.log(`  uid=${u.uid} | email=${u.email} | providers=${u.providerData.map(p => p.providerId).join(',')}`);
    } catch (err) {
      console.log(`\n[X] getUserByEmail("${e}") -> ${err.code}`);
    }
  }

  console.log('\n=== ¿uid del membership existe en Auth? ===');
  try {
    const u = await authAdmin.getUser(OWNER_UID);
    console.log(`  uid=${u.uid} | email=${u.email} | providers=${u.providerData.map(p => p.providerId).join(',')}`);
  } catch (err) {
    console.log(`  [X] getUser(${OWNER_UID}) -> ${err.code}`);
  }

  console.log('\n=== TODAS las cuentas Auth que contengan "zapateria" ===');
  let nextToken;
  do {
    const page = await authAdmin.listUsers(1000, nextToken);
    page.users.forEach(u => {
      if ((u.email || '').toLowerCase().includes('zapateria')) {
        console.log(`  uid=${u.uid} | email=${u.email} | providers=${u.providerData.map(p => p.providerId).join(',')} | created=${u.metadata.creationTime}`);
      }
    });
    nextToken = page.pageToken;
  } while (nextToken);

  console.log('\n=== users docs (Firestore) con ese email ===');
  for (const e of EMAILS) {
    const s = await db.collection('users').where('email', '==', e).get();
    console.log(`  email="${e}": ${s.docs.length} doc(s) -> ${s.docs.map(d => d.id).join(', ')}`);
  }

  console.log('\n=== memberships con ownerEmail (ambos casos) ===');
  for (const e of EMAILS) {
    const s = await db.collection('memberships').where('email', '==', e).get();
    console.log(`  email="${e}": ${s.docs.length} membership(s)`);
    s.docs.forEach(d => console.log(`    ${d.id} | userId=${d.data().userId} | tenantId=${d.data().tenantId} | status=${d.data().status}`));
  }

  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
