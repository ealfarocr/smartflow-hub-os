// Autorización de setVendorPin — extraída para poder testear el caso de
// bootstrap del primer Owner sin depender de Firestore/emulador (mismo
// patrón que sendMessageAuth.ts). LOOP DE EMERGENCIA 2026-09-09: un tenant
// recién creado tiene todos sus Owners en status:'prepared' — nadie tiene
// una membership 'active' de Owner/Admin todavía, así que la regla normal
// (solo Owner/Admin activo administra accesos) deja al tenant sin forma de
// arrancar: nadie puede llamar setVendorPin para activar al primer Owner,
// ni siquiera el propio Owner (todavía no tiene acceso). El bootstrap de
// SuperAdmin cierra ese círculo, y SOLO ese.

export interface VendorPinAuthInput {
  isSuperAdmin: boolean;
  callerMembership: { status: string; role: string } | null;
  targetMembershipRole: string;
  tenantHasActiveOwner: boolean;
}

export interface VendorPinAuthResult {
  allowed: boolean;
  reason?: 'no-active-admin';
}

/**
 * Camino normal: el caller tiene una membership activa de Owner/Admin EN
 * ESTE MISMO tenant — la consulta que resuelve `callerMembership` ya está
 * scoped por tenantId (`memberships/{uid}_{tenantId}`), así que una
 * membership activa en OTRO tenant nunca llega acá como no-null (aísla
 * automáticamente el bootstrap de cross-tenant).
 *
 * Camino de bootstrap (SuperAdmin): solo aplica cuando (a) el tenant no
 * tiene NINGÚN Owner activo todavía y (b) la membership objetivo es de rol
 * Owner — nunca para activar un vendedor/Admin común, y se apaga solo (no
 * hace falta revocarlo a mano) apenas exista al menos un Owner activo,
 * incluso para otro Owner distinto.
 */
export function checkVendorPinAuth(input: VendorPinAuthInput): VendorPinAuthResult {
  if (
    input.callerMembership?.status === 'active' &&
    (input.callerMembership.role === 'Owner' || input.callerMembership.role === 'Admin')
  ) {
    return { allowed: true };
  }

  if (input.isSuperAdmin && input.targetMembershipRole === 'Owner' && !input.tenantHasActiveOwner) {
    return { allowed: true };
  }

  return { allowed: false, reason: 'no-active-admin' };
}

export interface PinLoginAllowedInput {
  membershipExists: boolean;
  membershipStatus: string | undefined;
  /**
   * uid real de Firebase Auth en la membership. Ausente/null = esta persona
   * nunca completó un acceso todavía.
   */
  membershipUserId?: string | null;
}

export interface PinLoginAllowedResult {
  allowed: boolean;
  reason?: 'no-membership' | 'not-active';
}

/**
 * LOOP — reutilización de teléfonos corporativos: loginWithPin nunca
 * chequeaba el estado real de la membership, solo que el hash del PIN
 * coincidiera contra vendor_credentials. Un vendedor desactivado
 * (status:'suspended') podía seguir sacando un customToken válido mientras
 * su PIN siguiera siendo el mismo — la desactivación bloqueaba acciones
 * puntuales después (sendWhatsappMessage, claimConversation, etc. ya exigen
 * status==='active'), pero nunca el login en sí. Esta es la única pieza que
 * realmente le corta el acceso desde la puerta.
 *
 * FIX 2026-09-09 — el chequeo anterior exigía status==='active' a secas, y
 * eso rompía el PRIMER acceso de todo vendedor nuevo: setVendorPin deja la
 * membership en 'pending' a propósito (con el email interno), porque es el
 * primer signInWithCustomToken el que dispara acceptTenantInvite y la
 * activa. Con la regla vieja ese primer login se denegaba y la membership
 * nunca llegaba a 'active' — nadie nuevo podía entrar nunca.
 *
 * 'pending' se acepta SOLO mientras la membership no tenga userId, o sea
 * mientras nadie la haya activado nunca. Desactivar NO produce ese estado
 * (setMembershipActive escribe 'suspended' y conserva el userId), así que
 * esto no reabre el agujero que cerró el chequeo original.
 */
export function checkPinLoginAllowed(input: PinLoginAllowedInput): PinLoginAllowedResult {
  if (!input.membershipExists) return { allowed: false, reason: 'no-membership' };
  if (input.membershipStatus === 'active') return { allowed: true };
  if (input.membershipStatus === 'pending' && !input.membershipUserId) return { allowed: true };
  return { allowed: false, reason: 'not-active' };
}
