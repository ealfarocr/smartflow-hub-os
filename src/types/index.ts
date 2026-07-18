export type Role = 'Owner' | 'Admin' | 'Asesor Comercial' | 'Técnico' | 'Solo lectura';

export interface TenantFeatures {
  hasCrm: boolean;
  hasQuotes: boolean;
  hasPackages: boolean;
  hasAgenda: boolean;
  hasIntegrations: boolean;
  hasAiAgent?: boolean;
  hasMultiAgent?: boolean;
  hasMultiAgentPanel?: boolean;
  hasQualityAuditor?: boolean;
  hasPaymentLinks?: boolean;
  hasCatalog?: boolean;
  hasTasks?: boolean;
}

export interface MediaLibraryItem {
  id: string;
  name: string;
  url: string;
  type: 'image' | 'document';
  description?: string;
}

export interface AIAgentConfig {
  apiKey: string;
  knowledgeFiles: { name: string; url: string; type: string; content?: string; size?: number }[];
  productFiles: { name: string; url: string; type: string; content?: string; size?: number }[];
  mediaLibrary?: MediaLibraryItem[];
}

export interface MultiAgentConfig {
  isAutoDistributionEnabled: boolean;
  includedUserIds: string[];
}

export type TenantPlan = 'starter' | 'pro' | 'enterprise';
export type TenantStatus = 'active' | 'suspended' | 'pending';

export interface ToolLibraryRecord {
  id: string;
  key: string; // e.g., 'hasCrm'
  label: string;
  desc: string;
  iconName: string; // lucide icon name
  color: string;
  isActive: boolean;
  order: number;
  price: number; // Precio mensual sugerido
  isFree?: boolean;
}

export interface WhatsappQuota {
  dailyTemplatesTotal: number;
  dailyTemplatesUsed: number;
  monthlyTemplatesTotal: number;
  monthlyTemplatesUsed: number;
  maxTemplateSlots: number;
  currentTemplateSlots: number;
}

export interface TenantRecord {
  id: string;
  name: string;
  tradeName: string;
  ownerEmail: string;
  plan: TenantPlan;
  status: TenantStatus;
  features: TenantFeatures;
  industry: string;
  whatsappQuota?: WhatsappQuota;
  branding?: {
    primaryColor?: string;
    secondaryColor?: string;
    logoUrl?: string;
    theme?: 'light' | 'dark' | 'system';
  };
  settings?: {
    timezone?: string;
    currency?: string;
  };
  createdAt: string;
  createdBy: string;
}

export interface Tenant {
  id: string;
  name: string;
  branding?: {
    logoUrl?: string;
    primaryColor?: string;
  };
}

export interface User {
  id: string;
  tenantId: string; // Deprecated: used for single-tenant apps. Prefer memberships.
  name: string;
  email: string;
  role: Role; // Deprecated: used for single-tenant apps. Prefer membership role.
  isActive: boolean;
  avatarUrl?: string;
  isSuperAdmin?: boolean;
}

export interface Membership {
  id: string; // Document ID
  userId: string | null; // Null if pending invite
  email: string; // Used for inviting
  name?: string; // Nombre del asesor
  tenantId: string;
  tenantName?: string; // Cache del nombre para la UI
  role: Role;
  invitedBy?: string;
  invitedAt?: any;
  status: 'pending' | 'active' | 'suspended';
}

export type CRMStage = string;

export interface Lead {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  email?: string;
  city: string;
  clientType: 'Residencial' | 'Comercial' | 'Industrial';
  keyData: string;
  advisorId: string;
  source: 'WhatsApp' | 'Facebook' | 'Instagram' | 'Messenger' | 'Organico' | 'Referido';
  stage: CRMStage;
  lastActivity: string; // ISO Date String
  createdAt: string;
  orderIndex: number; // for drag and drop
  aiScore?: number;
  aiScoreReason?: string;
  aiPropensity?: number; // 0-100 probability of closing
  aiSentiment?: 'positive' | 'neutral' | 'negative' | 'critical';
  aiNextStep?: string; // Proactive suggestion
  aiIsCold?: boolean; // True if the lead is cooling down
}

export interface QuoteItem {
  id: string;
  description: string;
  quantity: number;
  rate: number;
  taxPercent?: number;
  amount: number;
}

export type QuoteStatus = 'borrador' | 'enviada' | 'aprobada' | 'rechazada' | 'vencida';

export interface Quote {
  id: string;
  tenantId: string;
  quoteNumber: string;
  leadId: string;
  advisorId: string;
  advisorName?: string;
  advisorEmail?: string;
  date: string;
  validUntil: string;
  clientType: 'Residencial' | 'Comercial' | 'Industrial';
  
  // Technical details (optional / specific to solar panels)
  consumptionEstimadoKwh?: number;
  systemRecommended?: string;
  panelsCount?: number;
  inverter?: string;
  powerKw?: number;
  productionEstimadaKwh?: number;
  savingsEstimado?: number;
  
  // Generic Multi-Niche details
  niche?: string;
  items?: QuoteItem[];
  currency?: string;
  
  // Financial details
  subtotal: number;
  discount: number;
  taxes: number;
  total: number;
  
  remarks: string;
  status: QuoteStatus;
  
  // AI Insights
  aiPriceOptimized?: number;
  aiTone?: 'formal' | 'friendly' | 'persuasive';
  aiConfidence?: number;

  // Audit / Soft Delete
  deleted?: boolean;
  deletedAt?: any;
  deletedBy?: string;
  deletedByName?: string;
}

export interface Package {
  id: string;
  tenantId: string;
  name: string;
  clientType: 'Residencial' | 'Comercial' | 'Industrial';
  powerKw: number;
  panelsCount: number;
  inverter: string;
  savingsEstimado: number;
  price: number;
  description: string;
  isActive: boolean;
}

export type MessageSource = 'whatsapp' | 'instagram' | 'facebook';

export interface Conversation {
  id: string;
  tenantId: string;
  leadId?: string;
  contactName: string;
  source: MessageSource;
  platformId?: string; // IG/FB PSID or WA Phone
  
  // Phone model (primarily for WhatsApp)
  phoneRaw: string;
  phoneE164: string;
  phoneSearchKey: string;
  
  lastMessage: string;
  lastMessageDate: string;
  lastMessageSender: 'advisor' | 'lead';
  lastInboundDate?: string;    // Fecha del último mensaje entrante (lead) — para cálculo de ventana 24h
  unreadCount: number;
  
  advisorId: string;
  status: 'active' | 'archived' | 'bot_handling';
  aiScore?: number;
  aiSentiment?: 'positive' | 'neutral' | 'negative' | 'critical';
  aiSuggestedReply?: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  text: string;
  sender: 'advisor' | 'lead';
  direction: 'inbound' | 'outbound';
  timestamp: string;
  type: 'text' | 'image' | 'video' | 'location' | 'audio' | 'document' | 'template' | 'media';
  status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  externalId?: string;
  errorMessage?: string;
  aiSuggested?: boolean;
  aiCoachingTip?: string;
  mediaUrl?: string;
}

export interface WhatsappTemplate {
  id: string;
  name: string;                // Nombre legible para el asesor
  metaTemplateName: string;    // Nombre exacto registrado en Meta
  languageCode: string;        // e.g. "es_MX"
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  bodyPreview: string;         // Cuerpo con {{1}}, {{2}} como placeholders
  variables: string[];         // Etiquetas amigables para cada variable en orden
  isActive: boolean;
}

export interface AgendaItem {
  id: string;
  tenantId: string;
  title: string;
  type: 'llamada' | 'seguimiento' | 'visita técnica' | 'visita' | 'instalación' | 'recordatorio' | 'tarea interna';
  date: string; // ISO date
  leadId?: string;
  quoteId?: string;
  advisorId: string;
  isCompleted: boolean;
}

export interface UserPresence {
  uid: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: Role;
  status: 'online' | 'idle' | 'offline';
  lastSeenAt: string; // ISO
  lastActiveAt: string; // ISO
  currentRoute: string;
  authProvider: string; // google.com, password, etc.
  userAgent: string;
  updatedAt: any; // serverTimestamp
}

export interface Task {
  id: string;
  tenantId: string;
  title: string;
  description?: string;
  isCompleted: boolean;
  priority: 'low' | 'medium' | 'high';
  category?: string; // e.g., 'Ventas', 'Técnico', 'Cobranza'
  tags?: string[];
  dueDate?: string;
  advisorId: string;
  createdAt: string;
}

export interface CatalogItem {
  id: string;
  tenantId: string;
  code?: string;
  name: string;
  description: string;
  rate: number;
  currency: string;
  unit?: string;
  category?: string;
  imageUrl?: string;
  images?: string[];
  createdAt: string;
}
