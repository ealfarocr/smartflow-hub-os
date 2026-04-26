import { 
  doc, 
  setDoc, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { UserPresence } from '@/types';

export const PresenceService = {
  /**
   * Actualiza el estado de presencia de un usuario.
   * Se usa un ID compuesto {tenantId}_{uid} para facilitar consultas por tenant.
   */
  updatePresence: async (presence: Partial<UserPresence>) => {
    if (!presence.uid || !presence.tenantId) return;

    const presenceId = `${presence.tenantId}_${presence.uid}`;
    const docRef = doc(db, 'user_presence', presenceId);

    await setDoc(docRef, {
      ...presence,
      updatedAt: serverTimestamp()
    }, { merge: true });
  },

  /**
   * Suscribe a todos los estados de presencia de los usuarios de un tenant.
   */
  subscribeToTenantPresence: (tenantId: string, callback: (presenceList: UserPresence[]) => void) => {
    const q = query(
      collection(db, 'user_presence'),
      where('tenantId', '==', tenantId)
    );

    return onSnapshot(q, (snapshot) => {
      const presenceList = snapshot.docs.map(doc => ({
        ...doc.data(),
        uid: (doc.data() as any).uid || doc.id.split('_')[1], // fallback if uid missing
      })) as UserPresence[];
      callback(presenceList);
    });
  }
};
