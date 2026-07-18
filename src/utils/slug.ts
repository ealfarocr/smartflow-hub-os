/**
 * Genera el tenant id / slug canónico a partir del nombre del negocio.
 *
 * IMPORTANTE: esta es la ÚNICA fuente de verdad para slugificar el id de un
 * tenant. Debe usarse en TODOS los flujos de registro (Checkout, Onboarding,
 * MagicOnboarding) para que un mismo nombre produzca SIEMPRE el mismo id y no
 * se creen tenants/membresías duplicados.
 *
 * Usa NFD para transliterar acentos correctamente (José→jose, Zapatería→
 * zapateria) en lugar de eliminar la letra acentuada (José→jos, Zapatería→
 * zapatera), que era el bug que generaba slugs divergentes.
 */
export const slugifyTenantId = (name: string): string =>
  (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quitar marcas diacríticas combinantes
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 20);
