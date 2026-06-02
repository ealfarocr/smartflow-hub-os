import { create } from 'zustand';
import { Lead, CRMStage } from '@/types';
import { LeadService } from '@/services/firebase/LeadService';

interface LeadState {
  leads: Lead[];
  isLoading: boolean;
  error: string | null;
  
  // Actions
  reset: () => void;
  subscribe: (tenantId: string) => () => void;
  moveLead: (tenantId: string, id: string, sourceStage: CRMStage, newStage: CRMStage, newOrder: number) => Promise<void>;
  createLead: (tenantId: string, data: Partial<Lead>) => Promise<void>;
  updateLead: (id: string, data: Partial<Lead>) => Promise<void>;
  deleteLead: (id: string) => Promise<void>;
  seedLeads: (tenantId: string) => Promise<void>;
}

export const useLeadStore = create<LeadState>((set, get) => ({
  leads: [],
  isLoading: true,
  error: null,

  reset: () => set({ leads: [], isLoading: false, error: null }),

  subscribe: (tenantId) => {
    // Solo mostramos loading si no tenemos datos previos (evita delay en navegación)
    if (get().leads.length === 0) {
      set({ isLoading: true, error: null });
    }
    const unsubscribe = LeadService.subscribeToLeads(tenantId, 
      (leads) => {
        set({ leads, isLoading: false });
      },
      (error) => {
        set({ error: error.message, isLoading: false });
      }
    );
    return unsubscribe;
  },

  moveLead: async (tenantId, id, sourceStage, newStage, newOrder) => {
    const previousLeads = get().leads;
    try {
      // Optimistic Update
      const newLeads = [...previousLeads];
      const leadIndex = newLeads.findIndex(l => l.id === id);
      
      if (leadIndex > -1) {
        const [movedLead] = newLeads.splice(leadIndex, 1);
        movedLead.stage = newStage;
        
        const destLeads = newLeads.filter(l => l.stage === newStage).sort((a,b) => a.orderIndex - b.orderIndex);
        const otherLeads = newLeads.filter(l => l.stage !== newStage);
        
        destLeads.splice(newOrder, 0, movedLead);
        destLeads.forEach((l, idx) => { l.orderIndex = idx; });
        
        set({ leads: [...otherLeads, ...destLeads] });
      }

      await LeadService.moveLeadTransaction(tenantId, id, sourceStage, newStage, newOrder);
    } catch (error) {
      console.error("Error al mover lead:", error);
      set({ leads: previousLeads });
      throw error;
    }
  },

  createLead: async (tenantId: string, data: Partial<Lead>) => {
    await LeadService.createLead(tenantId, data);
  },

  updateLead: async (id: string, data: Partial<Lead>) => {
    await LeadService.updateLead(id, data);
  },

  deleteLead: async (id: string) => {
    await LeadService.deleteLead(id);
  },

  seedLeads: async (tenantId: string) => {
    await LeadService.seedSampleLeads(tenantId);
  }
}));
