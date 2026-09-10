import { describe, it, expect } from 'vitest';
import {
  getEffectiveTools,
  hasTool,
  getDefaultToolsForRole,
  isAdminRole,
  ADVISOR_TOOLS,
  ADMIN_ONLY_TOOLS,
  ALL_TOOL_KEYS,
  type ToolKey,
} from './permissions';

// Caso real reportado en producción: `eduardo pruebas`, ASESOR COMERCIAL del
// tenant USADITOS, entrando por código de acceso desde el teléfono, veía
// Usuarios, Mi Suscripción, Multi-Agente, Agente IA, Auditor IA e
// Integraciones. Su membership no tiene allowedTools, así que caía en el
// fallback por rol... que devolvía TODAS las herramientas para TODOS los roles.
const asesorSinConfigurar = { role: 'Asesor Comercial' as const, allowedTools: null };

describe('Preset del Asesor Comercial', () => {
  it('el fallback por rol ya NO le da todas las herramientas', () => {
    const tools = getDefaultToolsForRole('Asesor Comercial');
    expect(tools).not.toEqual(ALL_TOOL_KEYS);
    expect(tools).toEqual(ADVISOR_TOOLS);
  });

  it('ve exactamente sus herramientas comerciales', () => {
    const tools = getEffectiveTools(asesorSinConfigurar);
    expect([...tools].sort()).toEqual([...ADVISOR_TOOLS].sort());
  });

  it('el preset final es solo atención y ventas', () => {
    expect([...ADVISOR_TOOLS].sort()).toEqual(['agenda', 'conversaciones', 'crm']);
  });

  const comerciales: ToolKey[] = ['crm', 'conversaciones', 'agenda'];
  comerciales.forEach((tool) => {
    it(`mantiene acceso a ${tool}`, () => {
      expect(hasTool(asesorSinConfigurar, tool)).toBe(true);
    });
  });

  // Los MÓDULOS de estos quedan cerrados; las acciones comerciales desde la
  // conversación no pasan por acá (ver navigationAccess.test.ts).
  const administrativas: ToolKey[] = [
    'usuarios', 'configuracion', 'integraciones', 'multi-agent', 'ai-agent', 'auditoria',
    'catalogo', 'cotizaciones', 'pagos',
  ];
  administrativas.forEach((tool) => {
    it(`ya NO ve ${tool}`, () => {
      expect(hasTool(asesorSinConfigurar, tool)).toBe(false);
    });
  });
});

describe('El rol es el techo: allowedTools solo puede estrechar, nunca ampliar', () => {
  it('aunque un admin le marque herramientas administrativas, el Asesor no las recibe', () => {
    const conTodoMarcado = { role: 'Asesor Comercial' as const, allowedTools: [...ALL_TOOL_KEYS] };
    const tools = getEffectiveTools(conTodoMarcado);
    ADMIN_ONLY_TOOLS.forEach((t) => expect(tools).not.toContain(t));
    // Y conserva lo suyo.
    expect(tools).toContain('crm');
    expect(tools).toContain('conversaciones');
    expect(tools).toContain('agenda');
  });

  it('allowedTools sí puede quitarle herramientas comerciales', () => {
    const recortado = { role: 'Asesor Comercial' as const, allowedTools: ['crm'] as string[] };
    expect(getEffectiveTools(recortado)).toEqual(['crm']);
  });

  it('allowedTools vacío significa "ninguna", no "sin configurar"', () => {
    expect(getEffectiveTools({ role: 'Asesor Comercial' as const, allowedTools: [] })).toEqual([]);
  });
});

describe('Owner y Admin no pierden nada', () => {
  it('el Owner ve todo, incluso con allowedTools recortado (nunca queda encerrado fuera de su negocio)', () => {
    expect(getEffectiveTools({ role: 'Owner' as const, allowedTools: [] })).toEqual(ALL_TOOL_KEYS);
  });

  it('el Admin sin configurar ve todo', () => {
    expect(getEffectiveTools({ role: 'Admin' as const, allowedTools: null })).toEqual(ALL_TOOL_KEYS);
  });

  it('el Admin conserva los paneles administrativos', () => {
    ADMIN_ONLY_TOOLS.forEach((t) => {
      expect(hasTool({ role: 'Admin' as const, allowedTools: null }, t)).toBe(true);
    });
  });

  it('isAdminRole distingue bien quién administra', () => {
    expect(isAdminRole('Owner')).toBe(true);
    expect(isAdminRole('Admin')).toBe(true);
    expect(isAdminRole('Asesor Comercial')).toBe(false);
    expect(isAdminRole('Técnico')).toBe(false);
    expect(isAdminRole('Solo lectura')).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });
});

describe('Sin membership no hay herramientas', () => {
  it('null/undefined -> lista vacía', () => {
    expect(getEffectiveTools(null)).toEqual([]);
    expect(getEffectiveTools(undefined)).toEqual([]);
  });
});
