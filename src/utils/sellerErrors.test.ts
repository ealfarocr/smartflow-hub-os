import { describe, it, expect } from 'vitest';
import {
  sellerErrorMessage,
  isSessionDeadError,
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

// Cuando un Owner/Admin regenera el código de acceso de alguien, se revocan sus
// refresh tokens: el teléfono sigue abierto pero ya no renueva el token, y a
// partir de ahí fallan A LA VEZ el texto, los adjuntos y las notas de voz. Ese
// fue exactamente el cuadro reportado desde el teléfono de USADITOS.
describe('Sesión muerta: una sola causa detrás de que falle todo junto', () => {
  const codigos = [
    'unauthenticated',
    'functions/unauthenticated',
    'storage/unauthorized',
    'auth/user-token-expired',
    'permission-denied',
  ];

  codigos.forEach((code) => {
    it(`${code} se reconoce como sesión caída`, () => {
      expect(isSessionDeadError({ code })).toBe(true);
    });
  });

  it('cualquiera de esas capas muestra el MISMO mensaje, no tres distintos', () => {
    const err = { code: 'storage/unauthorized' };
    expect(sellerErrorMessage('upload', err)).toBe(SESSION_DEAD_MESSAGE);
    expect(sellerErrorMessage('send', err)).toBe(SESSION_DEAD_MESSAGE);
    expect(sellerErrorMessage('mic', err)).toBe(SESSION_DEAD_MESSAGE);
  });

  it('el mensaje le dice qué hacer', () => {
    expect(SESSION_DEAD_MESSAGE).toMatch(/código/i);
  });

  it('un error normal NO se confunde con sesión caída', () => {
    expect(isSessionDeadError({ code: 'storage/retry-limit-exceeded' })).toBe(false);
    expect(isSessionDeadError(new Error('cualquier cosa'))).toBe(false);
    expect(isSessionDeadError(null)).toBe(false);
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

  it('un rechazo común de Meta no se disfraza de problema de cuenta', () => {
    expect(isMetaAccountBlocker('invalid phone number format')).toBe(false);
    expect(outboundRejectionMessage('invalid phone number format')).not.toBe(META_BLOCKED_MESSAGE);
  });
});
