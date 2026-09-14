// Lógica de autorización de sendWhatsappMessage extraída a funciones puras
// (mismo patrón que pinAuth.ts) para poder testear los casos exigidos sin
// necesidad de emulador ni mocks de Firestore/Admin SDK. Dos funciones,
// reflejando los dos checkpoints reales y separados del código: la
// membership/rol se resuelve ANTES de tocar la integración/conversación; el
// match de tenant de la conversación se resuelve DESPUÉS, una vez leída.

export interface MembershipForSend {
  status: string;
  role: string;
}

export interface MembershipAuthInput {
  isSuperAdmin: boolean;
  membership: MembershipForSend | null;
}

export interface MembershipAuthResult {
  allowed: boolean;
  reason?: 'no-active-membership' | 'read-only-role';
}

/**
 * Checkpoint 1 (paso 2 real): membership activa + rol permitido, con bypass
 * de SuperAdmin (mismo patrón que completeWhatsappEmbeddedSignup, Fase 4).
 */
export function checkMembershipAuth(input: MembershipAuthInput): MembershipAuthResult {
  if (input.isSuperAdmin) {
    return { allowed: true };
  }
  if (!input.membership || input.membership.status !== 'active') {
    return { allowed: false, reason: 'no-active-membership' };
  }
  if (input.membership.role === 'Solo lectura') {
    return { allowed: false, reason: 'read-only-role' };
  }
  return { allowed: true };
}

/**
 * Checkpoint 2 (paso 4 real): la conversación solicitada debe pertenecer
 * exactamente al tenantId pedido. Aplica siempre, incluso para SuperAdmin —
 * el bypass de checkMembershipAuth nunca alcanza para operar sobre la
 * conversación de un tenant distinto al declarado en el request.
 */
export function checkConversationTenantMatch(conversationTenantId: string, requestedTenantId: string): boolean {
  return conversationTenantId === requestedTenantId;
}

export interface MetaErrorDetail {
  httpStatus: number;
  type: string | null;
  code: number | null;
  subcode: number | null;
  fbtraceId: string | null;
}

/**
 * Sanea el error crudo de Meta Graph API antes de persistirlo en Firestore.
 * El Admin SDK RECHAZA cualquier campo `undefined` en un write y tira TODA
 * la transacción (no solo ese campo) — Meta no siempre manda error_subcode
 * (p.ej. OAuthException code:1, el genérico "An unknown error has
 * occurred"), así que sin este saneo ese campo quedaba `undefined` y el
 * mensaje fallido ni siquiera llegaba a guardarse (P0 USADITOS
 * 2026-09-14: la función terminaba en "Unhandled error" en vez de devolver
 * el detalle real). `null` sí es un valor válido para Firestore.
 */
export function buildMetaErrorDetail(
  httpStatus: number,
  error: { type?: string; code?: number; error_subcode?: number; fbtrace_id?: string } | undefined
): MetaErrorDetail {
  return {
    httpStatus,
    type: error?.type ?? null,
    code: error?.code ?? null,
    subcode: error?.error_subcode ?? null,
    fbtraceId: error?.fbtrace_id ?? null,
  };
}
