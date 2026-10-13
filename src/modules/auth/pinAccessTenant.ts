import type { Membership } from '@/types';
import type { VendorIdentity } from '@/utils/deviceTrust';

// Misma clave que lee authStore.initializeAuthListener para resolver la
// membership activa de usuarios con más de un negocio.
export const ACTIVE_TENANT_KEY = 'psmx_active_tenant';

interface LinkParams { h: string | null; t: string | null; n: string | null }

/**
 * Identidad con la que arranca la pantalla de acceso. Un enlace explícito
 * (?h=&t=&n=) GANA sobre la identidad recordada: solo se reutiliza la
 * recordada cuando es la MISMA persona en el MISMO negocio del enlace. Si es
 * de otro negocio se ignora (sin borrarla) y el flujo sigue con el del enlace.
 * Sin enlace completo, manda la recordada.
 */
export function resolveAccessIdentity(link: LinkParams, remembered: VendorIdentity | null): VendorIdentity | null {
  if (link.h && link.t && link.n) {
    if (remembered && remembered.tenantId === link.t && remembered.loginHandle === link.h) return remembered;
    return { loginHandle: link.h, tenantId: link.t, displayName: decodeURIComponent(link.n) };
  }
  return remembered;
}

/**
 * La entrada rápida (sesión viva o credencial de dispositivo) solo aplica si
 * la identidad mostrada ES la recordada: la credencial de dispositivo y la
 * sesión pertenecen a esa persona en ese negocio, no a la del enlace.
 */
export function isSameIdentity(a: VendorIdentity | null, b: VendorIdentity | null): boolean {
  return !!a && !!b && a.tenantId === b.tenantId && a.loginHandle === b.loginHandle;
}

type StorageLike = Pick<Storage, 'setItem' | 'removeItem'>;

/**
 * Fija el negocio activo ANTES de signInWithCustomToken (authStore reacciona
 * al instante a la sesión). Solo debe recibir el tenantId que el SERVIDOR
 * validó (loginWithPin / loginWithDevice), nunca el del enlace sin validar.
 * Se limpia sessionStorage porque, si tuviera un valor viejo, authStore lo
 * prefiere sobre localStorage.
 */
export function persistValidatedTenant(
  tenantId: string,
  local: StorageLike = localStorage,
  session: StorageLike = sessionStorage,
): void {
  local.setItem(ACTIVE_TENANT_KEY, tenantId);
  session.removeItem(ACTIVE_TENANT_KEY);
}

interface TenantStoreLike {
  getState: () => {
    activeMembership: Pick<Membership, 'tenantId'> | null;
    setActiveTenant: (tenantId: string) => void | Promise<void>;
  };
}

/**
 * Red de seguridad posterior al sign-in: si ya había una sesión del mismo uid,
 * authStore no vuelve a resolver y puede quedar en otro negocio. Cambia al
 * validado solo si el usuario tiene membership ahí (setActiveTenant no crea
 * nada para quien no es SuperAdmin). Devuelve si quedó en ese negocio.
 */
export async function ensureActiveTenant(tenantId: string, store: TenantStoreLike): Promise<boolean> {
  if (store.getState().activeMembership?.tenantId === tenantId) return true;
  await store.getState().setActiveTenant(tenantId);
  return store.getState().activeMembership?.tenantId === tenantId;
}
