import admin from 'firebase-admin';

/**
 * SEED ADMINISTRATIVO GENERAL (LOCAL ONLY)
 * Inyecta usuarios, tenants y membresías saltándose las reglas de seguridad
 * para habilitar el acceso al sistema en el emulador.
 */

// Forzar conexión a los emuladores
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

admin.initializeApp({
  projectId: "demo-psmx"
});

const auth = admin.auth();
const db = admin.firestore();

(async () => {
    try {
        console.log("Iniciando inyeccion administrativa de Seeds (Sprint 6.1)...");

        // 1. Inyectar Tenants
        await db.collection("tenants").doc("t-alpha").set({ id: "t-alpha", name: "Alfa Solar MX", isActive: true });
        await db.collection("tenants").doc("t-beta").set({ id: "t-beta", name: "Beta Energía", isActive: true });

        const usersToCreate = [
            { email: "admin@alpha.com", password: "prueba123", name: "Carlos Admin (Alfa)", role: "Admin", tenantId: "t-alpha" },
            { email: "socio@gruposolar.com", password: "prueba123", name: "Roberto Socio", role: "Socio", extraTenants: ["t-alpha", "t-beta"] },
            { email: "vendedor@alpha.com", password: "prueba123", name: "Luis Venta", role: "Vendedor", tenantId: "t-alpha" },
            { email: "nuevo@alpha.com", password: "prueba123", name: "Ana Ingreso Reciente", role: null }
        ];

        for (const u of usersToCreate) {
            let userRecord;
            try {
                // Intentar obtener si ya existe
                userRecord = await auth.getUserByEmail(u.email);
            } catch (e) {
                // Crear si no existe
                userRecord = await auth.createUser({
                    email: u.email,
                    password: u.password,
                    displayName: u.name
                });
            }

            const uid = userRecord.uid;
            
            // 2. Guardar en colección de usuarios de Firestore
            await db.collection("users").doc(uid).set({
                id: uid,
                name: u.name,
                email: u.email,
                isActive: true
            });

            // 3. Crear Membresía Principal
            if (u.tenantId && u.role) {
                await db.collection("memberships").doc(`${uid}_${u.tenantId}`).set({
                    id: `${uid}_${u.tenantId}`,
                    userId: uid,
                    tenantId: u.tenantId,
                    role: u.role,
                    status: "active"
                });
            }

            // 4. Crear Membresías Extra (Multi-tenant)
            if (u.extraTenants) {
                for (const tId of u.extraTenants) {
                    await db.collection("memberships").doc(`${uid}_${tId}`).set({
                        id: `${uid}_${tId}`,
                        userId: uid,
                        tenantId: tId,
                        role: u.role,
                        status: "active"
                    });
                }
            }
            
            console.log(`- Configurado: ${u.email}`);
        }

        console.log("=== SEEDS ADMINISTRATIVOS CREADOS CON ÉXITO ===");
        process.exit(0);
    } catch(e) {
        console.error("Error crítico en el seed:", e);
        process.exit(1);
    }
})();
