// Autorización compartida: "¿puede este caller administrar el equipo de
// ESTE tenant?" — SuperAdmin siempre, o Owner/Admin con membership activa
// EN ESE MISMO tenant (nunca en otro — el lookup ya viene scoped por
// tenantId antes de llegar acá). Usado por setMembershipActive
// (activar/desactivar acceso) — deliberadamente separado de
// assertCallerIsTenantAdmin (usado hoy por renameDevice/revokeDevice) para
// no tocar esa función compartida sin necesidad; ambas terminan expresando
// la misma regla, esta además admite el bypass de SuperAdmin.

export interface TenantAdminAuthInput {
  isSuperAdmin: boolean;
  callerMembership: { status: string; role: string } | null;
}

export interface TenantAdminAuthResult {
  allowed: boolean;
  reason?: 'no-active-admin';
}

export function checkTenantAdminAuth(input: TenantAdminAuthInput): TenantAdminAuthResult {
  if (input.isSuperAdmin) return { allowed: true };
  if (
    input.callerMembership?.status === 'active' &&
    (input.callerMembership.role === 'Owner' || input.callerMembership.role === 'Admin')
  ) {
    return { allowed: true };
  }
  return { allowed: false, reason: 'no-active-admin' };
}
