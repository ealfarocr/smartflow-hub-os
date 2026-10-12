import type { Conversation, MultiAgentConfig, Role } from '@/types';
import { isAdminRole } from '@/utils/permissions';

// Lógica pura de las alertas de mensajes entrantes (sin React, sin Firestore,
// sin audio) — así se puede probar entera. El hook useInboundAlerts solo la
// conecta con la suscripción, el sonido y el título de la pestaña.

export interface AlertViewer {
  role: Role | undefined | null;
  /** Identificadores con los que este usuario aparece en conversation.advisorId
   *  (membership.userId || membership.id, y el uid de Auth). */
  identifiers: string[];
  /** multiAgentConfig.includedUserIds del tenant: quién puede reclamar. */
  includedUserIds: string[];
}

/**
 * Qué conversaciones le corresponden a quien mira.
 *
 * - Owner/Admin: todas las del tenant.
 * - Resto de roles: solo las asignadas a su identificador (advisorId — lo
 *   escribe assignConversationAdvisor en round-robin, claimConversation a mano
 *   o el dropdown "Asignar agente"), más las SIN asignar (advisorId '') que él
 *   mismo podría reclamar según claimConversation (está en includedUserIds).
 *
 * Ojo: las reglas de Firestore y la lista de /conversaciones NO restringen la
 * lectura por asesor (todo miembro lee todo el tenant); esta función decide
 * solo a quién se le AVISA, no qué puede ver.
 */
export function isConversationForViewer(conv: Pick<Conversation, 'advisorId'>, viewer: AlertViewer): boolean {
  if (isAdminRole(viewer.role)) return true;
  const advisorId = conv.advisorId || '';
  if (advisorId) return viewer.identifiers.includes(advisorId);
  return viewer.identifiers.some((id) => viewer.includedUserIds.includes(id));
}

export function includedUserIdsOf(config: Pick<MultiAgentConfig, 'includedUserIds'> | null | undefined): string[] {
  return Array.isArray(config?.includedUserIds) ? config!.includedUserIds : [];
}

function inboundMs(conv: Pick<Conversation, 'lastInboundDate'>): number {
  const t = conv.lastInboundDate ? Date.parse(conv.lastInboundDate) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/**
 * Detector de mensajes entrantes NUEVOS. Una instancia por suscripción
 * (= por tenant): al cambiar de tenant se crea otra y arranca sin historia.
 *
 * Se apoya en lastInboundDate (serverTimestamp que el webhook escribe SOLO en
 * un inbound), no en unreadCount, que también cambia al abrir una conversación
 * o al marcarla leída. Un outbound no toca lastInboundDate.
 *
 * - Primer snapshot: solo fija la línea base, nunca suena.
 * - Conversación ya vista: suena si su lastInboundDate avanzó.
 * - Conversación que aparece después (nueva, o que vuelve a entrar al filtro
 *   por cambio de status): suena solo si su último inbound es MÁS NUEVO que
 *   todo lo visto hasta ahora. No depende del reloj del navegador.
 */
export function createInboundDetector(tenantId: string) {
  const seen = new Map<string, number>();
  let highWater = 0;
  let primed = false;

  return {
    ingest(conversations: Conversation[]): Conversation[] {
      const own = conversations.filter((c) => c.tenantId === tenantId);
      const fresh: Conversation[] = [];

      if (!primed) {
        for (const c of own) {
          const t = inboundMs(c);
          seen.set(c.id, t);
          if (t > highWater) highWater = t;
        }
        primed = true;
        return fresh;
      }

      let nextHigh = highWater;
      for (const c of own) {
        const t = inboundMs(c);
        const prev = seen.get(c.id);
        const isNew = prev === undefined ? t > highWater : t > prev;
        seen.set(c.id, t);
        if (t > nextHigh) nextHigh = t;
        if (isNew) fresh.push(c);
      }
      highWater = nextHigh;
      return fresh;
    },
  };
}

export interface AlertDecisionContext {
  viewer: AlertViewer;
  /** Conversación abierta en pantalla (solo cuenta si la ruta es /conversaciones). */
  openConversationId: string | null;
  onConversationsRoute: boolean;
  tabVisible: boolean;
}

/** De las conversaciones con inbound nuevo, ¿alguna merece sonido? */
export function shouldPlayForFresh(fresh: Conversation[], ctx: AlertDecisionContext): boolean {
  return fresh.some((c) => {
    if (!isConversationForViewer(c, ctx.viewer)) return false;
    const viewingIt = ctx.tabVisible && ctx.onConversationsRoute && ctx.openConversationId === c.id;
    return !viewingIt;
  });
}

/** No leídos de las conversaciones que le corresponden a quien mira. */
export function countUnreadForViewer(conversations: Conversation[], viewer: AlertViewer): number {
  let total = 0;
  for (const c of conversations) {
    const n = Number(c.unreadCount) || 0;
    if (n > 0 && isConversationForViewer(c, viewer)) total += n;
  }
  return total;
}

// ---------------------------------------------------------------- título

const TITLE_PREFIX = /^\(\d+\+?\)\s*/;

export function stripUnreadPrefix(title: string): string {
  return title.replace(TITLE_PREFIX, '');
}

export function buildTitleWithUnread(baseTitle: string, unread: number): string {
  const base = stripUnreadPrefix(baseTitle);
  if (unread <= 0) return base;
  return `(${unread > 99 ? '99+' : unread}) ${base}`;
}

// ---------------------------------------------------------------- preferencia

const PREF_PREFIX = 'smartflow:inbound-sound:';

export function inboundSoundPrefKey(userId: string | null | undefined): string {
  return `${PREF_PREFIX}${userId || 'anon'}`;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Por defecto ACTIVADO: solo un '0' explícito lo apaga. */
export function readInboundSoundEnabled(userId: string | null | undefined, storage: StorageLike | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(inboundSoundPrefKey(userId)) !== '0';
  } catch {
    return true;
  }
}

export function writeInboundSoundEnabled(userId: string | null | undefined, enabled: boolean, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(inboundSoundPrefKey(userId), enabled ? '1' : '0');
  } catch { /* storage bloqueado: la preferencia vive solo en memoria */ }
}
