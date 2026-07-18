import admin from 'firebase-admin';
delete process.env.FIRESTORE_EMULATOR_HOST;
admin.initializeApp({ projectId: 'paneles-solares-bcs-mx' });
const db = admin.firestore();

const TENANT = 't-1779680745567'; // IGUANA PARK
const VIDEO_LINK = 'https://drive.google.com/file/d/1uGMcdMg269cxeEnZYYjgzvYMs0Z9f8jd/view';

(async () => {
  const ref = db.collection('settings').doc(TENANT);
  const snap = await ref.get();
  const kf = snap.data()?.aiAgentConfig?.knowledgeFiles || [];

  // Quitar cualquier entrada previa de "video" para no duplicar
  const cleaned = kf.filter((f) => !/video promo del proyecto/i.test(f.name || ''));

  cleaned.push({
    name: 'Video promo del proyecto (link)',
    content: `VIDEO PROMOCIONAL DEL PROYECTO IGUANA PARK: ${VIDEO_LINK}\n\nINSTRUCCIÓN PARA EL AGENTE: Cuando el cliente pida ver el video, el recorrido, el drone, el promo o "imágenes en movimiento" del proyecto, COMPARTE este link dentro de tu respuesta de texto (ej: "Con gusto, aquí te comparto el video del proyecto: ${VIDEO_LINK}"). NO lo mandes como archivo adjunto — solo el link.`,
  });

  await ref.update({ 'aiAgentConfig.knowledgeFiles': cleaned });
  console.log(`✅ Link de video cargado en el agente de Iguana Park (${cleaned.length} docs de conocimiento).`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
