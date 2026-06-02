import { create } from 'zustand';
import { SettingsService, TenantSettings } from '@/services/firebase/SettingsService';

interface SettingsState extends TenantSettings {
  isLoading: boolean;
  
  // Actions
  subscribe: (tenantId: string) => () => void;
  updateSettings: (tenantId: string, settings: Partial<TenantSettings>, userId?: string) => Promise<void>;
}

const defaultSettings: TenantSettings = {
  company: {
    legalName: 'SmartFlow Hub OS',
    tradeName: '',
    taxId: '',
    phone: '',
    email: '',
    physicalAddress: '',
    website: '',
  },
  aiAgentConfig: {
    apiKey: '',
    knowledgeFiles: [],
    productFiles: [],
  },
  multiAgentConfig: {
    isAutoDistributionEnabled: false,
    includedUserIds: [],
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
    welcomeMessage: 'Hola {{leadName}}, gracias por contactar a {{companyName}}. Con gusto podemos brindarte información sobre nuestros servicios. ¿Cómo podemos ayudarte hoy?',
    quoteMessage: 'Hola {{leadName}}, te compartimos tu cotización {{quoteNumber}}. El ahorro estimado es de {{savings}} MXN. Puedes revisar la propuesta y decirnos si deseas agendar una visita técnica.',
    meetingReminder: 'Hola {{leadName}}, te recordamos nuestra reunión o visita técnica programada. Si necesitas ajustar el horario, puedes responder este mensaje.',
    followUpMessage: 'Hola {{leadName}}, ¿pudiste revisar la propuesta que te enviamos? Quedo al pendiente para resolver tus dudas o ayudarte con el siguiente paso.',
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
  features: {
    hasCrm: true,
    hasQuotes: false,
    hasPackages: false,
    hasAgenda: false,
    hasCatalog: false,
    hasIntegrations: false,
    hasAiAgent: false,
    hasMultiAgent: false,
    hasQualityAuditor: false,
    hasPaymentLinks: false,
  },
  onboarding: {
    dismissedNotificationIds: [],
  },
  tasks: {
    sections: [],
  },
  whatsappTemplates: [
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
  ],
};

// Listener activo — se cancela antes de crear uno nuevo para evitar race conditions
let _activeSettingsUnsub: (() => void) | null = null;

export const useSettingsStore = create<SettingsState>((set) => ({
  ...defaultSettings,
  isLoading: true,

  subscribe: (tenantId) => {
    // Cancelar listener anterior antes de suscribir al nuevo tenant
    if (_activeSettingsUnsub) {
      _activeSettingsUnsub();
      _activeSettingsUnsub = null;
    }
    set({ isLoading: true });

    const unsubscribe = SettingsService.subscribeToSettings(tenantId, (settings) => {
      if (settings) {
        set({ ...settings, isLoading: false });
      } else {
        set({ ...defaultSettings, isLoading: false });
      }
    });

    _activeSettingsUnsub = unsubscribe;
    return unsubscribe;
  },
  
  updateSettings: async (tenantId, settings, userId) => {
    await SettingsService.saveSettings(tenantId, settings, userId);
    // El onSnapshot actualizará el estado automáticamente
  }
}));
