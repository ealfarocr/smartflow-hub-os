// Traducción de errores técnicos a algo que una vendedora pueda entender y
// accionar. Un asesor no debe recibir "An unknown error has occurred" ni
// "storage/unauthorized": eso no le dice qué hacer.
//
// El detalle técnico completo NO se pierde: sigue yendo a console/logs para
// Admin y Auditor. Acá solo se decide qué se le muestra a quien está atendiendo
// a un cliente.

export type SellerErrorLayer = 'upload' | 'send' | 'mic' | 'camera';

// Firebase confirma por sí mismo que la sesión ya no sirve.
const SESSION_DEAD_CODES = [
  'auth/user-token-expired',
  'auth/id-token-expired',
  'auth/user-disabled',
  'auth/invalid-user-token',
  'auth/user-not-found',
];

// Estos NO alcanzan por sí solos. Un 'storage/unauthorized' puede ser una Rule
// que no matchea, una ruta mal armada o un archivo fuera de límite — nada de eso
// significa que la persona tenga que volver a entrar. Sacarla de la sesión por
// un adjunto fallido es peor que el fallo original: pierde la conversación que
// estaba atendiendo. Cuando aparece uno de estos se le PREGUNTA a Firebase (ver
// confirmSessionDead) en vez de suponer.
const SESSION_SUSPECT_CODES = [
  'unauthenticated',
  'functions/unauthenticated',
  'storage/unauthenticated',
  'storage/unauthorized',
  'permission-denied',
  'functions/permission-denied',
];

export function errorCodeOf(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) return String((err as { code: unknown }).code);
  return '';
}

const matches = (code: string, list: string[]) =>
  list.some((c) => code === c || code.endsWith(`/${c}`) || code.includes(c));

/** Firebase ya dijo explícitamente que el token no sirve. */
export function isSessionDeadError(err: unknown): boolean {
  const code = errorCodeOf(err).toLowerCase();
  return !!code && matches(code, SESSION_DEAD_CODES);
}

/** Podría ser la sesión... o no. Hay que confirmarlo antes de expulsar a nadie. */
export function isSessionSuspectError(err: unknown): boolean {
  const code = errorCodeOf(err).toLowerCase();
  return !!code && (matches(code, SESSION_DEAD_CODES) || matches(code, SESSION_SUSPECT_CODES));
}

export interface RefreshableUser {
  getIdToken: (forceRefresh: boolean) => Promise<string>;
}

/**
 * Le PREGUNTA a Firebase si la sesión sigue viva, forzando un refresh real del
 * ID token. Es la única prueba válida: si el refresh funciona, la sesión está
 * sana y el error era de otra cosa (una Rule, una ruta, un límite) — y a la
 * persona no hay que sacarla de ningún lado.
 *
 * Devuelve true SOLO si Firebase confirma que hay que volver a entrar.
 */
export async function confirmSessionDead(getUser: () => RefreshableUser | null): Promise<boolean> {
  const user = getUser();
  if (!user) return true; // ya no hay sesión que sostener
  try {
    await user.getIdToken(true);
    return false; // el token se renovó: la sesión está viva
  } catch (e) {
    return isSessionDeadError(e);
  }
}

export const SESSION_DEAD_MESSAGE =
  'Tu acceso fue actualizado. Entrá otra vez con tu código para seguir trabajando.';

/** Mensaje para el vendedor según la capa donde falló. */
export function sellerErrorMessage(layer: SellerErrorLayer, err: unknown): string {
  // Solo cuando Firebase lo confirmó explícitamente. Los códigos meramente
  // sospechosos se traducen según su capa, sin hablar de sesión.
  if (isSessionDeadError(err)) return SESSION_DEAD_MESSAGE;

  const code = errorCodeOf(err).toLowerCase();

  if (layer === 'mic') {
    if (code.includes('notallowed') || code.includes('permissiondenied')) {
      return 'Permití el acceso al micrófono para grabar notas de voz.';
    }
    if (code.includes('notfound')) return 'No se encontró micrófono en este equipo.';
    return 'No se pudo grabar la nota de voz. Intentá de nuevo.';
  }

  if (layer === 'camera') {
    if (code.includes('notallowed') || code.includes('permissiondenied')) {
      return 'Permití el acceso a la cámara para tomar fotos o videos.';
    }
    if (code.includes('notfound')) return 'No se encontró cámara en este equipo.';
    return 'No se pudo usar la cámara. Intentá de nuevo.';
  }

  if (layer === 'upload') {
    if (code.includes('retry-limit') || code.includes('canceled')) {
      return 'La subida se cortó. Revisá tu conexión y probá de nuevo.';
    }
    if (code.includes('quota')) return 'No se pudo subir el archivo. Avisale a tu administrador.';
    if (code.includes('unauthorized')) return 'No se pudo subir el archivo. Probá de nuevo.';
    return 'No se pudo subir el archivo. Intentá nuevamente.';
  }

  // layer === 'send'
  // failed-precondition en el envío = no hay integración de WhatsApp activa o le
  // faltan tokens: lo resuelve el administrador, no reintentando.
  if (code.includes('failed-precondition')) return META_BLOCKED_MESSAGE;
  if (code.includes('unavailable') || code.includes('deadline')) {
    return 'Sin conexión estable. El mensaje no salió: probá de nuevo.';
  }
  return 'No se pudo enviar el mensaje. Intentá de nuevo.';
}

/**
 * Anti-apilado: una causa, un solo aviso. Sin esto, un adjunto que falla en tres
 * pipelines (texto, media, nota de voz) mostraba tres toasts idénticos y
 * disparaba tres redirecciones — eso fue exactamente lo reportado desde el
 * teléfono. La ventana es corta a propósito: no silencia un problema nuevo más
 * tarde, solo la ráfaga simultánea de la misma causa.
 */
const DEDUPE_WINDOW_MS = 8000;
const recentNotices = new Map<string, number>();

export function shouldNotify(key: string, now: number = Date.now()): boolean {
  const last = recentNotices.get(key);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return false;
  recentNotices.set(key, now);
  return true;
}

/** Solo para tests: limpia el estado de deduplicación. */
export function resetNoticeDedupe(): void {
  recentNotices.clear();
}

/**
 * Errores de Meta que NO son culpa de SmartFlow ni del vendedor: la cuenta de
 * WhatsApp del negocio está bloqueada, sin método de pago o sin verificar. Al
 * vendedor no le sirve "An unknown error has occurred" — y reintentar tampoco
 * va a funcionar hasta que el administrador lo resuelva.
 */
const META_ACCOUNT_HINTS = [
  'unknown error',
  'oauthexception',
  '141006', // método de pago
  '141010', // verificación de negocio pendiente
  '141008', // WABA no activa
  'not been activated',
  'payment',
  'blocked',
];

export function isMetaAccountBlocker(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return false;
  const m = errorMessage.toLowerCase();
  return META_ACCOUNT_HINTS.some((h) => m.includes(h));
}

export const META_BLOCKED_MESSAGE =
  'WhatsApp no puede enviar en este momento. La cuenta de WhatsApp requiere atención del administrador.';

/** Qué mostrar cuando Meta rechaza un envío. */
export function outboundRejectionMessage(errorMessage: string | null | undefined): string {
  if (isMetaAccountBlocker(errorMessage)) return META_BLOCKED_MESSAGE;
  return 'WhatsApp no aceptó el mensaje. Intentá de nuevo o avisale a tu administrador.';
}
