// Agrega (o actualiza) la herramienta "Multi-Agente" en el catálogo maestro `available_tools`,
// para que aparezca en Super Admin → Gestión de Negocios → Herramientas y en el Tools Hub.
// No toca ningún otro documento ni tenant existente — solo crea/actualiza este doc puntual
// (merge:true, seguro de re-ejecutar). No cambia qué tenant tiene el flag activo o no.
// Uso: node scripts/seed_multi_agent_tool.mjs
import admin from 'firebase-admin';

admin.initializeApp({ projectId: 'paneles-solares-bcs-mx' });
const db = admin.firestore();

async function seedMultiAgentTool() {
  await db.collection('available_tools').doc('multi-agent').set({
    id: 'multi-agent',
    key: 'hasMultiAgentPanel',
    label: 'Multi-Agente',
    desc: 'Panel de distribución de conversaciones entre agentes del equipo.',
    iconName: 'Headset',
    color: '#25D366',
    isActive: true,
    order: 2.5,
    price: 0,
    isFree: true,
  }, { merge: true });

  console.log('✅ Herramienta "Multi-Agente" (available_tools/multi-agent) creada/actualizada.');
  console.log('   Sigue desactivada por defecto para todos los tenants — activarla por negocio');
  console.log('   desde Super Admin → Gestión de Negocios → Herramientas.');
  process.exit(0);
}

seedMultiAgentTool().catch((e) => { console.error('ERR', e.message); process.exit(1); });
