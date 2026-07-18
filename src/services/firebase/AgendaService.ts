import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  orderBy,
  Timestamp
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { AgendaItem } from '@/types';
import { toDateSafe } from '@/utils/dateUtils';

export class AgendaService {
  private static collectionName = 'agenda_items';

  static subscribeToTenantAgenda(tenantId: string, callback: (items: AgendaItem[]) => void, errorCallback?: (error: any) => void) {
    const q = query(
      collection(db, this.collectionName),
      where('tenantId', '==', tenantId),
      orderBy('date', 'asc')
    );

    return onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => {
        // Normaliza la fecha a ISO string válido sin importar el formato origen
        // (Timestamp, string, número o serverTimestamp pendiente). Si no parsea,
        // queda null para que el render no lance "Invalid time value".
        const safeDate = toDateSafe(doc.data().date);
        return {
          ...doc.data(),
          id: doc.id,
          date: safeDate ? safeDate.toISOString() : null,
        };
      }) as AgendaItem[];
      callback(items);
    }, (error) => {
      console.error("Error subscribing to agenda:", error);
      if (errorCallback) errorCallback(error);
    });
  }

  static async createItem(tenantId: string, advisorId: string, itemData: Omit<AgendaItem, 'id' | 'tenantId' | 'advisorId'>) {
    const docRef = await addDoc(collection(db, this.collectionName), {
      ...itemData,
      tenantId,
      advisorId,
      // Ensure date is stored as a Timestamp for effective ordering
      date: itemData.date ? Timestamp.fromDate(new Date(itemData.date)) : serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return docRef.id;
  }

  static async updateItem(itemId: string, data: Partial<AgendaItem>) {
    const updateData: any = { ...data, updatedAt: serverTimestamp() };
    
    // If date is being updated, convert to Timestamp
    if (data.date) {
      updateData.date = Timestamp.fromDate(new Date(data.date));
    }

    const docRef = doc(db, this.collectionName, itemId);
    await updateDoc(docRef, updateData);
  }

  static async deleteItem(itemId: string) {
    await deleteDoc(doc(db, this.collectionName, itemId));
  }
}
