import { Membership, Role } from '@/types';

// Fuente única de verdad para "control de herramientas por usuario". El rol
// sigue siendo el techo de seguridad real (RoleGuard + firestore.rules ya lo
// exigen para Usuarios/Configuración/Integraciones, y eso NO cambia acá) —
// esto solo agrega una capa que puede ESTRECHAR lo que un usuario puntual ve
// dentro de lo que su rol ya permite, nunca ampliarlo por encima del rol.
//
// Dashboard y Mis Tareas quedan deliberadamente FUERA de la lista de
// herramientas restringibles: son el aterrizaje post-login, y no queremos
// que una configuración accidental deje a alguien sin ningún lugar al que
// entrar.
export type ToolKey =
  | 'crm'
  | 'conversaciones'
  | 'multi-agent'
  | 'ai-agent'
  | 'auditoria'
  | 'pagos'
  | 'cotizaciones'
  | 'catalogo'
  | 'agenda'
  | 'usuarios'
  | 'configuracion'
  | 'integraciones';

export const ALL_TOOL_KEYS: ToolKey[] = [
  'crm', 'conversaciones', 'multi-agent', 'ai-agent', 'auditoria',
  'pagos', 'cotizaciones', 'catalogo', 'agenda', 'usuarios', 'configuracion', 'integraciones',
];

export const TOOL_LABELS: Record<ToolKey, string> = {
  crm: 'CRM',
  conversaciones: 'WhatsApp',
  'multi-agent': 'Multi-Agente',
  'ai-agent': 'Agente IA',
  auditoria: 'Auditor IA',
  pagos: 'Links de Pago',
  cotizaciones: 'Cotizaciones',
  catalogo: 'Catálogo',
  agenda: 'Agenda',
  usuarios: 'Usuarios',
  configuracion: 'Configuración',
  integraciones: 'Integraciones',
};

// Herramientas que además exigen rol Admin/Owner por su propio RoleGuard —
// se listan acá solo para que la UI de edición pueda deshabilitar/aclarar
// esos toggles cuando el usuario editado no tiene ese rol (el toggle en sí
// nunca "eleva" nada: RoleGuard sigue siendo la puerta real e independiente).
// Herramientas cuya INTERFAZ es administrativa: solo Admin/Owner. Multi-Agente,
// Agente IA y Auditor IA entran acá porque sus paneles son de configuración y
// supervisión del negocio — los procesos de fondo siguen corriendo igual para
// todos (el Auditor sigue analizando todas las conversaciones del tenant, el
// Agente IA sigue respondiendo, y el asesor sigue siendo elegible para recibir
// leads del Multi-Agente); lo único que cambia es quién puede ver y tocar esos
// paneles.
export const ADMIN_ONLY_TOOLS: ToolKey[] = [
  'usuarios', 'configuracion', 'integraciones', 'multi-agent', 'ai-agent', 'auditoria',
];

// Roles que pueden ver las interfaces administrativas.
const ADMIN_ROLES: Role[] = ['Owner', 'Admin'];

export function isAdminRole(role: Role | undefined | null): boolean {
  return !!role && ADMIN_ROLES.includes(role);
}

// Fallback por rol para memberships sin allowedTools (todas las de hoy):
// reproduce EXACTAMENTE el comportamiento actual, donde ningún rol tiene
// restricción de herramientas más allá de lo que ya impone RoleGuard — así,
// el día que esto se despliega, nadie pierde ni gana acceso hasta que un
// Admin/Owner edite explícitamente a una persona. Mapeado por rol (no un
// valor fijo) a propósito: es el punto natural para diferenciar defaults por
// rol más adelante sin tocar getEffectiveTools.
// Preset del ASESOR COMERCIAL: solo operación comercial. Cobros va INCLUIDO a
// propósito — el vendedor genera enlaces de pago y se los manda al cliente;
// lo que no puede tocar es la administración financiera del negocio (cuentas,
// métodos de pago, parámetros globales), que vive en Configuración y ya está
// cerrada por rol.
export const ADVISOR_TOOLS: ToolKey[] = [
  'crm', 'conversaciones', 'pagos', 'cotizaciones', 'catalogo', 'agenda',
];

// Fallback por rol para memberships sin allowedTools.
//
// FIX P0 — antes esto devolvía ALL_TOOL_KEYS para TODOS los roles, así que un
// Asesor Comercial sin allowedTools configurado (o sea, todos los vendedores de
// hoy) veía y podía abrir Multi-Agente, Agente IA, Auditor IA, Mi Suscripción,
// Usuarios e Integraciones. Era el fallback demasiado permisivo, no un problema
// del login por código ni del rol: el rol se cargaba bien, simplemente no se
// usaba para nada acá.
//
// Técnico y 'Solo lectura' se dejan como estaban a propósito: no fueron parte
// del pedido, no hay usuarios de esos roles en el tenant afectado, y definir su
// alcance es una decisión de producto — pero quedan recortados igual por
// ADMIN_ONLY_TOOLS, que ahora sí se aplica en getEffectiveTools.
const ROLE_DEFAULT_TOOLS: Record<Role, ToolKey[]> = {
  Owner: ALL_TOOL_KEYS,
  Admin: ALL_TOOL_KEYS,
  'Asesor Comercial': ADVISOR_TOOLS,
  Técnico: ALL_TOOL_KEYS,
  'Solo lectura': ALL_TOOL_KEYS,
};

export function getDefaultToolsForRole(role: Role): ToolKey[] {
  return [...(ROLE_DEFAULT_TOOLS[role] || ALL_TOOL_KEYS)];
}

// Presets opcionales para la UI de edición — puntos de partida, no reglas
// forzadas; el admin puede seguir marcando/desmarcando libremente. Desactivar
// una herramienta acá SOLO oculta el panel/bloquea la ruta para esa persona
// — no apaga Multi-Agente/Agente IA en background, ni excluye al asesor del
// Auditor IA (que sigue analizando todas las conversaciones del tenant
// independientemente de quién puede ver su panel).
export const TOOL_PRESETS: Record<string, ToolKey[]> = {
  Vendedor: ['crm', 'conversaciones', 'cotizaciones', 'catalogo'],
  Supervisor: ['crm', 'conversaciones', 'multi-agent', 'cotizaciones', 'catalogo', 'agenda', 'auditoria'],
  Admin: [...ALL_TOOL_KEYS],
};

/**
 * Herramientas efectivas de una membership: la lista explícita si existe,
 * o el fallback por rol si no (memberships antiguas, compatibilidad).
 * Owner SIEMPRE ve todo — es la única excepción "por encima" del propio
 * allowedTools, para que nunca quede un Owner accidentalmente encerrado
 * fuera de su propio negocio.
 */
export function getEffectiveTools(membership: Pick<Membership, 'role' | 'allowedTools'> | null | undefined): ToolKey[] {
  if (!membership) return [];
  if (membership.role === 'Owner') return [...ALL_TOOL_KEYS];

  // allowedTools presente (incluso []) = lista explícita del admin — [] es
  // válido y significa "ninguna", no "sin configurar". Solo null/undefined
  // cae al fallback por rol (memberships antiguas).
  const requested = membership.allowedTools
    ? membership.allowedTools.filter((t): t is ToolKey => ALL_TOOL_KEYS.includes(t as ToolKey))
    : getDefaultToolsForRole(membership.role);

  // EL ROL ES EL TECHO, y acá es donde por fin se aplica. El comentario de
  // arriba de este archivo ya prometía que allowedTools solo puede ESTRECHAR
  // dentro de lo que el rol permite y nunca ampliarlo por encima, pero nada lo
  // hacía cumplir: una lista explícita con herramientas administrativas se las
  // concedía igual a un Asesor. Ahora se recorta acá, en un solo lugar, así el
  // menú y los guards de ruta heredan la misma regla sin poder desincronizarse.
  if (isAdminRole(membership.role)) return requested;
  return requested.filter((t) => !ADMIN_ONLY_TOOLS.includes(t));
}

export function hasTool(membership: Pick<Membership, 'role' | 'allowedTools'> | null | undefined, tool: ToolKey): boolean {
  return getEffectiveTools(membership).includes(tool);
}
