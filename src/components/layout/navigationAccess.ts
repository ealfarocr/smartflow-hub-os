import { Role, TenantFeatures } from '@/types';
import { isAdminRole, ToolKey } from '@/utils/permissions';

// Filtrado del menú lateral — extraído de MainLayout.tsx para poder probarlo.
// El mismo <aside> sirve escritorio y móvil (en móvil solo se desplaza con
// translate-x), así que esta única función decide lo que se ve en los dos.
//
// Esto NO es la capa de seguridad: las rutas siguen protegidas por RoleGuard,
// FeatureGuard y ToolGuard, que son independientes y siguen denegando aunque
// alguien escriba la URL a mano. Acá solo se decide qué se muestra, para que
// nadie vea un botón que lo va a llevar a "Acceso restringido".

export interface NavItemLike {
  name: string;
  href: string;
  feature?: keyof TenantFeatures | null;
  toolKey?: ToolKey;
  superAdminOnly?: boolean;
  /** Administración del negocio sin herramienta propia (ej. Mi Suscripción). */
  adminOnly?: boolean;
}

export interface NavAccessContext {
  isSuperAdmin: boolean;
  isImpersonating: boolean;
  role: Role | undefined;
  effectiveTools: ToolKey[];
  features: Partial<TenantFeatures> | null | undefined;
}

export function canSeeNavItem(item: NavItemLike, ctx: NavAccessContext): boolean {
  // Inbox Admin y compañía: solo en el Hub Maestro (SuperAdmin sin suplantar).
  if (item.superAdminOnly) return ctx.isSuperAdmin && !ctx.isImpersonating;

  // SuperAdmin sin suplantar ve todo el Hub Maestro.
  if (ctx.isSuperAdmin && !ctx.isImpersonating) return true;

  // Ítems administrativos sin toolKey propia: decide el rol. Antes no tenían
  // filtro de ningún tipo, así que un vendedor veía "Mi Suscripción".
  if (item.adminOnly && !isAdminRole(ctx.role)) return false;

  // Herramienta por usuario. getEffectiveTools ya aplicó el techo por rol, así
  // que acá no hace falta repetirlo: un Asesor nunca trae herramientas
  // administrativas en esa lista.
  if (item.toolKey && !ctx.effectiveTools.includes(item.toolKey)) return false;

  // Feature flag del tenant.
  if (!item.feature) return true;
  return !!ctx.features?.[item.feature];
}

export function filterNavigation<T extends NavItemLike>(items: T[], ctx: NavAccessContext): T[] {
  return items.filter((item) => canSeeNavItem(item, ctx));
}
