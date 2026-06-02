import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs, query, orderBy, limit, where } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAFAclEs9Jc6fJxAWTI7eXJiZCoOlZPYGg",
  authDomain: "paneles-solares-bcs-mx.firebaseapp.com",
  projectId: "paneles-solares-bcs-mx",
  storageBucket: "paneles-solares-bcs-mx.firebasestorage.app",
  messagingSenderId: "652296458641",
  appId: "1:652296458641:web:59bfb7ce64c79e22f8ca30"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function checkData() {
  try {
    // SEGURIDAD: credenciales movidas a variables de entorno. Nunca commitear passwords.
    // Uso: TEST_USER_EMAIL=... TEST_USER_PASSWORD=... node scripts/check_frontend.mjs
    const email = process.env.TEST_USER_EMAIL;
    const password = process.env.TEST_USER_PASSWORD;
    if (!email || !password) {
      console.error("Configura TEST_USER_EMAIL y TEST_USER_PASSWORD antes de ejecutar.");
      process.exit(1);
    }

    console.log(`Iniciando sesion con ${email}...`);
    await signInWithEmailAndPassword(auth, email, password);
    console.log("Sesion iniciada correctamente.");

    console.log("Obteniendo últimas conversaciones...");
    const q = query(
      collection(db, "conversations"), 
      where("tenantId", "==", "t-alpha")
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      console.log("No se encontraron conversaciones en la base de datos.");
    } else {
      const docs = [];
      snapshot.forEach(doc => docs.push(doc));
      docs.sort((a,b) => {
        const tA = a.data().updatedAt?.toMillis() || 0;
        const tB = b.data().updatedAt?.toMillis() || 0;
        return tB - tA;
      });

      docs.slice(0,3).forEach(doc => {
        const data = doc.data();
        let updatedAt = data.updatedAt ? data.updatedAt.toDate().toLocaleString() : 'N/A';
        console.log(`\nConversación: ${doc.id}`);
        console.log(`Contacto: ${data.contactName} (${data.phoneRaw})`);
        console.log(`Último mensaje original (texto exacto): ${data.lastMessage}`);
        console.log(`Última actualización: ${updatedAt}`);
        console.log(`Enviado por: ${data.lastMessageSender}`);
      });
    }

  } catch (error) {
    console.error("Error consultando la BD:", error);
  } finally {
    process.exit(0);
  }
}

checkData();
