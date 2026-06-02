import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  addDoc, 
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { CatalogItem } from '@/types';

export const CatalogService = {
  /**
   * Suscribe a los elementos del catálogo de un tenant.
   */
  subscribeToCatalog: (tenantId: string, callback: (items: CatalogItem[]) => void, errorCallback?: (error: any) => void) => {
    const q = query(
      collection(db, 'catalog'),
      where('tenantId', '==', tenantId)
    );

    return onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      })) as CatalogItem[];
      // Ordenar por nombre localmente para simplificar indexación sin necesidad de índices complejos en Firestore
      items.sort((a, b) => a.name.localeCompare(b.name));
      callback(items);
    }, (error) => {
      console.error("Error subscribing to catalog:", error);
      if (errorCallback) errorCallback(error);
    });
  },

  /**
   * Crea un nuevo elemento en el catálogo.
   */
  createCatalogItem: async (tenantId: string, itemData: Partial<CatalogItem>) => {
    return await addDoc(collection(db, 'catalog'), {
      ...itemData,
      tenantId,
      createdAt: new Date().toISOString()
    });
  },

  /**
   * Actualiza un elemento del catálogo.
   */
  updateCatalogItem: async (itemId: string, data: Partial<CatalogItem>) => {
    const docRef = doc(db, 'catalog', itemId);
    return await updateDoc(docRef, {
      ...data,
      updatedAt: new Date().toISOString()
    });
  },

  /**
   * Elimina un elemento del catálogo.
   */
  deleteCatalogItem: async (itemId: string) => {
    const docRef = doc(db, 'catalog', itemId);
    return await deleteDoc(docRef);
  },

  /**
   * Importa de manera masiva elementos al catálogo usando WriteBatch.
   */
  batchImportCatalogItems: async (tenantId: string, items: Partial<CatalogItem>[]) => {
    const batch = writeBatch(db);
    const colRef = collection(db, 'catalog');
    const createdAt = new Date().toISOString();

    items.forEach((item) => {
      const newDocRef = doc(colRef);
      batch.set(newDocRef, {
        ...item,
        tenantId,
        createdAt
      });
    });

    return await batch.commit();
  }
};
