import { 
  doc, 
  setDoc, 
  onSnapshot, 
  serverTimestamp 
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { WhatsappTemplate, TenantFeatures, AIAgentConfig, MultiAgentConfig, MediaLibraryItem } from '@/types';

// ─── Pipeline Stage ───────────────────────────────────────
export interface PipelineStage {
  id: string;
  label: string;
  order: number;
  color: string;
  isDefault: boolean;
  isClosed: boolean;
}

export interface OnboardingState {
  registeredAt?: any;
  dismissedNotificationIds: string[];
  lastNotificationDate?: any;
}

// ─── Tenant Settings ──────────────────────────────────────
export interface TenantSettings {
  tenantId?: string;
  paypalEmail?: string; // Movido a la raíz para facilitar guardado directo
  sinpePhone?: string;
  sinpeOwner?: string;
  sinpeId?: string;
  bankAccounts?: string;
  company: {
    legalName: string;
    tradeName: string;
    taxId: string;
    phone: string;
    email: string;
    physicalAddress: string;
    website: string;
  };
  branding: {
    logoUrl: string;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    quoteHeaderStyle: 'classic' | 'modern' | 'minimal';
  };
  commercial: {
    quoteValidityDays: number;
    maxDiscountPercent: number;
    taxRatePercent: number;
    currency: string;
    defaultPaymentTerms: string;
  };
  templates: {
    welcomeMessage: string;
    quoteMessage: string;
    meetingReminder: string;
    followUpMessage: string;
  };
  pipeline: {
    stages: PipelineStage[];
  };
  whatsappTemplates: WhatsappTemplate[];
  features?: Partial<TenantFeatures>;
  aiAgentConfig?: AIAgentConfig;
  multiAgentConfig?: MultiAgentConfig;
  onboarding?: OnboardingState;
  tasks?: {
    sections: string[];
  };
  updatedAt?: any;
  updatedBy?: string;
}

// ─── Migración: mapea campos antiguos → nuevos ───────────
function migrateSettings(raw: Record<string, any>): TenantSettings {
  // Root fields
  const paypalEmail = raw.paypalEmail || raw.company?.paypalEmail || '';
  const sinpePhone = raw.sinpePhone || '';
  const sinpeOwner = raw.sinpeOwner || '';
  const sinpeId = raw.sinpeId || '';
  const bankAccounts = raw.bankAccounts || '';

  // company
  const oldCompany = raw.company || {};
  const company = {
    legalName: oldCompany.legalName || '',
    tradeName: oldCompany.tradeName || '',
    taxId: oldCompany.taxId || '',
    phone: oldCompany.phone || '',
    email: oldCompany.email || '',
    physicalAddress: oldCompany.physicalAddress || oldCompany.address || '',
    website: oldCompany.website || '',
  };

  // branding
  const oldBranding = raw.branding || {};
  const branding = {
    logoUrl: oldBranding.logoUrl || '',
    primaryColor: oldBranding.primaryColor || '#2563eb',
    secondaryColor: oldBranding.secondaryColor || '#0f172a',
    accentColor: oldBranding.accentColor || '#f59e0b',
    quoteHeaderStyle: oldBranding.quoteHeaderStyle || 'modern',
  };

  // commercial  
  const oldCommercial = raw.commercial || {};
  const commercial = {
    quoteValidityDays: oldCommercial.quoteValidityDays ?? oldCommercial.defaultValidDays ?? 15,
    maxDiscountPercent: oldCommercial.maxDiscountPercent ?? oldCommercial.defaultDiscountMax ?? 10,
    taxRatePercent: oldCommercial.taxRatePercent ?? oldCommercial.taxRate ?? 16,
    currency: oldCommercial.currency === 'MXN' ? 'MX' : (oldCommercial.currency || 'MX'),
    defaultPaymentTerms: oldCommercial.defaultPaymentTerms || '',
  };

  // templates (antes "messages")
  const oldTemplates = raw.templates || raw.messages || {};
  const templates = {
    welcomeMessage: oldTemplates.welcomeMessage || 'Hola {{leadName}}, gracias por contactar a {{companyName}}. Con gusto podemos brindarte información sobre nuestros servicios. ¿Cómo podemos ayudarte hoy?',
    quoteMessage: oldTemplates.quoteMessage || 'Hola {{leadName}}, te compartimos tu cotización {{quoteNumber}}. El ahorro estimado es de {{savings}} MXN. Puedes revisar la propuesta y decirnos si deseas agendar una visita técnica.',
    meetingReminder: oldTemplates.meetingReminder || 'Hola {{leadName}}, te recordamos nuestra reunión o visita técnica programada. Si necesitas ajustar el horario, puedes responder este mensaje.',
    followUpMessage: oldTemplates.followUpMessage || 'Hola {{leadName}}, ¿pudiste revisar la propuesta que te enviamos? Quedo al pendiente para resolver tus dudas o ayudarte con el siguiente paso.',
  };

  // pipeline
  const oldPipeline = raw.pipeline || {};
  const stages: PipelineStage[] = oldPipeline.stages && oldPipeline.stages.length > 0
    ? oldPipeline.stages
    : [
        { id: 'nuevo', label: 'Nuevo', order: 0, color: '#3b82f6', isDefault: true, isClosed: false },
        { id: 'seguimiento', label: 'Seguimiento', order: 1, color: '#f59e0b', isDefault: false, isClosed: false },
        { id: 'visita-tecnica', label: 'Visita Técnica', order: 2, color: '#8b5cf6', isDefault: false, isClosed: false },
        { id: 'venta-realizada', label: 'Venta Realizada', order: 3, color: '#10b981', isDefault: false, isClosed: true },
        { id: 'perdido', label: 'Perdido', order: 4, color: '#ef4444', isDefault: false, isClosed: true },
      ];

  // whatsappTemplates
  const defaultWaTemplates: WhatsappTemplate[] = [
    {
      id: 'tpl-1',
      name: 'Seguimiento de cotización solar',
      metaTemplateName: 'seguimiento_cotizacion_solar',
      category: 'UTILITY',
      languageCode: 'es_MX',
      bodyPreview: 'Hola {{1}}, te contactamos de {{2}} para dar seguimiento a tu solicitud {{3}}. ¿Tienes alguna duda sobre la propuesta o te gustaría que revisemos juntos el siguiente paso?',
      variables: ['Nombre del cliente', 'Empresa', 'Número de cotización'],
      isActive: true,
    },
    {
      id: 'tpl-2',
      name: 'Reactivación de conversación solar',
      metaTemplateName: 'reactivacion_conversacion_solar',
      category: 'UTILITY',
      languageCode: 'es_MX',
      bodyPreview: 'Hola {{1}}, anteriormente nos contactaste en {{2}} para recibir información. Si aún deseas continuar, podemos ayudarte a retomar tu solicitud.',
      variables: ['Nombre del cliente', 'Empresa'],
      isActive: true,
    },
    {
      id: 'tpl-3',
      name: 'Confirmación de visita técnica',
      metaTemplateName: 'confirmacion_visita_tecnica_solar',
      category: 'UTILITY',
      languageCode: 'es_MX',
      bodyPreview: 'Hola {{1}}, confirmamos tu visita técnica con {{2}} para el día {{3}} a las {{4}}. Si necesitas ajustar el horario, puedes responder este mensaje.',
      variables: ['Nombre del cliente', 'Empresa', 'Fecha', 'Hora'],
      isActive: true,
    },
    {
      id: 'tpl-4',
      name: 'Recordatorio de visita técnica',
      metaTemplateName: 'recordatorio_visita_tecnica_solar',
      category: 'UTILITY',
      languageCode: 'es_MX',
      bodyPreview: 'Hola {{1}}, te recordamos tu visita técnica programada con {{2}} para mañana {{3}} a las {{4}}. Nuestro equipo se comunicará contigo si requiere alguna indicación adicional.',
      variables: ['Nombre del cliente', 'Empresa', 'Fecha', 'Hora'],
      isActive: true,
    },
    {
      id: 'tpl-5',
      name: 'Envío de cotización solar',
      metaTemplateName: 'envio_cotizacion_solar',
      category: 'UTILITY',
      languageCode: 'es_MX',
      bodyPreview: 'Hola {{1}}, te compartimos la cotización {{2}} preparada por {{3}}. En ella encontrarás la propuesta del sistema solar y el ahorro estimado para tu revisión.',
      variables: ['Nombre del cliente', 'Número de cotización', 'Empresa'],
      isActive: true,
    },
    {
      id: 'tpl-6',
      name: 'Solicitud de recibo eléctrico',
      metaTemplateName: 'solicitud_recibo_electrico',
      category: 'UTILITY',
      languageCode: 'es_MX',
      bodyPreview: 'Hola {{1}}, para preparar una propuesta más precisa con {{2}}, necesitamos que nos compartas más información. Puedes responder este mensaje adjuntando una imagen o PDF.',
      variables: ['Nombre del cliente', 'Empresa'],
      isActive: true,
    },
    {
      id: 'tpl-7',
      name: 'Seguimiento post visita técnica',
      metaTemplateName: 'seguimiento_post_visita_solar',
      category: 'UTILITY',
      languageCode: 'es_MX',
      bodyPreview: 'Hola {{1}}, gracias por recibir al equipo de {{2}} para la visita técnica. Estamos revisando la información levantada y te compartiremos la propuesta actualizada.',
      variables: ['Nombre del cliente', 'Empresa'],
      isActive: true,
    },
    {
      id: 'tpl-8',
      name: 'Propuesta pendiente de revisión',
      metaTemplateName: 'propuesta_pendiente_revision_solar',
      category: 'UTILITY',
      languageCode: 'es_MX',
      bodyPreview: 'Hola {{1}}, te escribimos de {{2}} para confirmar si pudiste revisar nuestra propuesta {{3}}. Si tienes dudas, podemos ayudarte a revisarla.',
      variables: ['Nombre del cliente', 'Empresa', 'Número de cotización'],
      isActive: true,
    },
    {
      id: 'tpl-9',
      name: 'Agendar llamada de seguimiento',
      metaTemplateName: 'agendar_llamada_seguimiento_solar',
      category: 'UTILITY',
      languageCode: 'es_MX',
      bodyPreview: 'Hola {{1}}, podemos agendar una llamada breve con {{2}} para revisar tu propuesta y resolver tus dudas. Indícanos qué horario te funciona mejor.',
      variables: ['Nombre del cliente', 'Empresa'],
      isActive: true,
    },
    {
      id: 'tpl-10',
      name: 'Actualización de propuesta solar',
      metaTemplateName: 'actualizacion_propuesta_solar',
      category: 'UTILITY',
      languageCode: 'es_MX',
      bodyPreview: 'Hola {{1}}, actualizamos tu propuesta {{2}} con la información más reciente. Puedes revisarla y respondernos si deseas que ajustemos algún detalle.',
      variables: ['Nombre del cliente', 'Número de cotización'],
      isActive: true,
    },
    {
      id: 'tpl-11',
      name: 'Beneficios de energía solar',
      metaTemplateName: 'beneficios_energia_solar',
      category: 'MARKETING',
      languageCode: 'es_MX',
      bodyPreview: 'Hola {{1}}, en {{2}} podemos ayudarte con nuestros servicios. Si te interesa, podemos revisar tu caso y orientarte con una propuesta.',
      variables: ['Nombre del cliente', 'Empresa'],
      isActive: true,
    },
    {
      id: 'tpl-12',
      name: 'Campaña ahorro solar',
      metaTemplateName: 'campana_ahorro_solar',
      category: 'MARKETING',
      languageCode: 'es_MX',
      bodyPreview: 'Hola {{1}}, en {{2}} estamos apoyando a hogares y negocios a evaluar alternativas de energía solar. Si deseas conocer una propuesta para tu consumo, podemos ayudarte.',
      variables: ['Nombre del cliente', 'Empresa'],
      isActive: true,
    },
  ];

  const whatsappTemplates: WhatsappTemplate[] =
    Array.isArray(raw.whatsappTemplates) && raw.whatsappTemplates.length > 0
      ? raw.whatsappTemplates
      : defaultWaTemplates;

  const features: Partial<TenantFeatures> = raw.features || {};

  const aiAgentConfig: AIAgentConfig = raw.aiAgentConfig || {
    apiKey: '',
    knowledgeFiles: [],
    productFiles: [],
    mediaLibrary: [],
  };
  if (!aiAgentConfig.mediaLibrary) aiAgentConfig.mediaLibrary = [];

  const multiAgentConfig: MultiAgentConfig = raw.multiAgentConfig || {
    isAutoDistributionEnabled: false,
    includedUserIds: [],
  };

  return {
    paypalEmail,
    sinpePhone,
    sinpeOwner,
    sinpeId,
    bankAccounts,
    company,
    branding,
    commercial,
    templates,
    pipeline: { stages },
    whatsappTemplates,
    features,
    aiAgentConfig,
    multiAgentConfig,
    onboarding: raw.onboarding || { dismissedNotificationIds: [] },
    tasks: raw.tasks || { sections: [] },
  };
}

// ─── Service ──────────────────────────────────────────────
export const SettingsService = {
  /**
   * Suscribe a los cambios de configuración de un tenant.
   * Aplica migración automática de campos antiguos.
   */
  subscribeToSettings: (tenantId: string, callback: (settings: TenantSettings | null) => void) => {
    const docRef = doc(db, 'settings', tenantId);
    
    return onSnapshot(docRef, (snapshot) => {
      if (snapshot.exists()) {
        callback(migrateSettings(snapshot.data()));
      } else {
        callback(null);
      }
    });
  },

  /**
   * Guarda o actualiza la configuración completa.
   */
  saveSettings: async (tenantId: string, settings: Partial<TenantSettings>, userId?: string) => {
    const docRef = doc(db, 'settings', tenantId);
    await setDoc(docRef, {
      ...settings,
      tenantId,
      updatedAt: serverTimestamp(),
      updatedBy: userId || null,
    }, { merge: true });
  },

  /**
   * Sube un logo a Firebase Storage y retorna la URL de descarga.
   */
  uploadLogo: async (tenantId: string, file: File): Promise<string> => {
    const ext = file.name.split('.').pop() || 'png';
    const storageRef = ref(storage, `logos/${tenantId}/logo.${ext}`);
    await uploadBytes(storageRef, file, { contentType: file.type });
    return getDownloadURL(storageRef);
  },

  /**
   * Sube un archivo a la biblioteca de medios del agente IA.
   */
  uploadMedia: async (tenantId: string, file: File): Promise<string> => {
    const ext = file.name.split('.').pop() || 'bin';
    const storageRef = ref(storage, `media-library/${tenantId}/${Date.now()}.${ext}`);
    await uploadBytes(storageRef, file, { contentType: file.type });
    return getDownloadURL(storageRef);
  },

  /**
   * Sube un documento de entrenamiento (PDF/TXT) al storage del agente IA.
   */
  uploadKnowledgeFile: async (tenantId: string, file: File): Promise<string> => {
    const safeName = `${Date.now()}-${file.name.replace(/\s+/g, '_')}`;
    const storageRef = ref(storage, `tenants/${tenantId}/ai-agent/knowledge/${safeName}`);
    await uploadBytes(storageRef, file, { contentType: file.type });
    return getDownloadURL(storageRef);
  },
};
