import { create } from 'zustand';
import { Conversation, Message } from '@/types';
import { ConversationService } from '@/services/firebase/ConversationService';

interface ConversationState {
  conversations: Conversation[];
  activeConversation: string | null;
  activeMessages: Message[];
  isLoadingInbox: boolean;
  isLoadingMessages: boolean;
  errorInbox: string | null;
  errorMessages: string | null;
  
  reset: () => void;
  setActiveConversation: (id: string | null) => void;
  subscribeInbox: (
    tenantId: string, 
    options?: { advisorId?: string | null; isAdmin?: boolean; isAutoDistributionEnabled?: boolean }
  ) => () => void;
  subscribeMessages: (conversationId: string) => () => void;
  sendMessage: (
    conversationId: string, 
    text: string, 
    sender: 'advisor' | 'lead', 
    tenantId?: string, 
    mediaUrl?: string | null, 
    mediaFilename?: string | null,
    templateName?: string,
    languageCode?: string,
    components?: any[]
  ) => Promise<{ success: boolean; messageId?: string; status?: string; externalId?: string; errorMessage?: string | null } | undefined>;
  markAsRead: (conversationId: string) => Promise<void>;
  assignAgent: (conversationId: string, advisorId: string) => Promise<void>;
  claimConversation: (conversationId: string) => Promise<{ success: boolean; conversationId: string; advisorId: string }>;
  toggleBot: (conversationId: string, enabled: boolean) => Promise<void>;
  seedConversations: (tenantId: string, advisorId: string) => Promise<void>;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  activeConversation: null,
  activeMessages: [],
  isLoadingInbox: false,
  isLoadingMessages: false,
  errorInbox: null,
  errorMessages: null,

  reset: () => set({
    conversations: [],
    activeConversation: null,
    activeMessages: [],
    isLoadingInbox: false,
    isLoadingMessages: false,
    errorInbox: null,
    errorMessages: null,
  }),

  setActiveConversation: (id) => set({
    activeConversation: id,
    activeMessages: [],
    errorMessages: null
  }),

  subscribeInbox: (tenantId, options) => {
    if (get().conversations.length === 0) {
      set({ isLoadingInbox: true, errorInbox: null });
    }
    return ConversationService.subscribeToInbox(
      tenantId, 
      options || {},
      (conversations) => {
        set({ conversations, isLoadingInbox: false });
      },
      (error: any) => {
        set({ errorInbox: error.message, isLoadingInbox: false });
      }
    );
  },

  subscribeMessages: (conversationId) => {
    set({ isLoadingMessages: true, errorMessages: null });
    return ConversationService.subscribeToMessages(conversationId, 
      (activeMessages) => {
        set({ activeMessages, isLoadingMessages: false });
      },
      (error: any) => {
        set({ errorMessages: error.message, isLoadingMessages: false });
      }
    );
  },

  sendMessage: async (conversationId, text, sender, tenantId, mediaUrl, mediaFilename, templateName, languageCode, components): Promise<{ success: boolean; messageId?: string; status?: string; externalId?: string; errorMessage?: string | null } | undefined> => {
    // Buscar la fuente en las conversaciones cargadas
    const { conversations } = useConversationStore.getState();
    const source = conversations.find(c => c.id === conversationId)?.source || 'whatsapp';
    
    // Devuelve el resultado del callable (antes se descartaba) — para audio/imagen/
    // documento nadie lo necesitaba, pero para video es la ÚNICA forma de saber si
    // Meta rechazó el envío: sendWhatsappMessage NO tira excepción cuando Meta
    // responde con error, solo devuelve { success: false, status: 'failed',
    // errorMessage }. Sin este valor de retorno, ese caso queda indistinguible
    // de un envío exitoso desde el frontend.
    return await ConversationService.sendMessage(
      conversationId,
      text,
      sender,
      tenantId,
      mediaUrl,
      mediaFilename,
      templateName,
      languageCode,
      components,
      source
    );
  },

  markAsRead: async (conversationId) => {
    await ConversationService.markAsRead(conversationId);
  },
  
  assignAgent: async (conversationId, advisorId) => {
    await ConversationService.assignAgent(conversationId, advisorId);
  },

  claimConversation: async (conversationId) => {
    return ConversationService.claimConversation(conversationId);
  },

  toggleBot: async (conversationId, enabled) => {
    await ConversationService.toggleBot(conversationId, enabled);
  },

  seedConversations: async (tenantId, advisorId) => {
    await ConversationService.seedSampleConversations(tenantId, advisorId);
  }
}));
