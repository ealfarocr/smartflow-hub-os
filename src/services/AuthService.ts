import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signOut, 
  GoogleAuthProvider, 
  signInWithPopup 
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  query, 
  where, 
  getDocs 
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { User, Membership } from '@/types';

export const AuthService = {
  async login(email: string, pass: string) {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    await this.linkPendingMembership();
    return cred.user;
  },

  async register(email: string, pass: string, name: string) {
    // Verificar si el email está invitado
    const memberships = await this.getMembershipsByEmail(email);
    if (memberships.length === 0) {
      throw new Error('Este correo no tiene acceso asignado. Solicita invitación al administrador.');
    }

    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    
    // Crear perfil básico
    await setDoc(doc(db, 'users', cred.user.uid), {
      id: cred.user.uid,
      name,
      email,
      isActive: true,
      createdAt: new Date().toISOString()
    });

    await this.linkPendingMembership();
    return cred.user;
  },

  async loginWithGoogle() {
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    
    // Verificar si existe perfil, si no crearlo
    const profile = await this.getUserProfile(cred.user.uid);
    if (!profile) {
      await setDoc(doc(db, 'users', cred.user.uid), {
        id: cred.user.uid,
        name: cred.user.displayName || 'Usuario Google',
        email: cred.user.email!,
        isActive: true,
        createdAt: new Date().toISOString()
      });
    }

    await this.linkPendingMembership();
    
    // El authStore se encargará de redirigir a AccessPendingView si no hay membresías.
    // No cerramos sesión forzada aquí para permitir que el usuario vea el mensaje de espera.
    return cred.user;
  },
  
  async logout() {
    await signOut(auth);
  },

  async getUserProfile(uid: string): Promise<User | null> {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    
    const data = snap.data() as User;
    
    // Forzar Super Admin para el correo maestro (Admin Master)
    if (data.email === 'publicidadynegociosenlinea@gmail.com') {
      return { ...data, isSuperAdmin: true };
    }
    
    return data;
  },
  
  async getMembership(uid: string, tenantId: string): Promise<Membership | null> {
    const snap = await getDoc(doc(db, 'memberships', `${uid}_${tenantId}`));
    if (snap.exists()) return snap.data() as Membership;

    // Buscar por email si no existe por ID (fallback para primer acceso)
    const profile = await this.getUserProfile(uid);
    if (profile) {
      const q = query(collection(db, 'memberships'), where('email', '==', profile.email), where('tenantId', '==', tenantId));
      const s = await getDocs(q);
      if (!s.empty) return s.docs[0].data() as Membership;
    }
    return null;
  },

  async getMembershipsByEmail(email: string): Promise<Membership[]> {
    const q = query(collection(db, 'memberships'), where('email', '==', email));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as Membership);
  },

  async linkPendingMembership() {
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('@/lib/firebase');
      
      const acceptInvite = httpsCallable<any, any>(functions, 'acceptTenantInvite');
      await acceptInvite({});
      // Vínculo realizado en segundo plano
    } catch (error) {
      console.error('[AuthService] Error crítico llamando a acceptTenantInvite:', error);
      // No lanzamos error para permitir que el login proceda, 
      // pero el usuario verá AccessPendingView si no se vinculó nada.
    }
  },

  async getUserMemberships(uid: string): Promise<Membership[]> {
    const q = query(collection(db, 'memberships'), where('userId', '==', uid));
    const querySnapshot = await getDocs(q);
    
    const memberships = querySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as Membership);

    // Enriquecer con nombres de empresas para evitar IDs crudos en la UI
    const enriched = await Promise.all(memberships.map(async (m) => {
      try {
        const tDoc = await getDoc(doc(db, 'tenants', m.tenantId));
        if (tDoc.exists()) {
          const tData = tDoc.data();
          return { ...m, tenantName: tData.name || tData.n || tData.tradeName || 'Negocio' };
        }
      } catch (e) {
        console.warn(`No se pudo obtener el nombre para el tenant ${m.tenantId}`, e);
      }
      return m;
    }));

    return enriched;
  },

  async getTenantMemberships(tenantId: string): Promise<Membership[]> {
    const q = query(collection(db, 'memberships'), where('tenantId', '==', tenantId), where('status', '==', 'active'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as Membership);
  }
};
