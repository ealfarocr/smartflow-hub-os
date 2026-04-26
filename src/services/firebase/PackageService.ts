import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Package } from '@/types';

export const PackageService = {
  /**
   * Suscribe a los paquetes de un tenant específico en tiempo real
   */
  subscribeToPackages: (tenantId: string, callback: (packages: Package[]) => void, errorCallback?: (error: any) => void) => {
    const q = query(
      collection(db, 'packages'),
      where('tenantId', '==', tenantId)
    );

    return onSnapshot(q, (snapshot) => {
      const packages = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      })) as Package[];
      callback(packages);
    }, (error) => {
      console.error("Error subscribing to packages:", error);
      if (errorCallback) errorCallback(error);
    });
  },

  /**
   * Crea un nuevo paquete en Firestore
   */
  createPackage: async (pkg: Omit<Package, 'id'>) => {
    const docRef = await addDoc(collection(db, 'packages'), {
      ...pkg,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return docRef.id;
  },

  /**
   * Actualiza un paquete existente
   */
  updatePackage: async (packageId: string, data: Partial<Package>) => {
    const docRef = doc(db, 'packages', packageId);
    await updateDoc(docRef, {
      ...data,
      updatedAt: serverTimestamp()
    });
  }
};
