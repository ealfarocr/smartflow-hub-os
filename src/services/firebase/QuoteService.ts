import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  addDoc,
  updateDoc,
  serverTimestamp,
  orderBy
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Quote, QuoteStatus } from '@/types';

export const QuoteService = {
  /**
   * Suscribe a las cotizaciones de un tenant.
   */
  subscribeToQuotes: (tenantId: string, callback: (quotes: Quote[]) => void, errorCallback?: (error: any) => void) => {
    const q = query(
      collection(db, 'quotes'),
      where('tenantId', '==', tenantId),
      orderBy('date', 'desc')
    );

    return onSnapshot(q, (snapshot) => {
      const quotes = snapshot.docs
        .map(doc => ({
          ...doc.data(),
          id: doc.id
        }))
        .filter((q: any) => !q.deleted) as Quote[];
      callback(quotes);
    }, (error) => {
      console.error("Error subscribing to quotes:", error);
      if (errorCallback) errorCallback(error);
    });
  },

  /**
   * Genera un número de cotización único (Formato: QT-YYMM-XXX).
   * Nota: En producción esto debería validarse contra una secuencia en DB.
   */
  generateQuoteNumber: () => {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `QT-${year}${month}-${random}`;
  },

  /**
   * Crea una nueva cotización ligada a un lead.
   * Guarda un snapshot completo de los datos técnicos/financieros.
   */
  createQuote: async (tenantId: string, advisorId: string, quoteData: Omit<Quote, 'id' | 'tenantId' | 'advisorId'>) => {
    const quotesRef = collection(db, 'quotes');
    const newQuote = {
      ...quoteData,
      tenantId,
      advisorId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    const docRef = await addDoc(quotesRef, newQuote);
    return { ...newQuote, id: docRef.id } as Quote;
  },

  /**
   * Actualiza el estado de una cotización.
   */
  updateQuoteStatus: async (quoteId: string, status: QuoteStatus) => {
    const docRef = doc(db, 'quotes', quoteId);
    await updateDoc(docRef, { 
      status,
      updatedAt: serverTimestamp()
    });
  },

  /**
   * Realiza un borrado lógico (soft delete) de la cotización.
   */
  deleteQuote: async (quoteId: string, userId: string, userName: string) => {
    const docRef = doc(db, 'quotes', quoteId);
    await updateDoc(docRef, {
      deleted: true,
      deletedAt: serverTimestamp(),
      deletedBy: userId,
      deletedByName: userName,
      updatedAt: serverTimestamp()
    });
  }
};
