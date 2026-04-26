import { create } from 'zustand';
import { Quote, QuoteStatus } from '@/types';
import { QuoteService } from '@/services/firebase/QuoteService';

interface QuoteState {
  quotes: Quote[];
  isLoading: boolean;
  error: string | null;
  
  // Actions
  subscribe: (tenantId: string) => () => void;
  createQuote: (tenantId: string, advisorId: string, quote: Omit<Quote, 'id' | 'tenantId' | 'advisorId'>) => Promise<void>;
  updateQuoteStatus: (id: string, status: QuoteStatus) => Promise<void>;
  deleteQuote: (id: string, userId: string, userName: string) => Promise<void>;
}

export const useQuoteStore = create<QuoteState>((set) => ({
  quotes: [],
  isLoading: true,
  error: null,

  subscribe: (tenantId: string) => {
    set({ isLoading: true, error: null });
    const unsubscribe = QuoteService.subscribeToQuotes(tenantId, 
      (quotes) => {
        set({ quotes, isLoading: false });
      },
      (error) => {
        set({ error: error.message, isLoading: false });
      }
    );
    return unsubscribe;
  },

  createQuote: async (tenantId, advisorId, quote) => {
    await QuoteService.createQuote(tenantId, advisorId, quote);
  },

  updateQuoteStatus: async (id, status) => {
    await QuoteService.updateQuoteStatus(id, status);
  },

  deleteQuote: async (id, userId, userName) => {
    await QuoteService.deleteQuote(id, userId, userName);
  }
}));
