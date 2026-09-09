// Helpers puros (sin componentes) para VendorAccessModal — separados a
// propósito en su propio archivo: un .tsx que exporta un componente Y
// funciones sueltas rompe el Fast Refresh de Vite (react-refresh/
// only-export-components). Todo lo testeable vive acá.

export interface VendorAccessData {
  name: string;
  loginHandle: string;
  // null = no se puede/debe mostrar — o porque este modal se abrió para VER
  // el acceso ya existente (vendor_credentials guarda solo el hash, nunca
  // el PIN en texto plano) o porque nunca se generó uno. Nunca se inventa
  // ni se muestra un PIN viejo — "Generar nuevo PIN" es una acción aparte,
  // explícita, que sí lo muestra (una sola vez, recién generado).
  pin: string | null;
  link: string;
  // Estado real de la membership (active/pending/suspended/...), solo para
  // mostrar contexto — no cambia nada de lo que el modal permite hacer.
  accessStatus?: string;
}

export const ACCESS_STATUS_LABEL: Record<string, string> = {
  active: 'Acceso activo',
  pending: 'Generado, todavía sin usar',
  suspended: 'Desactivado',
  prepared: 'Preparado',
  draft: 'Borrador',
};

// Copia al portapapeles. navigator.clipboard.writeText requiere contexto
// seguro (HTTPS/localhost) y permiso del navegador — si falla por cualquier
// motivo (contexto no seguro, permiso denegado, navegador viejo), cae al
// fallback clásico de textarea oculto + execCommand('copy'), que funciona
// en prácticamente cualquier navegador incluso sin Clipboard API.
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // sigue al fallback de abajo
    }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

const ACCESS_BASE_URL = 'https://hub.smartflow-suite.com/acceso';

/**
 * Construye el link real de acceso individual — el mismo formato que
 * handleGeneratePin ya armaba, ahora compartido con "ver enlace existente"
 * (el ícono 🔗) para no duplicarlo. loginHandle y name se codifican con
 * encodeURIComponent — nombres con espacios/tildes/símbolos (p. ej.
 * "eduardo pruebas", "José") tienen que sobrevivir el viaje por la URL
 * intactos, no romper el query string ni quedar mal decodificados.
 */
export function buildAccessLink(loginHandle: string, tenantId: string, name: string): string {
  return `${ACCESS_BASE_URL}?h=${encodeURIComponent(loginHandle)}&t=${encodeURIComponent(tenantId)}&n=${encodeURIComponent(name)}`;
}

export function buildFullMessage(data: VendorAccessData): string {
  const lines = ['Acceso SmartFlow', `Usuario: ${data.loginHandle}`];
  if (data.pin) lines.push(`PIN: ${data.pin}`);
  lines.push(`Enlace: ${data.link}`, '');
  lines.push(
    data.pin
      ? 'Abre este enlace una sola vez desde tu teléfono. Después el dispositivo quedará reconocido y solo necesitarás tu PIN.'
      : 'Abre este enlace desde tu teléfono y usá tu PIN para entrar. Si no tenés PIN o lo olvidaste, pedile a tu Owner/Admin que te genere uno nuevo.'
  );
  return lines.join('\n');
}
