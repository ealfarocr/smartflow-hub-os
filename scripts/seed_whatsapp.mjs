import admin from 'firebase-admin';

/**
 * SEED ADMINISTRATIVO PARA WHATSAPP (LOCAL ONLY)
 * Este script usa firebase-admin para saltarse las reglas de seguridad
 * y configurar el entorno local para recibir Webhooks.
 */

// Forzar conexión al emulador de Firestore
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

admin.initializeApp({
  projectId: "demo-psmx"
});

const db = admin.firestore();

(async () => {
    try {
        console.log("Inyectando Integración de WhatsApp (Vía Administrativa)...");

        // ID real del panel de Meta de prueba
        const TEST_PHONE_NUMBER_ID = "106487218962793"; 

        const integrationRef = db.collection("integrations").doc("wa_alpha_test");
        
        await integrationRef.set({
            tenantId: "t-alpha",
            provider: "whatsapp",
            phoneNumberId: TEST_PHONE_NUMBER_ID,
            isActive: true,
            createdAt: new Date().toISOString(), // Usamos ISO string para consistencia con el front
            config: {
                verifyToken: "psmx_verify_token_dev"
            }
        });

        console.log("=== INTEGRACIÓN INYECTADA CON ÉXITO ===");
        console.log(`- Documento: integrations/wa_alpha_test`);
        console.log(`- Tenant: t-alpha`);
        console.log(`- phoneNumberId: ${TEST_PHONE_NUMBER_ID}`);
        console.log(`- Project ID: demo-psmx`);
        
        process.exit(0);
    } catch(e) {
        console.error("Error crítico en el seed:", e);
        process.exit(1);
    }
})();
