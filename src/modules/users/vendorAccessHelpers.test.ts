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

  it('el nombre completo del vendedor no forma parte del formato pedido (buildFullMessage ni siquiera acepta ese campo)', () => {
    // Antes se pasaba `name` sin usarlo; ahora el tipo de buildFullMessage
    // (Pick<VendorAccessData, 'loginHandle'|'pin'|'link'>) directamente no
    // lo acepta — solo loginHandle/pin/link llegan al mensaje.
    const msg = buildFullMessage({
      loginHandle: 'guimar',
      pin: '123456',
      link: 'https://example.com/x',
    });
    expect(msg).not.toContain('Guimar');
  });

  it('pin:null (ver enlace existente) — nunca inventa ni muestra un PIN', () => {
    const msg = buildFullMessage({
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

describe('VendorAccessData — AJUSTE UX: usuario sin PIN (pinConfigured:false)', () => {
  it('el estado "no configurado" no incluye datos como si el acceso ya estuviera listo', () => {
    // No es una función a testear en sí (eso vive en el componente), pero
    // fija por contrato el shape que UsersManagementView arma para este
    // caso — pinConfigured:false implica loginHandle/link vacíos, nunca
    // valores inventados o de una versión anterior.
    const notConfigured: import('./vendorAccessHelpers').VendorAccessData = {
      membershipId: 'm1',
      name: 'Eduardo Pruebas',
      loginHandle: '',
      pin: null,
      link: '',
      pinConfigured: false,
      accessStatus: 'active',
    };
    expect(notConfigured.pinConfigured).toBe(false);
    expect(notConfigured.loginHandle).toBe('');
    expect(notConfigured.link).toBe('');
    expect(notConfigured.pin).toBeNull();
  });
});
