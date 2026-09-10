import { describe, it, expect } from 'vitest';
import { isAdminRole } from '@/utils/permissions';

// LandingRedirect decide el destino por defecto con esta única regla. Se prueba
// la regla, no el render: el componente es un Navigate de una línea.
const landingFor = (role: string | undefined) =>
  isAdminRole(role as never) ? '/dashboard' : '/conversaciones';

describe('A dónde aterriza cada rol al entrar', () => {
  it('el Asesor Comercial cae directo en las conversaciones, sin rebotar por el Dashboard', () => {
    expect(landingFor('Asesor Comercial')).toBe('/conversaciones');
  });

  it('Owner y Admin conservan el Dashboard', () => {
    expect(landingFor('Owner')).toBe('/dashboard');
    expect(landingFor('Admin')).toBe('/dashboard');
  });

  it('los demás roles operativos también entran a trabajar', () => {
    expect(landingFor('Técnico')).toBe('/conversaciones');
    expect(landingFor('Solo lectura')).toBe('/conversaciones');
  });

  it('sin rol resuelto todavía, no se lo manda al panel de administración', () => {
    expect(landingFor(undefined)).toBe('/conversaciones');
  });
});
