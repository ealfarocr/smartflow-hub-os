import { describe, it, expect } from 'vitest';
import {
  sellerErrorMessage,
  isSessionDeadError,
  isSessionSuspectError,
  confirmSessionDead,
  shouldNotify,
  resetNoticeDedupe,
  isMetaAccountBlocker,
  outboundRejectionMessage,
  SESSION_DEAD_MESSAGE,
  META_BLOCKED_MESSAGE,
} from './sellerErrors';

describe('El vendedor nunca recibe jerga técnica', () => {
  const casos: [Parameters<typeof sellerErrorMessage>[0], unknown][] = [
    ['upload', { code: 'storage/retry-limit-exceeded' }],
    ['upload', { code: 'storage/quota-exceeded' }],
    ['upload', new Error('boom')],
    ['send', { code: 'functions/unavailable' }],
    ['send', new Error('Network request failed')],
    ['mic', { name: 'NotAllowedError', code: 'NotAllowedError' }],
    ['camera', { name: 'NotFoundError', code: 'NotFoundError' }],
  ];

  casos.forEach(([layer, err]) => {
    it(`${layer}: el mensaje es en español y sin códigos`, () => {
      const msg = sellerErrorMessage(layer, err);
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).not.toMatch(/storage\/|functions\/|Error:|undefined|unknown error/i);
    });
  });

  it('el micrófono denegado dice qué hacer, no qué falló', () => {
    expect(sellerErrorMessage('mic', { code: 'NotAllowedError' }))
      .toContain('Permití el acceso al micrófono');
  });

  it('la cámara denegada también', () => {
    expect(sellerErrorMessage('camera', { code: 'NotAllowedError' }))
      .toContain('Permití el acceso a la cámara');
  });

  it('sin conexión se distingue de un fallo real', () => {
    expect(sellerErrorMessage('send', { code: 'functions/unavailable' })).toMatch(/conexión/i);
  });
});

// REGLA CORREGIDA: un fallo de adjunto NO puede expulsar al vendedor. Un
// storage/unauthorized puede ser una Rule, una ruta o un limite — sacarlo de la
// sesion por eso le hace perder la conversacion que estaba atendiendo. Solo se
// reautentica si Firebase CONFIRMA que el token ya no se puede renovar.
describe('Un fallo de adjunto no expulsa a nadie', () => {
  const sospechosos = ['unauthenticated', 'functions/unauthenticated', 'storage/unauthorized', 'permission-denied'];

  sospechosos.forEach((code) => {
    it(`${code} NO se da por sesion muerta sin confirmar`, () => {
      expect(isSessionDeadError({ code })).toBe(false);
      expect(isSessionSuspectError({ code })).toBe(true);
    });
  });

  it('storage/unauthorized se traduce como problema de subida, no de acceso', () => {
    const msg = sellerErrorMessage('upload', { code: 'storage/unauthorized' });
    expect(msg).not.toBe(SESSION_DEAD_MESSAGE);
    expect(msg).toMatch(/subir/i);
  });

  it('si el token SI se renueva, la sesion esta viva y no hay que sacar a nadie', async () => {
    const vivo = { getIdToken: async () => 'token-nuevo' };
    expect(await confirmSessionDead(() => vivo)).toBe(false);
  });

  it('solo si Firebase confirma que el token no se renueva se pide volver a entrar', async () => {
    const muerto = { getIdToken: async () => { throw { code: 'auth/user-token-expired' }; } };
    expect(await confirmSessionDead(() => muerto)).toBe(true);
  });

  it('un fallo de red al refrescar tampoco expulsa', async () => {
    const red = { getIdToken: async () => { throw { code: 'auth/network-request-failed' }; } };
    expect(await confirmSessionDead(() => red)).toBe(false);
  });

  it('sin usuario, ya no hay sesion que sostener', async () => {
    expect(await confirmSessionDead(() => null)).toBe(true);
  });

  it('Firebase confirmando el token vencido si es sesion muerta', () => {
    expect(isSessionDeadError({ code: 'auth/user-token-expired' })).toBe(true);
    expect(isSessionDeadError({ code: 'auth/user-disabled' })).toBe(true);
  });

  it('un error normal NO se confunde con sesion caida', () => {
    expect(isSessionSuspectError({ code: 'storage/retry-limit-exceeded' })).toBe(false);
    expect(isSessionSuspectError(new Error('cualquier cosa'))).toBe(false);
    expect(isSessionSuspectError(null)).toBe(false);
  });
});

// Sin esto, un adjunto que falla en tres pipelines mostraba tres toasts identicos
// y disparaba tres redirecciones: exactamente lo reportado desde el telefono.
describe('Los avisos no se apilan', () => {
  it('la misma causa avisa una sola vez dentro de la ventana', () => {
    resetNoticeDedupe();
    expect(shouldNotify('session-dead', 1000)).toBe(true);
    expect(shouldNotify('session-dead', 1100)).toBe(false);
    expect(shouldNotify('session-dead', 2000)).toBe(false);
  });

  it('pasada la ventana vuelve a avisar (no silencia un problema nuevo)', () => {
    resetNoticeDedupe();
    expect(shouldNotify('upload:x', 1000)).toBe(true);
    expect(shouldNotify('upload:x', 1000 + 9000)).toBe(true);
  });

  it('causas distintas avisan por separado', () => {
    resetNoticeDedupe();
    expect(shouldNotify('upload:a', 1000)).toBe(true);
    expect(shouldNotify('mic:b', 1000)).toBe(true);
  });
});
describe('Bloqueo de la cuenta de Meta: no es culpa del vendedor', () => {
  it('reconoce el "An unknown error has occurred" que devolvía Meta', () => {
    expect(isMetaAccountBlocker('An unknown error has occurred')).toBe(true);
    expect(outboundRejectionMessage('An unknown error has occurred')).toBe(META_BLOCKED_MESSAGE);
  });

  it('reconoce los códigos reales de la WABA de USADITOS', () => {
    ['(#141006) payment method', 'error 141010 business verification', '141008 not been activated']
      .forEach((m) => expect(isMetaAccountBlocker(m)).toBe(true));
  });

  it('el mensaje apunta al administrador, no al vendedor', () => {
    expect(META_BLOCKED_MESSAGE).toMatch(/administrador/i);
    expect(META_BLOCKED_MESSAGE).not.toMatch(/unknown|error code|exception/i);
  });

  it('sin integración activa (failed-precondition) el aviso es el del administrador', () => {
    expect(sellerErrorMessage('send', { code: 'functions/failed-precondition' })).toBe(META_BLOCKED_MESSAGE);
    expect(META_BLOCKED_MESSAGE).toContain('La cuenta de WhatsApp requiere atención del administrador.');
  });

  it('un rechazo común de Meta no se disfraza de problema de cuenta', () => {
    expect(isMetaAccountBlocker('invalid phone number format')).toBe(false);
    expect(outboundRejectionMessage('invalid phone number format')).not.toBe(META_BLOCKED_MESSAGE);
  });
});
