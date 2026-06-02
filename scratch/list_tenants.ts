import { collection, getDocs } from 'firebase/firestore';
import { db } from '../src/lib/firebase';

async function list() {
  try {
    const snap = await getDocs(collection(db, 'tenants'));
    if (snap.empty) {
       console.log("No hay tenants en la colección.");
       return;
    }
    snap.docs.forEach(d => {
      const data = d.data();
      console.log(`ID: ${d.id} | Name: ${data.name || data.n} | Email: ${data.ownerEmail}`);
    });
  } catch (e) {
    console.error(e);
  }
}

list();
