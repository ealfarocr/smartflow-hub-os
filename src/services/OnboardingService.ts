import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { TenantFeatures, TenantPlan } from '@/types';

export interface OnboardingData {
  businessName: string;
  tradeName: string; // El subdominio deseado
  email: string;
  password?: string;
  phone: string;
  industry: string;
  selectedFeatures: string[]; // Viene como array de llaves desde el Checkout
  whatsappConfig?: {
    businessId: string;
    accessToken: string;
  };
}

export const OnboardingService = {
  /**
   * Registra un nuevo negocio y su dueño en un solo paso
   */
  async registerNewBusiness(data: OnboardingData) {
    // 1. Crear el usuario en Auth (si viene con password)
    // Nota: Si ya está logueado con Google, este paso se manejaría diferente,
    // pero para el flujo de Checkout asumimos registro nuevo por ahora.
    let user;
    if (data.password) {
      const cred = await createUserWithEmailAndPassword(auth, data.email, data.password);
      user = cred.user;

      // Crear perfil de usuario
      await setDoc(doc(db, 'users', user.uid), {
        id: user.uid,
        name: data.businessName, // Usamos el nombre del negocio como nombre inicial o pediremos nombre de persona
        email: data.email,
        isActive: true,
        createdAt: new Date().toISOString()
      });
    } else {
      // Caso Google Login (ya autenticado)
      user = auth.currentUser;
      if (!user) throw new Error('No hay una sesión activa para completar el registro.');
    }

    // 2. Determinar el Tenant ID (usando tradeName si es posible)
    const tenantId = data.tradeName.toLowerCase().replace(/[^a-z0-9]/g, '') || `t-${Date.now()}`;
    const now = new Date().toISOString();

    // Convertir array de features a objeto TenantFeatures
    const featuresObj: TenantFeatures = {
      hasCrm: true, // Siempre incluido
      hasTasks: true, // Siempre incluido (Free Hook)
      hasMultiAgent: data.selectedFeatures.includes('hasMultiAgent'),
      hasAiAgent: data.selectedFeatures.includes('hasAiAgent'),
      hasQualityAuditor: data.selectedFeatures.includes('hasQualityAuditor'),
      hasPaymentLinks: data.selectedFeatures.includes('hasPaymentLinks'),
      hasQuotes: data.selectedFeatures.includes('hasQuotes'),
      hasCatalog: data.selectedFeatures.includes('hasCatalog'),
      hasAgenda: data.selectedFeatures.includes('hasAgenda'),
      hasPackages: true, // Gratis con CRM Base
      hasIntegrations: data.selectedFeatures.includes('hasIntegrations')
    };

    await setDoc(doc(db, 'tenants', tenantId), {
      id: tenantId,
      name: data.businessName,
      tradeName: data.tradeName,
      ownerEmail: data.email,
      plan: 'starter' as TenantPlan,
      status: 'active',
      features: featuresObj,
      industry: data.industry,
      createdAt: now,
      createdBy: user.uid,
      whatsappConfig: data.whatsappConfig || null,
    });

    // 3. Crear Membresía Owner ACTIVA directamente
    await setDoc(doc(db, 'memberships', `${user.uid}_${tenantId}`), {
      userId: user.uid,
      email: data.email,
      tenantId,
      role: 'Owner',
      status: 'active',
      joinedAt: serverTimestamp(),
    });

    // 4. Configuración inicial (Settings) clonada del Hub Maestro
    let initialSettings = {
      tenantId,
      company: {
        legalName: data.businessName,
        tradeName: data.tradeName,
        email: data.email,
        phone: data.phone,
      },
      features: featuresObj,
      onboarding: {
        registeredAt: serverTimestamp(),
        dismissedNotificationIds: [],
        lastNotificationDate: null,
      },
      updatedAt: serverTimestamp(),
    };

    // Por simplicidad en este MVP de Onboarding, los settings se crean con los defaults 
    // pero con la información del negocio actual. El usuario puede personalizarlos luego.

    await setDoc(doc(db, 'settings', tenantId), initialSettings, { merge: true });

    return { tenantId, userId: user.uid };
  }
};
