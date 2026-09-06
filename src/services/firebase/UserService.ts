import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  updateDoc,
  getDoc,
  getDocs,
  addDoc,
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Membership, User } from '@/types';

export const UserService = {
  /**
   * Suscribe a las membresías de un tenant activo.
   */
  subscribeToTenantMemberships: (tenantId: string, callback: (memberships: Membership[]) => void) => {
    const q = query(
      collection(db, 'memberships'),
      where('tenantId', '==', tenantId)
    );

    return onSnapshot(q, (snapshot) => {
      const memberships = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      })) as Membership[];
      callback(memberships);
    });
  },

  /**
   * Obtiene el perfil de un usuario por UID.
   */
  getUserProfile: async (uid: string): Promise<User | null> => {
    if (!uid) return null;
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? (snap.data() as User) : null;
  },

  /**
   * Invita a un nuevo usuario al tenant.
   */
  inviteUser: async (tenantId: string, email: string, name: string, role: string, invitedBy: string) => {
    // Verificar si ya está invitado
    const q = query(
      collection(db, 'memberships'),
      where('tenantId', '==', tenantId),
      where('email', '==', email)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      throw new Error('Este usuario ya tiene una invitación o acceso en este tenant.');
    }

    await addDoc(collection(db, 'memberships'), {
      tenantId,
      email,
      name,
      role,
      status: 'pending',
      userId: null,
      invitedBy,
      invitedAt: serverTimestamp()
    });
  },

  /**
   * Prepara un usuario (nombre/email/rol) SIN invitarlo todavía — status
   * 'draft', sin invitedAt. No habilita registro ni acceso (ver
   * AuthService.register y acceptTenantInvite, que excluyen 'draft').
   */
  createDraftMember: async (tenantId: string, email: string, name: string, role: string, createdBy: string) => {
    const q = query(
      collection(db, 'memberships'),
      where('tenantId', '==', tenantId),
      where('email', '==', email)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      throw new Error('Este usuario ya tiene una invitación o acceso en este tenant.');
    }

    await addDoc(collection(db, 'memberships'), {
      tenantId,
      email,
      name,
      role,
      status: 'draft',
      userId: null,
      invitedBy: createdBy,
    });
  },

  /**
   * Convierte un 'draft' preparado en una invitación real: pasa a 'pending'
   * y recién ahí escribe invitedAt — a partir de este momento el email
   * puede registrarse (ver AuthService.register).
   */
  sendInvitation: async (membershipId: string) => {
    const docRef = doc(db, 'memberships', membershipId);
    await updateDoc(docRef, {
      status: 'pending',
      invitedAt: serverTimestamp(),
    });
  },

  /**
   * Carga un usuario del que todavía no se tiene el correo — solo nombre y
   * rol, status 'prepared', email:null. No hay nada que verificar por
   * duplicado acá (sin email no hay forma de chocar con otro registro) y
   * NO se escribe invitedAt: no es una invitación, es un registro preliminar
   * que no habilita ni registro ni login (AuthService.register y
   * acceptTenantInvite lo excluyen explícitamente).
   */
  createPreparedMember: async (tenantId: string, name: string, role: string, createdBy: string) => {
    await addDoc(collection(db, 'memberships'), {
      tenantId,
      name,
      role,
      status: 'prepared',
      email: null,
      userId: null,
      invitedBy: createdBy,
    });
  },

  /**
   * Convierte un 'prepared' en 'draft' cuando el admin por fin tiene el
   * correo real — valida formato y duplicados (mismo tenant) antes de
   * escribirlo. A partir de acá sigue el flujo normal draft → pending
   * (sendInvitation) → active (acceptTenantInvite).
   */
  convertPreparedToDraft: async (membershipId: string, tenantId: string, email: string) => {
    const trimmedEmail = email.trim();
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      throw new Error('El correo no tiene un formato válido.');
    }

    const q = query(
      collection(db, 'memberships'),
      where('tenantId', '==', tenantId),
      where('email', '==', trimmedEmail)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      throw new Error('Este correo ya tiene una invitación o acceso en este tenant.');
    }

    const docRef = doc(db, 'memberships', membershipId);
    await updateDoc(docRef, {
      email: trimmedEmail,
      status: 'draft',
    });
  },

  /**
   * Actualiza el rol de una membresía.
   */
  updateMembershipRole: async (membershipId: string, role: string) => {
    const docRef = doc(db, 'memberships', membershipId);
    await updateDoc(docRef, { role });
  },

  /**
   * Actualiza el estado de una membresía (Activo / Suspendido).
   */
  updateMembershipStatus: async (membershipId: string, isActive: boolean) => {
    const docRef = doc(db, 'memberships', membershipId);
    await updateDoc(docRef, { 
       status: isActive ? 'active' : 'suspended' 
    });
  }
};
