import type { Role } from '@/types';
import { isAdminRole } from '@/utils/permissions';

/**
 * ¿Se muestra el botón "Tomar"? Solo UI: el permiso real lo sigue decidiendo
 * claimConversation en el backend.
 *
 * - Con la conversación ya asignada: nunca.
 * - Modo Libre (asignación automática apagada): sí, es el flujo de ese modo.
 * - Asignación automática activa: la conversación llega ya asignada por el
 *   round-robin, así que el asesor NO ve "Tomar". Owner/Admin lo conservan
 *   como contingencia para una conversación que excepcionalmente quedó sin
 *   asesor (nadie elegible en ese momento).
 */
export function canShowTakeButton(
  conv: { advisorId?: string | null },
  autoDistributionEnabled: boolean,
  role: Role | undefined | null
): boolean {
  if (conv.advisorId) return false;
  if (!autoDistributionEnabled) return true;
  return isAdminRole(role);
}
