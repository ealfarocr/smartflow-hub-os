import admin from 'firebase-admin';
delete process.env.FIRESTORE_EMULATOR_HOST;
admin.initializeApp({ projectId: 'paneles-solares-bcs-mx' });
const db = admin.firestore();

const TENANT = 't-1779680745567'; // IGUANA PARK

(async () => {
  // Etiqueta real de la etapa "agendado" desde el pipeline
  const s = await db.collection('settings').doc(TENANT).get();
  const stages = s.data()?.pipeline?.stages || [];
  const agendStage = stages.find((st) => st.id === 'visita-tecnica') || stages.find((st) => /agend|visita|cita/i.test(st.label || ''));
  const AGEND_LABEL = agendStage?.label;
  if (!AGEND_LABEL) { console.log('No se encontró etapa de agendado en el pipeline.'); process.exit(1); }
  console.log(`Etapa de agendado: "${AGEND_LABEL}"`);

  // Leads con visita pendiente
  const items = await db.collection('agenda_items').where('tenantId', '==', TENANT).get();
  const leadIds = new Set();
  items.docs.forEach((d) => {
    const x = d.data();
    if (x.type === 'visita' && !x.isCompleted && x.leadId) leadIds.add(x.leadId);
  });
  console.log(`Leads con cita pendiente: ${leadIds.size}`);

  let moved = 0;
  for (const leadId of leadIds) {
    const ref = db.collection('leads').doc(leadId);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const cur = snap.data().stage;
    if (cur === AGEND_LABEL) continue;
    await ref.update({ stage: AGEND_LABEL, lastActivity: new Date().toISOString() });
    console.log(`  ✅ ${snap.data().name || leadId}: "${cur}" → "${AGEND_LABEL}"`);
    moved++;
  }
  console.log(`\nLeads movidos a "${AGEND_LABEL}": ${moved}`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
