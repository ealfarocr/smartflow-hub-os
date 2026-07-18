import admin from 'firebase-admin';
delete process.env.FIRESTORE_EMULATOR_HOST;
admin.initializeApp({
  projectId: 'paneles-solares-bcs-mx',
  storageBucket: 'paneles-solares-bcs-mx.firebasestorage.app',
});
const bucket = admin.storage().bucket();

(async () => {
  const path = `_healthcheck/test-${Date.now()}.txt`;
  const file = bucket.file(path);
  try {
    console.log(`Probando escritura en ${bucket.name} → ${path} ...`);
    await file.save(Buffer.from('healthcheck ok'), { contentType: 'text/plain' });
    console.log('✅ ESCRITURA OK — Cloud Storage está funcionando (cuota liberada).');
    await file.delete();
    console.log('🧹 Archivo de prueba borrado.');
    process.exit(0);
  } catch (e) {
    console.log('❌ ESCRITURA FALLÓ:');
    console.log('   code:', e.code);
    console.log('   message:', e.message);
    if (/quota/i.test(e.message) || e.code === 429) {
      console.log('   → La cuota AÚN no se ha liberado. Espera unos minutos más.');
    }
    process.exit(1);
  }
})();
