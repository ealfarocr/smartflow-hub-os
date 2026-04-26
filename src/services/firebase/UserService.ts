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
  inviteUser: async (tenantId: string, email: string, role: string, invitedBy: string) => {
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
      role,
      status: 'pending',
      userId: null,
      invitedBy,
      invitedAt: serverTimestamp()
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
