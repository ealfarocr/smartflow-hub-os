import { collection, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from '../src/lib/firebase';

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
