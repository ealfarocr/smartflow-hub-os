import { MultiAgentConfig } from '@/types';

// La decisión REAL de a quién asignar una conversación nueva vive en
// functions/src/index.ts (assignConversationAdvisor, server-authoritative,
// dentro de una transacción). Este archivo es solo para que la UI de
// Multi-Agente pueda REFLEJAR y EDITAR la configuración con la misma
// semántica — nunca se usa para decidir una asignación real.

export interface EligibilityMember {
  id: string; // membership.id
  userId?: string | null;
  status: string;
  // LOOP — sin dato todavía (nadie escribió user_presence para esta persona)
  // se trata como 'off_shift' en TODO lado (ver Fase 21), nunca como
  // 'working' por defecto. undefined es intencional (no forzar el import de
  // OperationalStatus en cada llamador que todavía no tiene ese dato a mano).
  operationalStatus?: string;
}

export function getMemberIdentifier(m: EligibilityMember): string {
  return m.userId || m.id;
}

/**
 * Elegible por CONFIGURACIÓN para recibir leads por asignación AUTOMÁTICA:
 * active + incluido en el equipo (includedUserIds) + habilitado en
 * leadEnabledUserIds (o sin curar, en cuyo caso todo active+incluido es
 * elegible por defecto). A propósito NO mira operationalStatus — es la
 * base "quién está configurado para poder recibir leads cuando esté
 * trabajando", se usa para reconstruir/togglear leadEnabledUserIds sin que
 * alguien desaparezca de la config solo porque está en un café en ese
 * instante (ver isEligibleRightNow para la versión en tiempo real).
 * Independiente de allowedTools/panel access.
 */
export function isEligibleForAutoLeads(
  m: EligibilityMember,
  config: Pick<MultiAgentConfig, 'includedUserIds' | 'leadEnabledUserIds'>
): boolean {
  if (m.status !== 'active') return false;
  const identifier = getMemberIdentifier(m);
  if (!config.includedUserIds?.includes(identifier)) return false;
  if (config.leadEnabledUserIds == null) return true;
  return config.leadEnabledUserIds.includes(identifier);
}

/**
 * Elegible AHORA MISMO para recibir la próxima asignación automática —
 * isEligibleForAutoLeads + operationalStatus 'working' (LOOP Fase 6/15).
 * Debe reflejar EXACTAMENTE la condición de
 * functions/src/index.ts assignConversationAdvisor; esto es solo un espejo
 * para que la UI muestre lo mismo que decide el backend — la decisión real
 * siempre vive del lado server. Usar para mostrar "elegible ahora" en el
 * panel, NUNCA para reconstruir leadEnabledUserIds (eso es
 * isEligibleForAutoLeads, que es configuración, no estado del momento).
 */
export function isEligibleRightNow(
  m: EligibilityMember,
  config: Pick<MultiAgentConfig, 'includedUserIds' | 'leadEnabledUserIds'>
): boolean {
  return isEligibleForAutoLeads(m, config) && m.operationalStatus === 'working';
}

/**
 * Elegible para reclamar a mano una conversación sin asignar en Modo Libre:
 * active + incluido en el equipo + operationalStatus 'working' (LOOP Fase
 * 16 — recomendación aplicada: exigir 'working' también acá). A propósito
 * NO depende de leadEnabledUserIds — ese toggle solo gobierna la asignación
 * automática (ver MultiAgentView "Recibe leads"), no el reclamo manual.
 * Debe reflejar EXACTAMENTE functions/src/index.ts claimConversation.
 */
export function isEligibleForManualClaim(
  m: EligibilityMember,
  config: Pick<MultiAgentConfig, 'includedUserIds'>
): boolean {
  if (m.status !== 'active') return false;
  if (m.operationalStatus !== 'working') return false;
  return !!config.includedUserIds?.includes(getMemberIdentifier(m));
}
