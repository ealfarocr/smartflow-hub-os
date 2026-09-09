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
  // whatsappBusinessAccountId es el campo legacy (formulario manual);
  // wabaId es el canónico nuevo (Embedded Signup). completeWhatsappEmbeddedSignup
  // escribe ambos, pero se leen los dos por si un doc viejo solo tiene uno.
  whatsappBusinessAccountId: string;
  wabaId?: string;
  appSecret: string;
  verifyToken: string;
  accessToken: string;
  isActive: boolean;
  isAiAutomated?: boolean;
  // Solo presentes cuando la integración vino de Embedded Signup.
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
  connectionType?: 'api' | 'coexistent';
  createdAt?: any;
  updatedAt?: any;
}

/** WABA ID de un doc de integrations, sin importar cuál de los dos campos tenga. */
export const getWabaId = (integration: Pick<WhatsAppIntegration, 'wabaId' | 'whatsappBusinessAccountId'> | null | undefined): string => {
  if (!integration) return '';
  return integration.wabaId || integration.whatsappBusinessAccountId || '';
};

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
