import admin from 'firebase-admin';
delete process.env.FIRESTORE_EMULATOR_HOST;
admin.initializeApp({ projectId: 'paneles-solares-bcs-mx' });
const db = admin.firestore();

const TENANT = 't-1779680745567'; // IGUANA PARK

(async () => {
  const s = await db.collection('settings').doc(TENANT).get();
  const stages = s.data()?.pipeline?.stages || [];
  console.log('=== ETAPAS DEL PIPELINE (Iguana Park) ===');
  stages.forEach((st) => console.log(`  id="${st.id}" | label="${st.label}" | order=${st.order} | isClosed=${st.isClosed}`));
  const labels = new Set(stages.map((st) => st.label));

  const leads = await db.collection('leads').where('tenantId', '==', TENANT).get();
  const byStage = {};
  leads.docs.forEach((d) => {
    const st = d.data().stage || '(sin stage)';
    byStage[st] = (byStage[st] || 0) + 1;
  });
  console.log(`\n=== LEADS POR STAGE (${leads.size} total) ===`);
  Object.entries(byStage).forEach(([st, n]) => {
    const ok = labels.has(st);
    console.log(`  ${String(n).padStart(3)}  "${st}"  ${ok ? '✅ en pipeline' : '❌ HUÉRFANO (no coincide con ninguna columna)'}`);
  });
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
