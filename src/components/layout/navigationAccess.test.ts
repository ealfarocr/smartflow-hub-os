import { describe, it, expect } from 'vitest';
import { filterNavigation, type NavItemLike } from './navigationAccess';
import { allNavItems } from './MainLayout';
import { getEffectiveTools } from '@/utils/permissions';
import type { TenantFeatures } from '@/types';

// Se prueba contra el MENÚ REAL (allNavItems de MainLayout), no una copia: si
// alguien agrega mañana un ítem administrativo sin protección, estos tests lo
// tienen que atrapar.
const items = allNavItems as unknown as NavItemLike[];

// USADITOS tiene todas las features del plan encendidas — el caso que expone
// más superficie.
const todasLasFeatures = {
  hasMultiAgent: true,
  hasMultiAgentPanel: true,
  hasAiAgent: true,
  hasQualityAuditor: true,
  hasPaymentLinks: true,
  hasQuotes: true,
  hasCatalog: true,
  hasAgenda: true,
  hasIntegrations: true,
} as unknown as TenantFeatures;

const menuFor = (role: 'Owner' | 'Admin' | 'Asesor Comercial', allowedTools: string[] | null = null) =>
  filterNavigation(items, {
    isSuperAdmin: false,
    isImpersonating: false,
    role,
    effectiveTools: getEffectiveTools({ role, allowedTools }),
    features: todasLasFeatures,
  }).map((i) => i.name);

describe('Menú del Asesor Comercial (caso real: eduardo pruebas en el teléfono)', () => {
  const menu = menuFor('Asesor Comercial');

  const debeVer = ['Dashboard', 'Mis Tareas', 'CRM', 'WhatsApp', 'Agenda'];
  debeVer.forEach((name) => {
    it(`ve ${name}`, () => expect(menu).toContain(name));
  });

  it('el menú es EXACTAMENTE ese, sin nada de más', () => {
    expect([...menu].sort()).toEqual([...debeVer].sort());
  });

  const noDebeVer = [
    'Usuarios', 'Mi Suscripción', 'Multi-Agente', 'Agente IA', 'Auditor IA',
    'Integraciones', 'Configuración', 'Cobros', 'Cotizaciones', 'Catálogo',
    'Paquetes', 'Tienda Hub',
  ];
  noDebeVer.forEach((name) => {
    it(`ya NO ve ${name}`, () => expect(menu).not.toContain(name));
  });

  it('tampoco ve nada del Hub Maestro', () => {
    ['Inbox Admin', 'Academia', 'Partners'].forEach((n) => expect(menu).not.toContain(n));
  });

  it('aunque un admin le marque TODAS las herramientas, el menú sigue sin lo administrativo', () => {
    const conTodo = menuFor('Asesor Comercial', [
      'crm', 'conversaciones', 'multi-agent', 'ai-agent', 'auditoria',
      'pagos', 'cotizaciones', 'catalogo', 'agenda', 'usuarios', 'configuracion', 'integraciones',
    ]);
    ['Usuarios', 'Multi-Agente', 'Agente IA', 'Auditor IA', 'Integraciones', 'Configuración',
     'Mi Suscripción', 'Cobros', 'Cotizaciones', 'Catálogo', 'Paquetes', 'Tienda Hub']
      .forEach((n) => expect(conTodo).not.toContain(n));
    expect(conTodo).toContain('CRM');
  });
});

describe('Owner y Admin conservan todo', () => {
  it('el Owner ve las herramientas administrativas', () => {
    const menu = menuFor('Owner');
    ['Usuarios', 'Mi Suscripción', 'Multi-Agente', 'Agente IA', 'Auditor IA', 'Integraciones',
     'Configuración', 'Cobros', 'Cotizaciones', 'Catálogo', 'Paquetes', 'Tienda Hub']
      .forEach((n) => expect(menu).toContain(n));
  });

  it('el Admin también', () => {
    const menu = menuFor('Admin');
    ['Usuarios', 'Mi Suscripción', 'Multi-Agente', 'Agente IA', 'Auditor IA', 'Integraciones', 'Configuración']
      .forEach((n) => expect(menu).toContain(n));
  });
});

describe('SuperAdmin sin regresión', () => {
  it('en el Hub Maestro ve todo, incluidos los ítems propios', () => {
    const menu = filterNavigation(items, {
      isSuperAdmin: true,
      isImpersonating: false,
      role: undefined,
      effectiveTools: [],
      features: null,
    }).map((i) => i.name);
    ['Inbox Admin', 'Academia', 'Partners', 'Usuarios', 'Multi-Agente'].forEach((n) => expect(menu).toContain(n));
  });

  it('suplantando a un tenant deja de ver los ítems del Hub Maestro', () => {
    const menu = filterNavigation(items, {
      isSuperAdmin: true,
      isImpersonating: true,
      role: 'Owner',
      effectiveTools: getEffectiveTools({ role: 'Owner', allowedTools: null }),
      features: todasLasFeatures,
    }).map((i) => i.name);
    ['Inbox Admin', 'Academia', 'Partners'].forEach((n) => expect(menu).not.toContain(n));
    expect(menu).toContain('Usuarios');
  });
});

describe('Los feature flags del tenant siguen mandando', () => {
  it('sin el flag de Agenda, el Asesor no ve Agenda', () => {
    const menu = filterNavigation(items, {
      isSuperAdmin: false,
      isImpersonating: false,
      role: 'Asesor Comercial',
      effectiveTools: getEffectiveTools({ role: 'Asesor Comercial', allowedTools: null }),
      features: { ...todasLasFeatures, hasAgenda: false },
    }).map((i) => i.name);
    expect(menu).not.toContain('Agenda');
    expect(menu).toContain('CRM');
  });
});
