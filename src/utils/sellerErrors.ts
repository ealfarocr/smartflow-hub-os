// Traducción de errores técnicos a algo que una vendedora pueda entender y
// accionar. Un asesor no debe recibir "An unknown error has occurred" ni
// "storage/unauthorized": eso no le dice qué hacer.
//
// El detalle técnico completo NO se pierde: sigue yendo a console/logs para
// Admin y Auditor. Acá solo se decide qué se le muestra a quien está atendiendo
// a un cliente.

export type SellerErrorLayer = 'upload' | 'send' | 'mic' | 'camera';

/** Códigos de Firebase que significan "tu sesión ya no sirve, hay que volver a entrar". */
const SESSION_DEAD_CODES = [
  'unauthenticated',
  'functions/unauthenticated',
  'storage/unauthenticated',
  'storage/unauthorized',
  'auth/user-token-expired',
  'auth/id-token-expired',
  'auth/user-disabled',
  'auth/invalid-user-token',
  'permission-denied',
  'functions/permission-denied',
];

export function errorCodeOf(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) return String((err as { code: unknown }).code);
  return '';
}

/**
 * ¿Este error significa que la sesión murió? Pasa, por ejemplo, cuando un
 * Owner/Admin regenera el código de acceso de esa persona: se revocan sus
 * refresh tokens, el teléfono sigue "abierto" pero ya no puede renovar su token
 * y a partir de ahí TODO falla a la vez — texto, adjuntos y notas de voz — con
 * tres mensajes distintos que no explican nada. Detectarlo permite mandarla a
 * entrar de nuevo con una sola frase clara.
 */
export function isSessionDeadError(err: unknown): boolean {
  const code = errorCodeOf(err).toLowerCase();
  if (!code) return false;
  return SESSION_DEAD_CODES.some((c) => code === c || code.endsWith(`/${c}`) || code.includes(c));
}

export const SESSION_DEAD_MESSAGE =
  'Tu acceso fue actualizado. Entrá otra vez con tu código para seguir trabajando.';

/** Mensaje para el vendedor según la capa donde falló. */
export function sellerErrorMessage(layer: SellerErrorLayer, err: unknown): string {
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
    return 'No se pudo subir el archivo. Intentá nuevamente.';
  }

  // layer === 'send'
  if (code.includes('unavailable') || code.includes('deadline')) {
    return 'Sin conexión estable. El mensaje no salió: probá de nuevo.';
  }
  return 'No se pudo enviar el mensaje. Intentá de nuevo.';
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
  'WhatsApp no puede enviar en este momento. La cuenta de Meta del negocio requiere atención del administrador.';

/** Qué mostrar cuando Meta rechaza un envío. */
export function outboundRejectionMessage(errorMessage: string | null | undefined): string {
  if (isMetaAccountBlocker(errorMessage)) return META_BLOCKED_MESSAGE;
  return 'WhatsApp no aceptó el mensaje. Intentá de nuevo o avisale a tu administrador.';
}
