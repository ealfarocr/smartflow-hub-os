// Decisión pura de si un status update de Meta (sent/delivered/read/failed,
// llegado por webhook) debe aplicarse al mensaje guardado — extraída para
// poder testear idempotencia y orden sin Firestore/emulador (mismo patrón
// que pinAuth.ts / sendMessageAuth.ts). LOOP nocturno USADITOS, Fase 6: el
// webhook recibía estos eventos y solo los logueaba, nunca actualizaba el
// mensaje — afecta a todos los tenants, no solo a USADITOS.

const STATUS_RANK: Record<string, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

/**
 * true si el status entrante debe escribirse sobre el status actual.
 * - "failed" es terminal: siempre se aplica (salvo que ya estaba failed).
 * - Un mensaje ya failed no se "revive" por un evento tardío fuera de orden.
 * - El resto solo avanza (sent -> delivered -> read), nunca retrocede —
 *   protege contra reordenamiento de red (ej. "read" procesado antes que
 *   un "delivered" que llega tarde no debe bajar el estado a delivered).
 * - Un status desconocido (typo/campo nuevo de Meta) no se aplica.
 */
export function shouldApplyStatusUpdate(currentStatus: string | undefined | null, incomingStatus: string): boolean {
  if (currentStatus === 'failed') return false;
  if (incomingStatus === 'failed') return true;

  const incomingRank = STATUS_RANK[incomingStatus];
  if (incomingRank === undefined) return false;

  const currentRank = STATUS_RANK[currentStatus ?? 'pending'] ?? 0;
  return incomingRank > currentRank;
}

export interface WebhookMetaError {
  source: 'webhook';
  code: number | null;
  subcode: number | null;
  title: string | null;
  message: string | null;
  type: string | null;
  fbtraceId: string | null;
  details: string | null;
  wamid: string;
  receivedAt: string;
}

const clip = (v: unknown, max = 500): string | null =>
  typeof v === 'string' && v ? v.slice(0, max) : null;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Normaliza statuses[0].errors[0] de un webhook `failed` de Meta para
 * persistirlo/loguearlo SOLO como diagnostico. Nunca incluye el payload
 * completo (ni telefonos, tokens o headers); de error_data solo `details`.
 * Sin `undefined` (Firestore los rechaza). Puro: no decide ningun estado.
 */
export function buildWebhookMetaError(
  err: Record<string, any> | undefined | null,
  wamid: string,
  receivedAt: string
): WebhookMetaError {
  return {
    source: 'webhook',
    code: num(err?.code),
    subcode: num(err?.error_subcode ?? err?.subcode),
    title: clip(err?.title),
    message: clip(err?.message),
    type: clip(err?.type, 100),
    fbtraceId: clip(err?.fbtrace_id, 100),
    details: clip(err?.error_data?.details),
    wamid,
    receivedAt,
  };
}
