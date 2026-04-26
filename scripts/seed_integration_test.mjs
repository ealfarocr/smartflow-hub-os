import admin from 'firebase-admin';

admin.initializeApp({
  projectId: "paneles-solares-bcs-mx"
});

const db = admin.firestore();

async function seedIntegration() {
  const tenantId = "t-alpha";
  const testNumberId = "123456123"; // ID que usa el botón "Test" de Meta

  console.log(`Configurando integración para el ID de prueba: ${testNumberId}...`);

  await db.collection("whatsapp_config").doc(testNumberId).set({
    phoneNumberId: testNumberId,
    tenantId: tenantId,
    isActive: true,
    description: "Configuración de prueba para botón Test de Meta",
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  console.log("✅ Integración registrada exitosamente.");
  process.exit(0);
}

seedIntegration();
