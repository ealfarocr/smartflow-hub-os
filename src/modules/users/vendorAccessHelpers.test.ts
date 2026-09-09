import { describe, it, expect } from 'vitest';
import { buildFullMessage, buildAccessLink } from './vendorAccessHelpers';

describe('buildAccessLink — construcción del enlace real de acceso individual', () => {
  it('caso real: eduardo pruebas / t-1788554584458', () => {
    const link = buildAccessLink('eduardopruebas', 't-1788554584458', 'eduardo pruebas');
    expect(link).toBe('https://hub.smartflow-suite.com/acceso?h=eduardopruebas&t=t-1788554584458&n=eduardo%20pruebas');
  });

  it('nombre con tildes se codifica correctamente', () => {
    const link = buildAccessLink('jose', 't-1', 'José Pérez');
    expect(link).toContain('n=Jos%C3%A9%20P%C3%A9rez');
  });

  it('nombre con espacios múltiples y símbolos no rompe el query string', () => {
    const link = buildAccessLink('ana', 't-1', 'Ana  M. Ñúñez & Cía');
    // No debe haber espacios ni "&"/"?" sin codificar colándose en los
    // valores — solo los separadores propios del query string (h=, &t=, &n=).
    const [, query] = link.split('?');
    const parts = query.split('&');
    expect(parts).toHaveLength(3);
    expect(parts[0].startsWith('h=')).toBe(true);
    expect(parts[1].startsWith('t=')).toBe(true);
    expect(parts[2].startsWith('n=')).toBe(true);
  });

  it('nunca usa /login — siempre construye sobre /acceso', () => {
    const link = buildAccessLink('michelle', 't-1', 'Michelle');
    expect(link).toContain('/acceso?');
    expect(link).not.toContain('/login');
  });
});

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

  it('pin:null (ver enlace existente) — nunca inventa ni muestra un PIN', () => {
    const msg = buildFullMessage({
      name: 'Eduardo Pruebas',
      loginHandle: 'eduardopruebas',
      pin: null,
      link: 'https://hub.smartflow-suite.com/acceso?h=eduardopruebas&t=t-1&n=Eduardo%20Pruebas',
    });
    expect(msg).not.toContain('PIN:');
    expect(msg).toContain('Usuario: eduardopruebas');
    expect(msg).toContain('Enlace: https://hub.smartflow-suite.com/acceso?h=eduardopruebas&t=t-1&n=Eduardo%20Pruebas');
    expect(msg).toContain('pedile a tu Owner/Admin que te genere uno nuevo');
  });
});
