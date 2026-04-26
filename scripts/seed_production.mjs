import admin from 'firebase-admin';

/**
 * SEED DE PRODUCCIÓN - PANELES SOLARES BCS MX
 * Este script inicializa el usuario administrador y el tenant en el proyecto real.
 * 
 * EJECUCIÓN: node seed_production.mjs
 */

// NO borrar: Asegurar que no usemos emuladores
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

admin.initializeApp({
  projectId: "paneles-solares-bcs-mx"
});

const auth = admin.auth();
const db = admin.firestore();

async function seedProduction() {
  console.log("Iniciando inyección de datos en PRODUCCIÓN (paneles-solares-bcs-mx)...");

  try {
    // 1. Crear el Tenant principal
    const tenantId = "t-alpha";
    await db.collection("tenants").doc(tenantId).set({
      id: tenantId,
      name: "Alfa Solar MX",
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log("- Tenant 'Alfa Solar MX' creado.");

    // 2. Definir el usuario administrador inicial
    const adminUser = {
      email: "admin@alpha.com",
      password: "prueba123",
      name: "Administrador General",
      role: "Admin"
    };

    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(adminUser.email);
      console.log("- El usuario ya existe en Auth.");
    } catch (e) {
      userRecord = await auth.createUser({
        email: adminUser.email,
        password: adminUser.password,
        displayName: adminUser.name
      });
      console.log("- Usuario creado en Auth.");
    }

    const uid = userRecord.uid;

    // 3. Crear documento de usuario en Firestore
    await db.collection("users").doc(uid).set({
      id: uid,
      name: adminUser.name,
      email: adminUser.email,
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log("- Datos de usuario guardados en Firestore.");

    // 4. Crear Membresía Admin
    await db.collection("memberships").doc(`${uid}_${tenantId}`).set({
      id: `${uid}_${tenantId}`,
      userId: uid,
      tenantId: tenantId,
      role: adminUser.role,
      status: "active",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log("- Membresía Admin vinculada.");

    console.log("\n=== SEED DE PRODUCCIÓN COMPLETADO EXITOSAMENTE ===");
    console.log("Ya puedes iniciar sesión con:");
    console.log(`Email: ${adminUser.email}`);
    console.log(`Password: ${adminUser.password}`);
    
  } catch (error) {
    console.error("\n❌ ERROR AL SEMBRAR DATOS:", error);
    console.log("\nTIP: Asegúrate de tener permisos de administrador en este proyecto.");
  }
}

seedProduction();
