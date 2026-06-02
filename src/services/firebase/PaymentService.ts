import { 
  doc, 
  setDoc, 
  getDoc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
  updateDoc,
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface PaymentRequest {
  id: string;
  tenantId: string;
  customer: string;
  concept: string;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'expired';
  paypalEmail: string;
  createdAt: any;
}

export const PaymentService = {
  createRequest: async (request: Omit<PaymentRequest, 'createdAt'>) => {
    const docRef = doc(db, 'payment_requests', request.id);
    await setDoc(docRef, {
      ...request,
      createdAt: serverTimestamp()
    });
  },

  getRequest: async (id: string): Promise<PaymentRequest | null> => {
    const docRef = doc(db, 'payment_requests', id);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as PaymentRequest;
    }
    return null;
  },

  listRequests: async (tenantId: string): Promise<PaymentRequest[]> => {
    const q = query(
      collection(db, 'payment_requests'),
      where('tenantId', '==', tenantId),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ ...d.data(), id: d.id } as PaymentRequest));
  },

  updateRequest: async (id: string, data: Partial<PaymentRequest>): Promise<void> => {
    const docRef = doc(db, 'payment_requests', id);
    await updateDoc(docRef, data);
  }
};
