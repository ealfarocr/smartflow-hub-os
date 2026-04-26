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
  
  setActiveConversation: (id: string | null) => void;
  subscribeInbox: (tenantId: string) => () => void;
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
  ) => Promise<void>;
  markAsRead: (conversationId: string) => Promise<void>;
  seedConversations: (tenantId: string, advisorId: string) => Promise<void>;
}

export const useConversationStore = create<ConversationState>((set) => ({
  conversations: [],
  activeConversation: null,
  activeMessages: [],
  isLoadingInbox: false,
  isLoadingMessages: false,
  errorInbox: null,
  errorMessages: null,

  setActiveConversation: (id) => set({ 
    activeConversation: id,
    activeMessages: id ? [] : [], // Clear messages when switching or closing
    errorMessages: null
  }),

  subscribeInbox: (tenantId) => {
    set({ isLoadingInbox: true, errorInbox: null });
    return ConversationService.subscribeToInbox(tenantId, 
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

  sendMessage: async (conversationId, text, sender, tenantId, mediaUrl, mediaFilename, templateName, languageCode, components) => {
    await ConversationService.sendMessage(conversationId, text, sender, tenantId, mediaUrl, mediaFilename, templateName, languageCode, components);
  },

  markAsRead: async (conversationId) => {
    await ConversationService.markAsRead(conversationId);
  },

  seedConversations: async (tenantId, advisorId) => {
    await ConversationService.seedSampleConversations(tenantId, advisorId);
  }
}));
