// ═══════════════════════════════════════════════════════════════════════
// CICLO DE ACCESO DE UN USUARIO — máquina de estados explícita.
//
// Antes no existía: cada pieza (setVendorPin, getVendorAccessInfo,
// loginWithPin, la UI) decidía por su cuenta combinando `membership.status`
// con "¿existe vendor_credentials?", y quedó un estado muerto real en
// producción: una membership 'active' SIN credencial no podía generar PIN
// (setVendorPin exigía prepared/draft) aunque la UI ya sabía que no tenía
// PIN. Este módulo es la única fuente de verdad de qué estado de acceso
// tiene alguien y qué acción de NEGOCIO corresponde — el backend la aplica
// y también se la devuelve a la UI (getTenantAccessOverview), así la UI
// nunca ofrece un botón que el backend va a rechazar.
//
// Puro a propósito (sin Firestore, sin admin SDK) para poder testearlo con
// vitest sin importar index.ts — mismo patrón que vendorPinAuth.ts.
// ═══════════════════════════════════════════════════════════════════════

export type AccessState =
  // prepared/draft: cargado por un Admin, nunca tuvo método de acceso.
  | 'no-access'
  // PIN ya generado, todavía sin usarse ni una vez (setVendorPin deja la
  // membership en 'pending' a propósito: el primer signInWithCustomToken
  // dispara acceptTenantInvite, que la activa y la re-indexa).
  | 'pending-first-login'
  // Operando normalmente, con PIN válido.
  | 'active-with-access'
  // EL ESTADO QUE ESTABA MUERTO: activo y trabajando, pero sin credencial
  // de PIN que resolver. Tiene que poder generar un acceso nuevo.
  | 'active-without-access'
  // Desactivado por un Admin. El historial se conserva siempre.
  | 'suspended'
  // Cualquier status que no conozcamos — nunca se asume permisivo.
  | 'unknown';

export interface MembershipAccessInput {
  status: string | undefined;
  /** uid real de Firebase Auth; null/ausente mientras nunca entró. */
  userId: string | null | undefined;
  /** ¿existe una credencial de PIN resoluble para esta membership? */
  hasCredential: boolean;
}

export function resolveAccessState(input: MembershipAccessInput): AccessState {
  const { status, userId, hasCredential } = input;

  if (status === 'suspended' || status === 'inactive') return 'suspended';
  if (status === 'prepared' || status === 'draft') return 'no-access';

  if (status === 'pending') {
    // Con credencial y sin uid todavía = PIN generado, esperando el primer
    // acceso. Sin credencial = invitación por correo que nadie aceptó.
    return hasCredential && !userId ? 'pending-first-login' : 'no-access';
  }

  if (status === 'active') {
    return hasCredential ? 'active-with-access' : 'active-without-access';
  }

  return 'unknown';
}

/**
 * Acción PRINCIPAL de negocio para cada estado — lo único que un Owner no
 * técnico necesita entender. Ningún estado devuelve 'none': no hay
 * callejones sin salida.
 */
export type AccessActionKey =
  | 'generate'               // Generar acceso (crea PIN nuevo)
  | 'copy'                   // Copiar acceso (enlace + usuario ya existentes)
  | 'reactivate'             // Reactivar usuario (ya tiene acceso)
  | 'reactivate-and-generate'// Reactivar y generar acceso (no tiene acceso)
  | 'review';                // Estado desconocido: abrir la ficha, no actuar a ciegas

export interface AccessActions {
  primary: AccessActionKey;
  /** ¿Se puede reemplazar el PIN actual por uno nuevo? */
  canRegenerate: boolean;
}

export function resolveAccessActions(state: AccessState): AccessActions {
  switch (state) {
    case 'no-access':
      return { primary: 'generate', canRegenerate: false };
    case 'active-without-access':
      return { primary: 'generate', canRegenerate: false };
    case 'pending-first-login':
      return { primary: 'copy', canRegenerate: true };
    case 'active-with-access':
      return { primary: 'copy', canRegenerate: true };
    case 'suspended':
      // Se decide con la credencial, no solo con el status: reactivar a
      // alguien que no tiene PIN lo dejaría activo y sin forma de entrar.
      return { primary: 'reactivate', canRegenerate: false };
    case 'unknown':
      return { primary: 'review', canRegenerate: false };
  }
}

/** Igual que resolveAccessActions, pero distingue el suspendido sin PIN. */
export function resolveAccessActionsFor(input: MembershipAccessInput): AccessActions {
  const state = resolveAccessState(input);
  if (state === 'suspended') {
    return {
      primary: input.hasCredential ? 'reactivate' : 'reactivate-and-generate',
      canRegenerate: false,
    };
  }
  return resolveAccessActions(state);
}

// ───────────────────────────────────────────────────────────────────────
// Transición que aplica setVendorPin
// ───────────────────────────────────────────────────────────────────────

export type SetPinMode =
  // No hay cuenta técnica de Firebase Auth todavía: hay que crearla (+
  // login_handle + email interno) y dejar la membership lista para el
  // primer acceso.
  | 'bootstrap'
  // Ya hay un uid real de Firebase Auth (la persona entró alguna vez) pero
  // no hay credencial de PIN resoluble: se le engancha una credencial nueva
  // a ESE uid, sin crear una cuenta nueva ni tocar su historial. Este es el
  // camino que faltaba y que producía el estado muerto.
  | 'attach'
  // Ya hay credencial: solo se reemplaza el PIN (el anterior queda inválido).
  | 'regenerate';

export interface SetVendorPinTransitionResult {
  allowed: boolean;
  mode?: SetPinMode;
  reason?: 'suspended' | 'unknown-state';
}

/**
 * Transiciones válidas de PRODUCTO (no de implementación):
 *   prepared/draft            -> generar PIN  (bootstrap)
 *   pending sin credencial    -> generar PIN  (bootstrap si nunca entró)
 *   active sin credencial     -> generar PIN  (attach al uid que ya existe)
 *   active/pending con cred.  -> regenerar PIN
 *   suspended                 -> RECHAZO explícito y accionable: primero
 *                                reactivar (la UI ofrece "Reactivar y
 *                                generar acceso" como una sola acción).
 */
export function checkSetVendorPinTransition(input: MembershipAccessInput): SetVendorPinTransitionResult {
  const state = resolveAccessState(input);

  switch (state) {
    case 'pending-first-login':
    case 'active-with-access':
      return { allowed: true, mode: 'regenerate' };
    case 'active-without-access':
      // Tiene uid real: se engancha la credencial a esa cuenta. Si por
      // algún motivo no lo tuviera, hay que crearla desde cero.
      return { allowed: true, mode: input.userId ? 'attach' : 'bootstrap' };
    case 'no-access':
      return { allowed: true, mode: input.userId ? 'attach' : 'bootstrap' };
    case 'suspended':
      return { allowed: false, reason: 'suspended' };
    case 'unknown':
      return { allowed: false, reason: 'unknown-state' };
  }
}

export const SUSPENDED_PIN_ERROR =
  'Este usuario está desactivado. Reactivalo primero y después generá su acceso.';
