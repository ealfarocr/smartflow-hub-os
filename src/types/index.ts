import type { Timestamp, FieldValue } from 'firebase/firestore';

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
  // Elegibilidad para asignación AUTOMÁTICA de leads — independiente de estar
  // "en el equipo" (includedUserIds) y de la cuenta del vendedor.
  // null/undefined = todos los active+incluidos son elegibles (fallback,
  // reproduce el comportamiento sin este campo); array explícito = lista
  // curada por el Owner/Admin. Ver src/utils/multiAgentEligibility.ts.
  leadEnabledUserIds?: string[] | null;
  // Último identificador (userId) asignado por el round-robin — server-side,
  // solo lo escribe functions/src/index.ts (assignConversationAdvisor)
  // dentro de una transacción. El frontend nunca decide ni escribe esto.
  roundRobinCursor?: string | null;
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
  // null solo en status 'prepared' — nombre/rol cargados sin correo todavía
  // (ver createPreparedMember). Todos los demás estados requieren email real.
  email: string | null; // Used for inviting
  name?: string; // Nombre del asesor
  tenantId: string;
  tenantName?: string; // Cache del nombre para la UI
  role: Role;
  invitedBy?: string;
  invitedAt?: any;
  // 'prepared': solo nombre/rol, sin correo — no puede registrarse ni
  //   recibir invitación hasta que se le agregue un email (prepared → draft).
  // 'draft': preparado por un admin (nombre/email/rol) pero sin invitación
  //   enviada — no debe habilitar registro ni acceso por ningún método de login.
  status: 'prepared' | 'draft' | 'pending' | 'active' | 'suspended';
  // Control de herramientas por usuario, además del rol. undefined/null =
  // sin configurar todavía → cae al fallback por rol (ver
  // src/utils/permissions.ts getEffectiveTools), que reproduce el
  // comportamiento actual — así ninguna membership existente pierde acceso
  // el día que se despliega esto. [] explícito = "ninguna herramienta".
  allowedTools?: string[] | null;
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
  
  advisorId: string; // '' = sin asignar (modo Libre, o Automático sin elegibles)
  assignedAt?: string;
  assignedBy?: string; // uid de quien reclamó manualmente, o ausente si fue automático
  assignmentSource?: 'manual_claim' | 'manual_reassign' | 'auto_round_robin' | 'unassigned_free_mode' | 'unassigned_no_eligible' | 'unassigned_error';
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

// Estado operativo (LOOP) — quién puede recibir leads AHORA, no si tiene
// sesión abierta. Independiente de online/idle/offline: una pestaña abierta
// nunca cuenta como "trabajando" (ver Fase 18) — solo lo pone así una
// elección explícita del vendedor en el selector.
export type OperationalStatus = 'working' | 'coffee' | 'lunch' | 'errand' | 'off_shift';

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
  // Sin operationalStatus todavía (memberships previas a esta feature) =
  // tratar como 'off_shift' en TODO lado, nunca como 'working' por defecto
  // (ver Fase 21 — evita asignar leads a alguien que nunca inició turno).
  operationalStatus?: OperationalStatus;
  operationalStatusChangedAt?: string; // ISO
  // Sesión de turno abierta actualmente (o null si operationalStatus es
  // 'off_shift') — usePresenceTracker usa esto para saber a qué
  // work_sessions/{id} sumarle los segundos de cada heartbeat.
  activeWorkSessionId?: string | null;
}

// Un turno: desde que el vendedor sale de 'off_shift' por primera vez hasta
// que vuelve a 'off_shift' (o cierra sesión). connected/active/idle se
// mantienen separados a propósito (Fase 18) — "tiempo conectado" nunca se
// etiqueta solo como "horas trabajadas" en la UI.
export interface WorkSession {
  id: string;
  tenantId: string;
  userId: string;
  deviceId?: string;
  startedAt: Timestamp | FieldValue;
  endedAt?: Timestamp | FieldValue | null;
  lastSeenAt: Timestamp | FieldValue;
  activeSeconds: number;
  idleSeconds: number;
  status: OperationalStatus;
}

// Log append-only de cada cambio de estado operativo — permite reconstruir
// la línea de tiempo del día (08:03 working, 10:17 coffee, ...) sin
// depender de que work_sessions guarde el historial completo de pausas.
export interface WorkStatusEvent {
  id: string;
  tenantId: string;
  userId: string;
  deviceId?: string;
  fromStatus: OperationalStatus | null;
  toStatus: OperationalStatus;
  changedAt: Timestamp | FieldValue;
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
