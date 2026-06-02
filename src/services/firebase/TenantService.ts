import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { TenantRecord } from '@/types';

export const TenantService = {
  /**
   * Suscribe a los datos de un tenant en tiempo real (cuotas, branding, etc).
   */
  subscribeToTenant: (tenantId: string, callback: (tenant: TenantRecord | null) => void) => {
    const docRef = doc(db, 'tenants', tenantId);
    
    return onSnapshot(docRef, (snapshot) => {
      if (snapshot.exists()) {
        callback({
          ...snapshot.data(),
          id: snapshot.id
        } as TenantRecord);
      } else {
        callback(null);
      }
    }, (error) => {
      console.error("Error subscribing to tenant:", error);
      callback(null);
    });
  }
};
