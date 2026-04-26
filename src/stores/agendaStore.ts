import { create } from 'zustand';
import { AgendaItem } from '@/types';
import { AgendaService } from '@/services/firebase/AgendaService';

interface AgendaState {
  items: AgendaItem[];
  isLoading: boolean;
  error: string | null;
  subscribe: (tenantId: string) => () => void;
  addItem: (tenantId: string, advisorId: string, item: Omit<AgendaItem, 'id' | 'tenantId' | 'advisorId'>) => Promise<void>;
  updateItem: (id: string, data: Partial<AgendaItem>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
}

export const useAgendaStore = create<AgendaState>((set) => ({
  items: [],
  isLoading: false,
  error: null,

  subscribe: (tenantId: string) => {
    set({ isLoading: true, error: null });
    return AgendaService.subscribeToTenantAgenda(tenantId, 
      (items) => {
        set({ items, isLoading: false });
      },
      (error) => {
        set({ error: error.message, isLoading: false });
      }
    );
  },

  addItem: async (tenantId, advisorId, item) => {
    await AgendaService.createItem(tenantId, advisorId, item);
  },

  updateItem: async (id, data) => {
    await AgendaService.updateItem(id, data);
  },

  deleteItem: async (id) => {
    await AgendaService.deleteItem(id);
  },
}));
