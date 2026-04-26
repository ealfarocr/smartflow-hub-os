export type Role = 'Owner' | 'Admin' | 'Asesor Comercial' | 'Técnico' | 'Solo lectura';

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
}

export interface Membership {
  id: string; // Document ID
  userId: string | null; // Null if pending invite
  email: string; // Used for inviting
  tenantId: string;
  role: Role;
  invitedBy?: string;
  invitedAt?: any;
  status: 'pending' | 'active' | 'suspended';
}

export type CRMStage = 
  | 'Nuevo' 
  | 'Seguimiento' 
  | 'Visita Técnica' 
  | 'Venta Realizada' 
  | 'Perdido';

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
  source: 'WhatsApp' | 'Facebook' | 'Organico' | 'Referido';
  stage: CRMStage;
  lastActivity: string; // ISO Date String
  createdAt: string;
  orderIndex: number; // for drag and drop
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
  
  // Technical details
  consumptionEstimadoKwh: number;
  systemRecommended: string;
  panelsCount: number;
  inverter: string;
  powerKw: number;
  productionEstimadaKwh: number;
  savingsEstimado: number;
  
  // Financial details
  subtotal: number;
  discount: number;
  taxes: number;
  total: number;
  
  remarks: string;
  status: QuoteStatus;

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

export interface Conversation {
  id: string;
  tenantId: string;
  leadId?: string;
  contactName: string;
  
  // Phone model
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
  updatedAt: string;
}

export interface Message {
  id: string;
  text: string;
  sender: 'advisor' | 'lead';
  direction: 'inbound' | 'outbound';
  timestamp: string;
  type: 'text' | 'image' | 'video' | 'location';
  status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  externalId?: string;
  errorMessage?: string;
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
  type: 'llamada' | 'seguimiento' | 'visita técnica' | 'instalación' | 'recordatorio' | 'tarea interna';
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
