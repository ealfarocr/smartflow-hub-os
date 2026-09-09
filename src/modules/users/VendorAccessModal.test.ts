import { describe, it, expect } from 'vitest';
import { buildFullMessage } from './VendorAccessModal';

describe('buildFullMessage — mensaje de WhatsApp para acceso de vendedor', () => {
  it('incluye usuario, PIN y enlace en el formato pedido', () => {
    const msg = buildFullMessage({
      name: 'Michelle',
      loginHandle: 'michelle',
      pin: '482913',
      link: 'https://hub.smartflow-suite.com/acceso?h=michelle&t=t-1&n=Michelle',
    });
    expect(msg).toContain('Acceso SmartFlow');
    expect(msg).toContain('Usuario: michelle');
    expect(msg).toContain('PIN: 482913');
    expect(msg).toContain('Enlace: https://hub.smartflow-suite.com/acceso?h=michelle&t=t-1&n=Michelle');
    expect(msg).toContain('Abre este enlace una sola vez desde tu teléfono');
  });

  it('el orden es Usuario, PIN, Enlace, instrucción — en ese orden', () => {
    const msg = buildFullMessage({
      name: 'Ana',
      loginHandle: 'ana',
      pin: '000000',
      link: 'https://example.com/x',
    });
    const iUser = msg.indexOf('Usuario:');
    const iPin = msg.indexOf('PIN:');
    const iLink = msg.indexOf('Enlace:');
    const iInstruction = msg.indexOf('Abre este enlace');
    expect(iUser).toBeGreaterThanOrEqual(0);
    expect(iPin).toBeGreaterThan(iUser);
    expect(iLink).toBeGreaterThan(iPin);
    expect(iInstruction).toBeGreaterThan(iLink);
  });

  it('no incluye el nombre propio (solo el loginHandle) en el cuerpo del mensaje', () => {
    // El nombre completo del vendedor no forma parte del formato pedido —
    // solo loginHandle/pin/link, para no inflar el mensaje con datos que
    // no hacen falta para acceder.
    const msg = buildFullMessage({
      name: 'Guimar Viviana Garzón',
      loginHandle: 'guimar',
      pin: '123456',
      link: 'https://example.com/x',
    });
    expect(msg).not.toContain('Guimar Viviana Garzón');
  });
});
