// Prueba de concurrencia del round-robin contra el EMULADOR de Firestore.
// Requiere: npm --prefix functions run build  y
//   npx firebase-tools emulators:start --only firestore --project smartflow-e2e --config firebase.e2e.json
// Nunca toca producción (fuerza FIRESTORE_EMULATOR_HOST). Uso: node scripts/qa_round_robin_concurrency.cjs
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'smartflow-e2e' });
const db = admin.firestore();
const { assignConversationAdvisor, ensureConversationAdvisor } = require('../functions/lib/autoAssign.js');
const log = console.log; console.log = () => {}; console.warn = () => {}; // silencia logs internos
(async () => {
  const seed = async (t, ids, disabled = []) => {
    await db.collection('settings').doc(t).set({ multiAgentConfig: { isAutoDistributionEnabled: true, includedUserIds: [...ids, ...disabled], leadEnabledUserIds: null, roundRobinCursor: null } });
    for (const id of [...ids, ...disabled]) {
      await db.collection('memberships').doc(`${id}_${t}`).set({ tenantId: t, userId: id, status: disabled.includes(id) ? 'suspended' : 'active' });
      await db.collection('user_presence').doc(`${t}_${id}`).set({ operationalStatus: 'working' });
    }
  };
  await seed('tA', ['u1','u2','u3','u4'], ['u5']);
  await seed('tB', ['v1','v2']);
  const res = { A_parallel: [], B: [] };
  const rs = await Promise.all(Array.from({ length: 8 }, () => assignConversationAdvisor(db, 'tA')));
  const count = {}; rs.forEach(r => { count[r.advisorId] = (count[r.advisorId]||0)+1; });
  res.A_parallel = count; res.A_sources = [...new Set(rs.map(r=>r.assignmentSource))];
  // tenant B independiente
  for (let i=0;i<3;i++) res.B.push((await assignConversationAdvisor(db,'tB')).advisorId);
  // secuencial 1→2→3→4→1 en tenant nuevo
  await seed('tC', ['c1','c2','c3','c4']); const seq=[]; for(let i=0;i<5;i++) seq.push((await assignConversationAdvisor(db,'tC')).advisorId); res.seq=seq;
  // existente con asesor no cambia; sin asesor se asigna una vez
  await db.collection('conversations').doc('k1').set({ tenantId:'tC', advisorId:'x-manual' });
  await db.collection('conversations').doc('k2').set({ tenantId:'tC', advisorId:'' });
  const e1 = await ensureConversationAdvisor(db,'tC','k1'); const e2 = await ensureConversationAdvisor(db,'tC','k2');
  res.existing_kept = (await db.collection('conversations').doc('k1').get()).data().advisorId; res.ensure_k1 = e1;
  res.unassigned_filled = (await db.collection('conversations').doc('k2').get()).data().advisorId;
  // dos retries simultáneos sobre la misma conversación sin asesor: 1 solo gana
  await db.collection('conversations').doc('k3').set({ tenantId:'tC', advisorId:'' });
  await Promise.all([ensureConversationAdvisor(db,'tC','k3'), ensureConversationAdvisor(db,'tC','k3')]);
  res.k3 = (await db.collection('conversations').doc('k3').get()).data().advisorId;
  // sin elegibles
  await db.collection('settings').doc('tD').set({ multiAgentConfig: { isAutoDistributionEnabled: true, includedUserIds: [], roundRobinCursor: null } });
  res.noEligible = (await assignConversationAdvisor(db,'tD')).assignmentSource;
  // modo libre
  await db.collection('settings').doc('tE').set({ multiAgentConfig: { isAutoDistributionEnabled: false } });
  res.freeMode = (await assignConversationAdvisor(db,'tE')).assignmentSource;
  log(JSON.stringify(res, null, 1)); process.exit(0);
})().catch(e => { log('ERR', e); process.exit(1); });
