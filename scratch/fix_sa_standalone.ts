import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAFAclEs9Jc6fJxAWTI7eXJiZCoOlZPYGg",
  authDomain: "paneles-solares-bcs-mx.firebaseapp.com",
  projectId: "paneles-solares-bcs-mx",
  storageBucket: "paneles-solares-bcs-mx.firebasestorage.app",
  messagingSenderID: "652296458641",
  appId: "1:652296458641:web:59bfb7ce64c79e22f8ca30"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function fix() {
  const email = 'publicidadynegociosenlinea@gmail.com';
  console.log(`Buscando usuario: ${email}...`);
  
  const q = query(collection(db, 'users'), where('email', '==', email));
  const snap = await getDocs(q);
  
  if (snap.empty) {
    console.log("No se encontró el usuario en la colección 'users'.");
    return;
  }
  
  const userDoc = snap.docs[0];
  await updateDoc(doc(db, 'users', userDoc.id), { isSuperAdmin: true });
  console.log(`✅ Permisos de Super Admin concedidos a: ${userDoc.id}`);
}

fix();
