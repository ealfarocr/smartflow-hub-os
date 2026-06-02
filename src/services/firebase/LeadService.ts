import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  runTransaction,
  getDocs,
  orderBy,
  serverTimestamp,
  addDoc,
  updateDoc
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Lead, CRMStage } from '@/types';

export const LeadService = {
  /**
   * Suscribe a los leads de un tenant con ordenamiento en tiempo real.
   */
  subscribeToLeads: (tenantId: string, callback: (leads: Lead[]) => void, errorCallback?: (error: any) => void) => {
    const q = query(
      collection(db, 'leads'),
      where('tenantId', '==', tenantId),
      orderBy('orderIndex', 'asc')
    );

    return onSnapshot(q, (snapshot) => {
      const leads = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      })) as Lead[];
      callback(leads);
    }, (error) => {
      console.error("Error subscribing to leads:", error);
      if (errorCallback) errorCallback(error);
    });
  },

  /**
   * Mueve un lead atómicamente usando transacciones.
   */
  moveLeadTransaction: async (
    tenantId: string, 
    leadId: string, 
    sourceStage: CRMStage, 
    destStage: CRMStage, 
    destIndex: number
  ) => {
    await runTransaction(db, async (transaction) => {
      // Consultar leads de la etapa origen
      const sourceQuery = query(
        collection(db, 'leads'),
        where('tenantId', '==', tenantId),
        where('stage', '==', sourceStage),
        orderBy('orderIndex', 'asc')
      );
      
      // Consultar leads de la etapa destino
      const destQuery = sourceStage === destStage ? sourceQuery : query(
        collection(db, 'leads'),
        where('tenantId', '==', tenantId),
        where('stage', '==', destStage),
        orderBy('orderIndex', 'asc')
      );

      const [sourceSnap, destSnap] = await Promise.all([
        getDocs(sourceQuery),
        sourceStage === destStage ? Promise.resolve(null) : getDocs(destQuery)
      ]);

      const sourceLeads = sourceSnap.docs.map(d => ({ ...d.data(), id: d.id })) as Lead[];
      let destLeads = destSnap ? destSnap.docs.map(d => ({ ...d.data(), id: d.id })) as Lead[] : sourceLeads;

      const leadToMove = sourceLeads.find(l => l.id === leadId);
      if (!leadToMove) throw new Error("Lead no encontrado en la etapa origen");

      // Lógica de reordenamiento
      let newSourceLeads = sourceLeads.filter(l => l.id !== leadId);
      let newDestLeads: Lead[] = [];

      if (sourceStage === destStage) {
        newSourceLeads.splice(destIndex, 0, leadToMove);
        newDestLeads = newSourceLeads;
      } else {
        newDestLeads = [...destLeads];
        newDestLeads.splice(destIndex, 0, { ...leadToMove, stage: destStage });
      }

      // Aplicar reindexación
      newSourceLeads.forEach((l, idx) => {
        if (l.id !== leadId && l.orderIndex !== idx) {
          transaction.update(doc(db, 'leads', l.id), { orderIndex: idx });
        }
      });

      newDestLeads.forEach((l, idx) => {
        if (l.id === leadId) {
          transaction.update(doc(db, 'leads', l.id), {
            stage: destStage,
            orderIndex: idx,
            lastActivity: new Date().toISOString(),
            updatedAt: serverTimestamp()
          });
        } else if (l.orderIndex !== idx) {
          transaction.update(doc(db, 'leads', l.id), { orderIndex: idx });
        }
      });
    });
  },

  /**
   * Crea un nuevo lead.
   */
  createLead: async (tenantId: string, leadData: Partial<Lead>) => {
    await addDoc(collection(db, 'leads'), {
      ...leadData,
      tenantId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      orderIndex: 0
    });
  },

  /**
   * Semilla (Testing)
   */
  seedSampleLeads: async (tenantId: string) => {
    const samples = [
      { 
        name: 'Juan Perez', phone: '5511223344', city: 'Ciudad de México', keyData: '$150,000 MX', 
        stage: 'Nuevo', orderIndex: 0,
        aiPropensity: 92, aiSentiment: 'positive', aiNextStep: 'Enviar link de pago'
      },
      { 
        name: 'Maria Garcia', phone: '5566778899', city: 'Monterrey', keyData: '$85,000 MX', 
        stage: 'Nuevo', orderIndex: 1,
        aiPropensity: 55, aiSentiment: 'neutral', aiNextStep: 'Enviar ficha técnica'
      },
      { 
        name: 'Pedro Lopez', phone: '5544332211', city: 'Guadalajara', keyData: '$220,000 MX', 
        stage: 'Seguimiento', orderIndex: 0,
        aiPropensity: 22, aiSentiment: 'critical', aiIsCold: true, aiNextStep: 'Mensaje de recuperación'
      },
    ];

    for (const s of samples) {
      await addDoc(collection(db, 'leads'), {
        ...s,
        tenantId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
  },

  /**
   * Actualiza un lead por ID.
   */
  updateLead: async (leadId: string, data: Partial<Lead>) => {
    const docRef = doc(db, 'leads', leadId);
    await updateDoc(docRef, {
      ...data,
      updatedAt: serverTimestamp()
    });
  },

  /**
   * Elimina un lead por ID.
   */
  deleteLead: async (leadId: string) => {
    const { deleteDoc } = await import('firebase/firestore');
    const docRef = doc(db, 'leads', leadId);
    await deleteDoc(docRef);
  }
};
