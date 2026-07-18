import admin from 'firebase-admin';
delete process.env.FIRESTORE_EMULATOR_HOST;
admin.initializeApp({ projectId: 'paneles-solares-bcs-mx' });
const db = admin.firestore();

const TENANT = 't-1779680745567'; // IGUANA PARK

(async () => {
  const snap = await db.collection('agenda_items')
    .where('tenantId', '==', TENANT)
    .get();

  // Agrupar visitas pendientes por lead
  const byLead = {};
  snap.docs.forEach((d) => {
    const x = d.data();
    if (x.type === 'visita' && !x.isCompleted) {
      (byLead[x.leadId || '(sin lead)'] ||= []).push({ id: d.id, ref: d.ref, date: x.date || '', title: x.title || '' });
    }
  });

  let deleted = 0;
  for (const [leadId, items] of Object.entries(byLead)) {
    if (items.length <= 1) continue;
    // Ordenar por fecha DESC, conservar la más reciente, borrar el resto
    items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const keep = items[0];
    console.log(`\nLead ${leadId} — ${items.length} visitas pendientes:`);
    console.log(`  ✅ CONSERVO: ${keep.date} (${keep.title})`);
    for (const it of items.slice(1)) {
      console.log(`  🗑️  BORRO:    ${it.date} (${it.title})`);
      await it.ref.delete();
      deleted++;
    }
  }

  console.log(`\nTotal duplicadas borradas: ${deleted}`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
