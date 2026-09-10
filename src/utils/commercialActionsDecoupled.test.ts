import { describe, it, expect } from 'vitest';

// PRINCIPIO: MODULE_ACCESS (a qué pantallas navega) y COMMERCIAL_ACTION (qué
// puede hacer atendiendo a un cliente) son cosas distintas.
//
// El Asesor Comercial NO navega a /catalogo, /cotizaciones, /pagos, /paquetes
// ni /tienda, pero SÍ tiene que poder, desde una conversación de WhatsApp o
// desde el CRM, consultar el catálogo que armó el Owner, elegir un producto,
// mandar una cotización y generar un enlace de cobro.
//
// Este test es un candado sobre esa separación: si alguien mañana condiciona
// una acción dentro de conversaciones o CRM con hasTool/getEffectiveTools/
// allowedTools, le estaría atando la acción comercial al permiso de navegación
// y le rompería el trabajo al vendedor. Falla acá antes de llegar a producción.
//
// Se lee el código fuente con import.meta.glob (de Vite) en vez de fs/path para
// no arrastrar los tipos de Node al tsconfig de la app.
const fuentes = import.meta.glob(
  ['/src/modules/conversations/**/*.{ts,tsx}', '/src/modules/crm/**/*.{ts,tsx}'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const PERMISSION_SYMBOLS = ['hasTool', 'getEffectiveTools', 'allowedTools', 'ADMIN_ONLY_TOOLS', 'ADVISOR_TOOLS'];

describe('Las acciones comerciales no dependen del permiso de navegación', () => {
  it('se está leyendo código de verdad (si el glob queda vacío, el test no probaría nada)', () => {
    expect(Object.keys(fuentes).length).toBeGreaterThan(0);
  });

  it('conversaciones (WhatsApp) y CRM no consultan permisos de herramientas', () => {
    const ofensores: string[] = [];
    Object.entries(fuentes).forEach(([file, code]) => {
      if (/\.test\.tsx?$/.test(file)) return;
      PERMISSION_SYMBOLS.forEach((sym) => {
        if (code.includes(sym)) ofensores.push(`${file} usa ${sym}`);
      });
    });
    expect(ofensores).toEqual([]);
  });

  it('la conversación sigue teniendo a mano los recursos comerciales del negocio', () => {
    const view = fuentes['/src/modules/conversations/ConversationsPageView.tsx'];
    expect(view).toBeDefined();
    // Catálogo: consultar y elegir un producto existente.
    expect(view).toContain('CatalogService');
    expect(view).toContain('showCatalogDrawer');
    // Cobro: generar el enlace de pago desde la conversación.
    expect(view).toContain('CreatePaymentLinkModal');
    // Cotización: mandarla por el flujo comercial.
    expect(view).toContain('quoteMessage');
  });
});
