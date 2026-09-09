import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
  updateDoc,
  writeBatch,
  runTransaction,
  serverTimestamp,
  type Timestamp,
  type FieldValue
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { BankAccount } from './SettingsService';

export type { BankAccount };

export type PaymentMethod = 'paypal' | 'sinpe' | 'bank';
// Subconjunto de PaymentMethod que se puede confirmar manualmente — PayPal
// se confirma solo por captura real server-side (ver functions/src/index.ts),
// nunca por esta vía.
export type LocalPaymentMethod = 'sinpe' | 'bank';

export interface PaymentRequest {
  id: string;
  tenantId: string;
  customer: string;
  concept: string;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'expired';
  paypalEmail: string;
  // Métodos habilitados para ESTE link puntual — elegidos por el asesor al
  // crearlo, siempre un subconjunto de lo que el tenant tiene configurado en
  // /pagos. undefined/[] en links viejos (previos a este campo) se trata como
  // "todos los que el tenant tenga configurados", ver getEnabledMethodsFallback.
  enabledMethods?: PaymentMethod[];
  createdAt: Timestamp | FieldValue;
  // Escritos exclusivamente por el backend (createPaymentRequestPaypalOrder /
  // capturePaymentRequestPaypalOrder, Admin SDK) — el frontend nunca los
  // escribe. expectedPaypalAmount/Currency son el monto canónico congelado
  // al crear la orden; capturedAmount/Currency son lo que PayPal realmente
  // capturó, guardado para auditoría aunque ya deban coincidir.
  paypalOrderId?: string;
  expectedPaypalAmount?: string;
  expectedPaypalCurrency?: string;
  capturedAmount?: string;
  capturedCurrency?: string;
  paidAt?: Timestamp | FieldValue;
  // Escritos exclusivamente por PaymentService.markAsPaid (Owner/Admin
  // confirmando un pago local — ver firestore.rules, solo esos roles pueden
  // hacer esta transición vía cliente). paidBy es el uid, paidByName es un
  // cache de display para el Historial sin necesitar un lookup aparte.
  paidBy?: string;
  paidByName?: string;
  paymentMethod?: LocalPaymentMethod;
  paymentReference?: string;
}

/**
 * Snapshot público mínimo de una INSTRUCCIÓN DE PAGO — es lo ÚNICO que la
 * ficha pública /pay/{id} puede leer sin autenticación (colección separada,
 * con su propia regla allow read: if true). Nunca contiene el documento de
 * settings completo del tenant (sin aiAgentConfig, sin tokens, sin datos de
 * otros clientes) — solo los campos que el asesor decidió incluir en ESTA
 * instrucción puntual.
 *
 * Importante conceptualmente (ver PublicPaymentView.tsx): para SINPE/
 * transferencia bancaria, SmartFlow NO procesa ni custodia el dinero — solo
 * organiza y muestra las instrucciones de cobro del propio negocio. El
 * nombre de la colección (`public_payment_links`) y de este tipo se
 * mantienen por compatibilidad con datos ya escritos (evita una migración),
 * aunque el concepto de "link de pago" ya no es como se presenta al usuario.
 *
 * Se escribe una vez al crear la instrucción (snapshot) y solo se actualiza
 * su status server-side (PayPal) o por Owner/Admin confirmando manualmente
 * (ver markAsPaid) — el cliente que paga nunca puede marcarla "paid".
 */
export interface PublicPaymentLink {
  id: string;
  // Necesario únicamente porque la regla de creación de public_payment_links
  // valida isTenantMember(request.resource.data.tenantId) — el frontend
  // público nunca lee este campo (ver PublicPaymentView.tsx).
  tenantId: string;
  businessName: string;
  // URL pública del logo del negocio (Firebase Storage u otra URL pública) —
  // nunca el documento de settings completo, solo esta URL puntual.
  businessLogo?: string;
  whatsappPhone?: string;
  customer: string;
  concept: string;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'expired';
  enabledMethods: PaymentMethod[];
  // paypalEmail deliberadamente NO forma parte del snapshot público: desde
  // que la orden de PayPal se crea server-side (createPaymentRequestPaypalOrder,
  // que lee paypalEmail directamente de payment_requests), el navegador ya
  // no lo necesita para nada — exponerlo públicamente sería innecesario.
  sinpePhone?: string;
  sinpeOwner?: string;
  sinpeId?: string;
  // Cada cuenta se renderiza como su propia tarjeta con su propio botón
  // "Copiar" — nunca agrupadas en un solo bloque de texto libre.
  bankAccounts?: BankAccount[];
  createdAt: Timestamp | FieldValue;
}

export const PaymentService = {
  /**
   * Crea la solicitud interna (payment_requests, privada, solo el tenant la
   * lee) y su snapshot público sanitizado (public_payment_links, lectura
   * pública) en un solo batch atómico — ambos documentos comparten el mismo
   * ID, así que /pay/{id} y el historial interno siempre están en sync.
   */
  createRequest: async (
    request: Omit<PaymentRequest, 'createdAt'>,
    publicInfo: Omit<PublicPaymentLink, 'id' | 'createdAt' | 'tenantId' | 'customer' | 'concept' | 'amount' | 'currency' | 'status'>
  ) => {
    const batch = writeBatch(db);

    const requestRef = doc(db, 'payment_requests', request.id);
    batch.set(requestRef, {
      ...request,
      createdAt: serverTimestamp(),
    });

    const publicRef = doc(db, 'public_payment_links', request.id);
    batch.set(publicRef, {
      id: request.id,
      tenantId: request.tenantId,
      customer: request.customer,
      concept: request.concept,
      amount: request.amount,
      currency: request.currency,
      status: request.status,
      ...publicInfo,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  },

  getRequest: async (id: string): Promise<PaymentRequest | null> => {
    const docRef = doc(db, 'payment_requests', id);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as PaymentRequest;
    }
    return null;
  },

  /** Lectura pública — usada por /pay/{id}, sin autenticación. */
  getPublicLink: async (id: string): Promise<PublicPaymentLink | null> => {
    const docRef = doc(db, 'public_payment_links', id);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as PublicPaymentLink;
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
  },

  /**
   * Confirmación MANUAL de un pago local (SINPE / transferencia bancaria) —
   * exclusiva de Owner/Admin, ver firestore.rules (isTenantAdmin exige
   * status=='pending' en el doc actual, prohíbe alterar amount/currency/
   * tenantId/customer/concept, y ninguna otra vía de cliente puede escribir
   * 'paid'). Se lee el doc DENTRO de la transacción y se verifica
   * status=='pending' antes de escribir — evita que dos confirmaciones
   * simultáneas (doble click, dos personas) produzcan un estado inconsistente;
   * si alguien más ya lo confirmó, la transacción falla con un error claro en
   * vez de sobreescribir silenciosamente paidBy/paymentMethod.
   *
   * payment_requests recibe el detalle completo (paidBy/paymentMethod/
   * referencia); public_payment_links solo status:'paid' — el pagador nunca
   * necesita saber quién ni con qué método se confirmó (minimización de datos,
   * mismo criterio que el resto de este archivo).
   */
  markAsPaid: async (
    id: string,
    data: { paymentMethod: LocalPaymentMethod; paymentReference?: string; paidByUid: string; paidByName: string }
  ): Promise<void> => {
    const reqRef = doc(db, 'payment_requests', id);
    const publicRef = doc(db, 'public_payment_links', id);

    await runTransaction(db, async (tx) => {
      const reqSnap = await tx.get(reqRef);
      const publicSnap = await tx.get(publicRef);

      if (!reqSnap.exists()) {
        throw new Error('La solicitud de pago no existe.');
      }
      const req = reqSnap.data() as PaymentRequest;
      if (req.status === 'paid') {
        throw new Error('Este cobro ya fue confirmado como pagado.');
      }
      if (req.status !== 'pending') {
        throw new Error('Este cobro no está disponible para confirmar pago.');
      }

      const updatePayload: Partial<PaymentRequest> = {
        status: 'paid',
        paidAt: serverTimestamp(),
        paidBy: data.paidByUid,
        paidByName: data.paidByName,
        paymentMethod: data.paymentMethod,
        ...(data.paymentReference ? { paymentReference: data.paymentReference } : {}),
      };
      tx.update(reqRef, updatePayload);

      if (publicSnap.exists()) {
        tx.update(publicRef, { status: 'paid' });
      }
    });
  }
};
