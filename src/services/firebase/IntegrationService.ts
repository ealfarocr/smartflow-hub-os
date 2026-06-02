import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  setDoc, 
  serverTimestamp,
  limit
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface WhatsAppIntegration {
  id?: string;
  tenantId: string;
  provider: 'whatsapp';
  phoneNumberId: string;
  whatsappBusinessAccountId: string;
  appSecret: string;
  verifyToken: string;
  accessToken: string;
  isActive: boolean;
  isAiAutomated?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export interface MetaIntegration {
  id?: string;
  tenantId: string;
  provider: 'facebook' | 'instagram';
  platformId: string; // Page ID o Instagram Account ID
  accessToken: string; // Page Access Token o Instagram Token
  isActive: boolean;
  isAiAutomated?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export const IntegrationService = {
  /**
   * Obtiene la configuración de WhatsApp para el tenant dado
   */
  getWhatsAppConfig: async (tenantId: string): Promise<WhatsAppIntegration | null> => {
    const q = query(
      collection(db, 'integrations'),
      where('tenantId', '==', tenantId),
      where('provider', '==', 'whatsapp'),
      limit(1)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as WhatsAppIntegration;
  },

  /**
   * Guarda o actualiza la configuración de WhatsApp para el tenant
   */
  saveWhatsAppConfig: async (tenantId: string, data: Omit<WhatsAppIntegration, 'tenantId' | 'provider' | 'id'>) => {
    // Buscar si ya existe para actualizar el mismo documento
    const q = query(
      collection(db, 'integrations'),
      where('tenantId', '==', tenantId),
      where('provider', '==', 'whatsapp'),
      limit(1)
    );
    const snapshot = await getDocs(q);
    
    let docRef;
    if (!snapshot.empty) {
      docRef = doc(db, 'integrations', snapshot.docs[0].id);
    } else {
      docRef = doc(collection(db, 'integrations'));
    }

    const docData = {
      ...data,
      tenantId,
      provider: 'whatsapp',
      updatedAt: serverTimestamp(),
      ...(snapshot.empty && { createdAt: serverTimestamp() })
    };

    await setDoc(docRef, docData, { merge: true });
    return docRef.id;
  },

  /**
   * Obtiene la configuración de Facebook o Instagram para el tenant dado
   */
  getMetaConfig: async (tenantId: string, provider: 'facebook' | 'instagram'): Promise<MetaIntegration | null> => {
    const q = query(
      collection(db, 'integrations'),
      where('tenantId', '==', tenantId),
      where('provider', '==', provider),
      limit(1)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as MetaIntegration;
  },

  /**
   * Guarda o actualiza la configuración de Facebook o Instagram para el tenant
   */
  saveMetaConfig: async (tenantId: string, provider: 'facebook' | 'instagram', data: Omit<MetaIntegration, 'tenantId' | 'provider' | 'id'>) => {
    const q = query(
      collection(db, 'integrations'),
      where('tenantId', '==', tenantId),
      where('provider', '==', provider),
      limit(1)
    );
    const snapshot = await getDocs(q);
    
    let docRef;
    if (!snapshot.empty) {
      docRef = doc(db, 'integrations', snapshot.docs[0].id);
    } else {
      docRef = doc(collection(db, 'integrations'));
    }

    const docData = {
      ...data,
      tenantId,
      provider,
      updatedAt: serverTimestamp(),
      ...(snapshot.empty && { createdAt: serverTimestamp() })
    };

    await setDoc(docRef, docData, { merge: true });
    return docRef.id;
  }
};
