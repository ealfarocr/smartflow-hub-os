import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useConversationStore } from '@/stores/conversationStore';
import { ConversationService } from '@/services/firebase/ConversationService';
import { getEffectiveTools } from '@/utils/permissions';
import { getMemberIdentifier } from '@/utils/multiAgentEligibility';
import {
  AlertViewer, buildTitleWithUnread, countUnreadForViewer, createInboundDetector,
  includedUserIdsOf, readInboundSoundEnabled, shouldPlayForFresh, stripUnreadPrefix,
  writeInboundSoundEnabled,
} from '@/utils/inboundAlerts';
import { armInboundAudio, playInboundBeep } from '@/utils/inboundSound';
import type { Conversation } from '@/types';

const PREF_EVENT = 'smartflow:inbound-sound-pref';

/** Preferencia "Sonido de mensajes" por usuario y dispositivo (localStorage). */
export function useInboundSoundPreference() {
  const userId = useAuthStore((s) => s.user?.id);
  // El valor se lee del storage en cada render (la clave incluye el usuario, así
  // que al cambiar de usuario en el mismo equipo sale SU preferencia); este
  // contador solo fuerza el re-render cuando cambia desde el botón u otra pestaña.
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const enabled = readInboundSoundEnabled(userId);

  useEffect(() => {
    window.addEventListener(PREF_EVENT, bump);
    window.addEventListener('storage', bump);
    return () => { window.removeEventListener(PREF_EVENT, bump); window.removeEventListener('storage', bump); };
  }, []);

  const set = useCallback((next: boolean) => {
    writeInboundSoundEnabled(userId, next);
    window.dispatchEvent(new Event(PREF_EVENT));
  }, [userId]);

  return { enabled, set };
}

/**
 * Alertas globales de mensajes entrantes. Se monta UNA vez (MainLayout).
 * Sonido + contador en el título de la pestaña. No usa FCM ni service worker:
 * solo funciona con SmartFlow abierto (en primer plano o en segundo plano).
 */
export function useInboundAlerts() {
  const { user, activeMembership, impersonatedName } = useAuthStore();
  const multiAgentConfig = useSettingsStore((s) => s.multiAgentConfig);
  const { pathname } = useLocation();
  const { enabled: soundEnabled } = useInboundSoundPreference();

  const tenantId = activeMembership?.tenantId;
  // Sin acceso a WhatsApp no hay nada que avisar. El SuperAdmin que está de
  // visita suplantando un negocio tampoco recibe sus avisos.
  const canUseConversations = !!activeMembership
    && getEffectiveTools(activeMembership).includes('conversaciones')
    && !impersonatedName;

  const viewer: AlertViewer = {
    role: activeMembership?.role,
    identifiers: [activeMembership ? getMemberIdentifier(activeMembership) : '', user?.id || ''].filter(Boolean),
    includedUserIds: includedUserIdsOf(multiAgentConfig),
  };

  // Lo que cambia seguido va en un ref: la suscripción NO se reinicia (y por
  // tanto no se pierde la línea base) cuando cambia la ruta, la config o la
  // preferencia — solo cuando cambia el tenant.
  const live = useRef({ viewer, soundEnabled, pathname });
  useEffect(() => { live.current = { viewer, soundEnabled, pathname }; });

  const [unread, setUnread] = useState(0);

  useEffect(() => { armInboundAudio(); }, []);

  useEffect(() => {
    if (!tenantId || !canUseConversations) return;

    // Detector nuevo por tenant: sin historia, su primer snapshot solo fija la base.
    const detector = createInboundDetector(tenantId);
    const unsubscribe = ConversationService.subscribeToInbox(tenantId, (conversations: Conversation[]) => {
      const cur = live.current;
      const fresh = detector.ingest(conversations);
      setUnread(countUnreadForViewer(conversations, cur.viewer));

      if (!cur.soundEnabled || fresh.length === 0) return;
      const play = shouldPlayForFresh(fresh, {
        viewer: cur.viewer,
        openConversationId: useConversationStore.getState().activeConversation,
        onConversationsRoute: cur.pathname.startsWith('/conversaciones'),
        tabVisible: typeof document === 'undefined' || document.visibilityState === 'visible',
      });
      if (play) playInboundBeep();
    });

    return () => { unsubscribe(); setUnread(0); };
  }, [tenantId, canUseConversations]);

  // Contador en el título. Se parte del título que haya (no se fija uno propio)
  // y se restaura al quedar en cero, al cambiar de negocio o al salir.
  useEffect(() => {
    const current = document.title;
    document.title = buildTitleWithUnread(current, unread);
    return () => { document.title = stripUnreadPrefix(document.title); };
  }, [unread]);
}
