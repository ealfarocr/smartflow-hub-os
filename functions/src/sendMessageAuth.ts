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
