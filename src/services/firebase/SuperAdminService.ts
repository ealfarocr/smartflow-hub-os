import {
  collection,
  doc,
  getDoc,
  setDoc,
  getDocs,
  updateDoc,
  serverTimestamp,
  query,
  orderBy,
  where,
  limit,
  deleteDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { TenantRecord, TenantFeatures, TenantPlan, ToolLibraryRecord } from '@/types';

export interface WhatsappNumberInfo {
  displayPhoneNumber: string | null;
  phoneNumberId: string | null;
  isActive: boolean;
  verifiedName: string | null;
  error?: string;
}

export interface CreateTenantInput {
  name: string;
  ownerEmail: string;
  plan: TenantPlan;
  industry: string;
  features: TenantFeatures;
  createdBy: string; // UID del SA
}

// ─── Valores por defecto para settings de un nuevo tenant ─
const buildDefaultSettings = (tenantId: string, name: string, features: TenantFeatures) => ({
  tenantId,
  company: {
    legalName: name,
    tradeName: name,
    taxId: '',
    phone: '',
    email: '',
    physicalAddress: '',
    website: '',
  },
  branding: {
    logoUrl: '',
    primaryColor: '#2563eb',
    secondaryColor: '#0f172a',
    accentColor: '#f59e0b',
    quoteHeaderStyle: 'modern',
  },
  commercial: {
    quoteValidityDays: 15,
    maxDiscountPercent: 10,
    taxRatePercent: 16,
    currency: 'MX',
    defaultPaymentTerms: '',
  },
  templates: {
    welcomeMessage: `Hola {{leadName}}, gracias por contactar a ${name}. ¿Cómo podemos ayudarte hoy?`,
    quoteMessage: 'Hola {{leadName}}, te compartimos tu cotización {{quoteNumber}}.',
    meetingReminder: 'Hola {{leadName}}, te recordamos nuestra reunión programada.',
    followUpMessage: 'Hola {{leadName}}, ¿pudiste revisar la propuesta que te enviamos?',
  },
  pipeline: {
    stages: [
      { id: 'nuevo', label: 'Nuevo', order: 0, color: '#3b82f6', isDefault: true, isClosed: false },
      { id: 'seguimiento', label: 'Seguimiento', order: 1, color: '#f59e0b', isDefault: false, isClosed: false },
      { id: 'visita-tecnica', label: 'Visita Técnica', order: 2, color: '#8b5cf6', isDefault: false, isClosed: false },
      { id: 'venta-realizada', label: 'Venta Realizada', order: 3, color: '#10b981', isDefault: false, isClosed: true },
      { id: 'perdido', label: 'Perdido', order: 4, color: '#ef4444', isDefault: false, isClosed: true },
    ],
  },
  whatsappTemplates: [],
  features,
  updatedAt: serverTimestamp(),
});

export const SuperAdminService = {
  /**
   * Lista todos los tenants de la plataforma (solo SA)
   */
  listAllTenants: async (): Promise<TenantRecord[]> => {
    try {
      const q = collection(db, 'tenants');
      const snap = await getDocs(q);
      return snap.docs.map(d => {
        const data = d.data();
        return { 
          id: d.id, 
          name: data.name || data.n || 'Sin nombre',
          tradeName: data.tradeName || '',
          ownerEmail: data.ownerEmail || '',
          plan: data.plan || 'starter',
          status: data.status || (data.active === true ? 'active' : 'pending'),
          features: data.features || { hasCrm: true, hasQuotes: true, hasPackages: true, hasAgenda: true, hasIntegrations: true, hasTasks: true },
          industry: data.industry || 'Solar',
          createdAt: data.createdAt || new Date().toISOString(),
          createdBy: data.createdBy || 'system',
        } as TenantRecord;
      });
    } catch (error) {
      console.error("Error en SuperAdminService.listAllTenants:", error);
      throw error;
    }
  },

  /**
   * Devuelve el número de WhatsApp activo en la API por cada negocio.
   * Consulta a Meta vía Cloud Function (el token nunca llega al cliente) y
   * cachea el número legible en la integración.
   * Mapa: tenantId → WhatsappNumberInfo
   */
  getWhatsAppNumbers: async (): Promise<Record<string, WhatsappNumberInfo>> => {
    try {
      const fn = httpsCallable<unknown, { numbers: Record<string, WhatsappNumberInfo> }>(
        functions,
        'getWhatsappNumbers'
      );
      const res = await fn({});
      return res.data?.numbers || {};
    } catch (error) {
      console.error("Error en SuperAdminService.getWhatsAppNumbers:", error);
      return {};
    }
  },

  /**
   * Verifica si un nombre de negocio ya está registrado
   */
  isTenantNameAvailable: async (name: string): Promise<boolean> => {
    try {
      // Verificar por tradeName (que se usa como tenantId) — no por name (display)
      const q = query(
        collection(db, 'tenants'),
        where('tradeName', '==', name.trim()),
        limit(1)
      );
      const snap = await getDocs(q);
      return snap.empty;
    } catch {
      // Sin auth en checkout las reglas bloquean la query de colección —
      // intentar lectura directa por ID (el tenantId ES el tradeName slugificado)
      try {
        const snap = await getDoc(doc(db, 'tenants', name.trim()));
        return !snap.exists();
      } catch {
        return true;
      }
    }
  },

  /**
   * Crea un nuevo tenant con su settings inicial y membresía Owner pendiente.
   * Si sourceTenantId está presente, clona la configuración (pipeline, etc) de ese tenant.
   */
  createTenant: async (input: CreateTenantInput, sourceTenantId?: string): Promise<string> => {
    const tenantId = `t-${Date.now()}`;
    const now = new Date().toISOString();

    // 1. Obtener todas las herramientas gratuitas de la librería para activarlas por defecto
    const allTools = await SuperAdminService.listAvailableTools();
    const freeFeatures: Partial<TenantFeatures> = {};
    allTools.forEach(tool => {
      if (tool.isFree || tool.price === 0) {
        (freeFeatures as any)[tool.key] = true;
      }
    });

    // Doc del tenant
    await setDoc(doc(db, 'tenants', tenantId), {
      id: tenantId,
      name: input.name,
      ownerEmail: input.ownerEmail,
      plan: input.plan,
      status: 'pending',
      features: { ...freeFeatures, ...input.features },
      industry: input.industry,
      createdAt: now,
      createdBy: input.createdBy,
    });

    // 2. Settings (Clonados o por Defecto)
    let finalSettings = buildDefaultSettings(tenantId, input.name, input.features);
    
    const hubId = sourceTenantId || await SuperAdminService.getHubTenantId();
    
    if (hubId) {
      try {
        const sourceSnap = await getDoc(doc(db, 'settings', hubId));
        if (sourceSnap.exists()) {
          const sourceData = sourceSnap.data();
          finalSettings = {
            ...finalSettings,
            pipeline: sourceData.pipeline || finalSettings.pipeline,
            whatsappTemplates: sourceData.whatsappTemplates || finalSettings.whatsappTemplates,
            commercial: sourceData.commercial || finalSettings.commercial,
            templates: sourceData.templates || finalSettings.templates,
            // Las features se respetan las que vienen del input del SA
          };
        }
      } catch (e) {
        console.error("Error al clonar settings:", e);
      }
    }

    await setDoc(doc(db, 'settings', tenantId), finalSettings);

    // 3. Membresía Owner pendiente (se vincula al UID cuando el Owner hace login)
    const membershipId = `pending_${input.ownerEmail.replace(/[@.]/g, '_')}_${tenantId}`;
    await setDoc(doc(db, 'memberships', membershipId), {
      userId: null,
      email: input.ownerEmail,
      tenantId,
      role: 'Owner',
      status: 'pending',
      invitedBy: input.createdBy,
      invitedAt: serverTimestamp(),
    });

    return tenantId;
  },

  /**
   * Actualiza las features (herramientas) de un tenant existente.
   */
  updateTenantFeatures: async (tenantId: string, features: TenantFeatures): Promise<void> => {
    await updateDoc(doc(db, 'tenants', tenantId), { features });
    // También actualizar en settings para que el FeatureGuard lo tome
    await updateDoc(doc(db, 'settings', tenantId), { features });
  },

  /**
   * Cambia el status del tenant (active / suspended / pending).
   */
  setTenantStatus: async (tenantId: string, status: 'active' | 'suspended' | 'pending'): Promise<void> => {
    await updateDoc(doc(db, 'tenants', tenantId), { status });
  },

  /**
   * Hub de Herramientas: Lista herramientas maestras
   */
  listAvailableTools: async (): Promise<ToolLibraryRecord[]> => {
    const q = query(collection(db, 'available_tools'), orderBy('order', 'asc'));
    const snap = await getDocs(q);
    
    if (snap.empty) {
      // Retornar defaults si no hay nada en DB
      return [
        { id: 't1', key: 'hasCrm', label: 'CRM Base Gratis', desc: 'Dashboard básico, embudo por columnas, tareas, contactos y moneda. Incluido siempre.', iconName: 'Users', color: '#10B981', isActive: true, order: 0, price: 0, isFree: true },
        { id: 't1_tasks', key: 'hasTasks', label: 'Gestor de Listas', desc: 'Organiza tareas y pendientes de tu negocio de forma ágil.', iconName: 'LayoutList', color: '#1877F2', isActive: true, order: 0.5, price: 0, isFree: true },
        { id: 't2', key: 'hasMultiAgent', label: 'WhatsApp Coexistente', desc: 'CRM profesional multi-agente con conexión oficial de WhatsApp API y 300 créditos de reactivación.', iconName: 'Headset', color: '#25D366', isActive: true, order: 1, price: 69, isFree: false },
        { id: 't3', key: 'hasAiAgent', label: 'Agente IA', desc: 'IA que responde, califica y agenda citas automáticamente en el chat.', iconName: 'Bot', color: '#0EA5E9', isActive: true, order: 2, price: 49, isFree: false },
        { id: 't4', key: 'hasQualityAuditor', label: 'Auditor IA', desc: 'Audita chats, evalúa asesores y detecta cierres perdidos con IA.', iconName: 'ShieldCheck', color: '#EC4899', isActive: true, order: 3, price: 25, isFree: false },
        { id: 't5', key: 'hasPaymentLinks', label: 'Links de pago', desc: 'Genera enlaces de pago y cobro seguro por WhatsApp con tarjeta o PayPal.', iconName: 'CreditCard', color: '#F97316', isActive: true, order: 4, price: 12, isFree: false },
        { id: 't6', key: 'hasQuotes', label: 'Cotizaciones', desc: 'Genera cotizaciones y propuestas PDF profesionales en segundos.', iconName: 'FileText', color: '#4F46E5', isActive: true, order: 5, price: 15, isFree: false },
        { id: 't7_catalog', key: 'hasCatalog', label: 'Catálogo', desc: 'Organiza productos, servicios y precios para tus cotizaciones.', iconName: 'FolderClosed', color: '#7C3AED', isActive: true, order: 5.5, price: 27, isFree: false },
        { id: 't8', key: 'hasPackages', label: 'Paquetes comerciales', desc: 'Agrupa ofertas o servicios para cargarlos en bloque al cotizar. Incluido gratis con tu CRM.', iconName: 'Package', color: '#F59E0B', isActive: true, order: 6, price: 0, isFree: true },
        { id: 't9', key: 'hasAgenda', label: 'Agenda inteligente', desc: 'Calendario para agendar citas con recordatorios y confirmación automática.', iconName: 'Calendar', color: '#10B981', isActive: true, order: 7, price: 20, isFree: false },
      ];
    }

    return snap.docs.map(d => ({ id: d.id, ...d.data() } as ToolLibraryRecord));
  },

  /**
   * Crea o actualiza una herramienta en la librería global
   */
  upsertTool: async (tool: Partial<ToolLibraryRecord>): Promise<void> => {
    // Usar la key como ID para evitar duplicados en la librería maestra
    const id = tool.id || tool.key || `tool-${Date.now()}`;
    await setDoc(doc(db, 'available_tools', id), { ...tool, id }, { merge: true });
  },

  /**
   * Elimina una herramienta de la librería
   */
  deleteTool: async (toolId: string): Promise<void> => {
    await deleteDoc(doc(db, 'available_tools', toolId));
  },

  /**
   * Limpia herramientas duplicadas basadas en su key
   */
  cleanupDuplicates: async (): Promise<void> => {
    const q = collection(db, 'available_tools');
    const snap = await getDocs(q);
    const tools = snap.docs.map(d => ({ id: d.id, ...d.data() } as ToolLibraryRecord));
    
    const seenKeys = new Set<string>();
    const toDelete: string[] = [];

    // Ordenar para mantener los que tienen ID igual a la KEY si existen, o los más recientes
    const sortedTools = [...tools].sort((a, b) => {
      if (a.id === a.key) return -1;
      if (b.id === b.key) return 1;
      return 0;
    });

    for (const tool of sortedTools) {
      if (seenKeys.has(tool.key)) {
        toDelete.push(tool.id);
      } else {
        seenKeys.add(tool.key);
      }
    }

    const deletePromises = toDelete.map(id => deleteDoc(doc(db, 'available_tools', id)));
    await Promise.all(deletePromises);
  },

  /**
   * Obtiene el ID del Hub Maestro dinámicamente
   */
  getHubTenantId: async (): Promise<string> => {
    const q = collection(db, 'tenants');
    const snap = await getDocs(q);
    const hub = snap.docs.find(d => {
      const data = d.data();
      const emailMatch = data.ownerEmail === 'publicidadynegociosenlinea@gmail.com';
      const nameMatch = data.name?.toUpperCase().includes('HUB MAESTRO') || data.name?.toUpperCase().includes('ADMIN MASTER');
      return emailMatch || nameMatch || d.id === 'hub-maestro';
    });
    return hub?.id || 'hub-maestro';
  },

  /**
   * Sincroniza la configuración de un negocio desde el 'Hub Maestro'
   */
  syncTenantFromMachote: async (targetTenantId: string): Promise<void> => {
    const hubId = await SuperAdminService.getHubTenantId();
    const hubSnap = await getDoc(doc(db, 'settings', hubId));
    
    if (!hubSnap.exists()) {
      throw new Error(`El Hub Maestro (${hubId}) no tiene configuración. Configúralo primero.`);
    }

    const hubData = hubSnap.data();
    
    const syncData = {
      pipeline: hubData.pipeline || {},
      whatsappTemplates: hubData.whatsappTemplates || [],
      commercial: hubData.commercial || {},
      templates: hubData.templates || {},
      features: hubData.features || {},
      updatedAt: new Date().toISOString(),
      syncedAt: new Date().toISOString(),
    };

    await setDoc(doc(db, 'settings', targetTenantId), syncData, { merge: true });
  },

  /**
   * Elimina un tenant y su configuración de settings.
   * No elimina leads, conversaciones u otros datos operativos del negocio.
   */
  deleteTenant: async (tenantId: string): Promise<void> => {
    await Promise.all([
      deleteDoc(doc(db, 'tenants', tenantId)),
      deleteDoc(doc(db, 'settings', tenantId)),
    ]);
  },

  /**
   * Habilita una herramienta gratuita para todos los inquilinos existentes
   */
  enableToolGlobally: async (toolKey: string): Promise<void> => {
    const tenantsSnap = await getDocs(collection(db, 'tenants'));
    const promises = tenantsSnap.docs.map(async (tenantDoc) => {
      const features = tenantDoc.data().features || {};
      features[toolKey] = true;
      
      // Actualizar tenant
      await updateDoc(doc(db, 'tenants', tenantDoc.id), { features });
      // Actualizar settings
      await updateDoc(doc(db, 'settings', tenantDoc.id), { features });
    });
    await Promise.all(promises);
  }
};
