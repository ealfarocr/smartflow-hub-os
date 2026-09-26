/**
 * Estado de conexión de WhatsApp de un tenant (LOOP maestro, Fase 4).
 * Fuente de verdad única: el documento real de `integrations`, nunca UI local.
 */
export type WhatsAppConnectionStatus = 'NOT_CONNECTED' | 'PENDING' | 'CONNECTED' | 'ERROR' | 'UNKNOWN';

export const WHATSAPP_STATUS_LABEL: Record<WhatsAppConnectionStatus, string> = {
  NOT_CONNECTED: 'No conectado',
  PENDING: 'Configurando…',
  CONNECTED: 'Conectado',
  ERROR: 'Revisar conexión',
  UNKNOWN: 'Revisar WhatsApp',
};

/**
 * Deriva el estado a partir del doc completo de `integrations` (contexto
 * dentro del tenant, /integraciones). CONNECTED exige isActive + phoneNumberId
 * + accessToken presentes. El accessToken solo se usa acá para chequear que
 * EXISTE (booleano) — su valor nunca se expone en el resultado.
 *
 * PENDING modela un doc creado pero sin datos de conexión todavía; el flujo
 * actual de completeWhatsappEmbeddedSignup no persiste ese estado intermedio
 * (o falla antes de escribir, o completa todo de una vez), así que hoy este
 * caso no ocurre en la práctica — queda modelado para cuando exista un paso
 * que sí lo escriba (o para un futuro estado "conectando" persistido).
 */
export function deriveStatusFromIntegration(
  integration: { isActive?: boolean; phoneNumberId?: string | null; accessToken?: string | null } | null | undefined
): WhatsAppConnectionStatus {
  if (!integration) return 'NOT_CONNECTED';
  const hasCore = !!integration.phoneNumberId && !!integration.accessToken;
  if (integration.isActive && hasCore) return 'CONNECTED';
  if (!integration.isActive && !hasCore) return 'PENDING';
  return 'ERROR';
}

/**
 * Deriva el estado a partir de una entrada del mapa que devuelve la Cloud
 * Function getWhatsappNumbers (contexto Super Admin — ese mapa nunca incluye
 * accessToken por diseño, solo displayPhoneNumber/phoneNumberId/isActive/error).
 * Ausencia total de entrada para un tenantId significa NOT_CONNECTED, pero SOLO
 * si la consulta al backend realmente respondió. Si la Cloud Function falló
 * (`lookupFailed`), el mapa llega vacío para TODOS los tenants y no se sabe nada
 * del estado real: eso es UNKNOWN, no "no conectado" — mostrar ahí un botón de
 * conectar invitaría a relanzar Embedded Signup sobre una integración viva.
 */
export function deriveStatusFromSuperAdminEntry(
  entry: { isActive?: boolean; phoneNumberId?: string | null; displayPhoneNumber?: string | null; error?: string } | null | undefined,
  lookupFailed = false
): WhatsAppConnectionStatus {
  if (!entry) return lookupFailed ? 'UNKNOWN' : 'NOT_CONNECTED';
  if (entry.error) return 'ERROR';
  if (entry.isActive && (entry.phoneNumberId || entry.displayPhoneNumber)) return 'CONNECTED';
  if (!entry.isActive && entry.phoneNumberId) return 'PENDING';
  return 'ERROR';
}
