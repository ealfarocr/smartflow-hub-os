import { HttpsError } from 'firebase-functions/v2/https';
import {
  buildMetaErrorDetail,
  checkConversationSendAccess,
  checkConversationTenantMatch,
  checkMembershipAuth,
  type MetaErrorDetail,
} from './sendMessageAuth';

// Lógica de sendMetaMessage extraída con dependencias inyectadas para poder
// testear todo el camino (auth -> conversación -> integración -> Graph ->
// persistencia) sin emulador ni mocks de Firestore.

export const GRAPH_MESSAGES_URL = 'https://graph.facebook.com/v17.0/me/messages';

type MetaSendSource = 'instagram' | 'facebook';

export interface SendMetaMessageDeps {
  isSuperAdmin(uid: string): Promise<boolean>;
  getMembership(uid: string, tenantId: string): Promise<{ status: string; role: string } | null>;
  getConversation(conversationId: string): Promise<Record<string, any> | null>;
  findActiveIntegration(tenantId: string, provider: MetaSendSource): Promise<Record<string, any> | null>;
  fetchFn: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<any>;
  }>;
  persistMessage(conversationId: string, message: {
    text: string;
    status: 'sent' | 'failed';
    externalId: string;
    errorMessage: string | null;
    metaErrorDetail: MetaErrorDetail | null;
  }): Promise<string>;
  randomId(): string;
}

export interface SendMetaMessageInput {
  uid: string | undefined;
  data: { conversationId?: string; text?: string; tenantId?: string; source?: string } | undefined;
}

export interface SendMetaMessageResult {
  success: boolean;
  messageId: string;
  status: 'sent' | 'failed';
  externalId: string;
  errorMessage: string | null;
}

export async function runSendMetaMessage(deps: SendMetaMessageDeps, input: SendMetaMessageInput): Promise<SendMetaMessageResult> {
  if (!input.uid) {
    throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  }
  const uid = input.uid;
  const { conversationId, text, tenantId, source: requestedSource } = input.data || {};

  if (!conversationId || !text || !tenantId || typeof conversationId !== 'string' || typeof text !== 'string' || typeof tenantId !== 'string') {
    throw new HttpsError('invalid-argument', 'Faltan parámetros obligatorios');
  }

  // 1. MEMBRESÍA + ROL (mismo checkpoint que sendWhatsappMessage)
  const isSuperAdmin = await deps.isSuperAdmin(uid);
  const membership = await deps.getMembership(uid, tenantId);
  const membershipAuth = checkMembershipAuth({ isSuperAdmin, membership });
  if (!membershipAuth.allowed) {
    throw new HttpsError(
      'permission-denied',
      membershipAuth.reason === 'read-only-role'
        ? 'Tu rol es de solo lectura — no podés enviar mensajes.'
        : 'No tienes una membresía activa en este tenant'
    );
  }

  // 2. CONVERSACIÓN (antes de resolver la integración)
  const conv = await deps.getConversation(conversationId);
  if (!conv) {
    throw new HttpsError('not-found', 'Conversación no encontrada');
  }

  // 3. TENANT DE LA CONVERSACIÓN
  if (!checkConversationTenantMatch(conv.tenantId, tenantId)) {
    throw new HttpsError('permission-denied', 'Esta conversación no pertenece a tu negocio.');
  }

  // 4. OWNERSHIP (Owner/Admin/SuperAdmin tenant-wide; resto solo asignada a su uid)
  const access = checkConversationSendAccess({
    isSuperAdmin,
    role: membership?.role ?? null,
    conversationAdvisorId: conv.advisorId,
    uid,
  });
  if (!access.allowed) {
    throw new HttpsError(
      'permission-denied',
      access.reason === 'unassigned-conversation'
        ? 'La conversación no tiene asesor asignado. Tómala primero.'
        : 'Esta conversación está asignada a otro asesor.'
    );
  }

  // 5. SOURCE: sale SOLO de la conversación
  const source = conv.source;
  if (source !== 'instagram' && source !== 'facebook') {
    throw new HttpsError('permission-denied', 'Esta función solo envía por Instagram o Messenger.');
  }
  if (requestedSource !== undefined && requestedSource !== null && requestedSource !== source) {
    throw new HttpsError('failed-precondition', 'El canal solicitado no coincide con el de la conversación.');
  }

  // 6. INTEGRACIÓN (tenant validado + provider == conv.source + activa)
  const integration = await deps.findActiveIntegration(tenantId, source);
  if (!integration) {
    throw new HttpsError('failed-precondition', `No hay una integración de ${source} activa`);
  }
  if (integration.provider !== source || integration.tenantId !== tenantId) {
    throw new HttpsError('failed-precondition', 'La integración no corresponde al canal de la conversación.');
  }
  const accessToken = integration.accessToken;
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new HttpsError('failed-precondition', `La integración de ${source} está mal configurada (falta el token)`);
  }
  const recipientId = conv.platformId;
  if (!recipientId) {
    throw new HttpsError('failed-precondition', 'La conversación no tiene destinatario.');
  }

  // 7. ENVÍO A META (token en cabecera, nunca en la URL)
  let status: 'sent' | 'failed' = 'sent';
  let externalId = `meta.${deps.randomId()}`;
  let errorMessage: string | null = null;
  let metaErrorDetail: MetaErrorDetail | null = null;

  try {
    const response = await deps.fetchFn(GRAPH_MESSAGES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
    });
    const result = await response.json();
    if (!response.ok) {
      metaErrorDetail = buildMetaErrorDetail(response.status, result?.error);
      throw new Error(result?.error?.message || 'Error en Graph API');
    }
    externalId = result.message_id || externalId;
  } catch (err: any) {
    status = 'failed';
    errorMessage = String(err?.message || 'Error desconocido').split(accessToken).join('[REDACTED]');
  }

  // 8. PERSISTENCIA (se mantiene sent/failed)
  const messageId = await deps.persistMessage(conversationId, { text, status, externalId, errorMessage, metaErrorDetail });

  return { success: status === 'sent', messageId, status, externalId, errorMessage };
}
