import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Tenant } from '@/types';

interface TenantState {
  activeTenant: Tenant | null;
  setTenant: (tenant: Tenant) => void;
}

export const useTenantStore = create<TenantState>()(
  persist(
    (set) => ({
      activeTenant: {
        id: 't-1',
        name: 'Energía Solar MX',
        branding: {
          primaryColor: '#aa3bff'
        }
      },
      setTenant: (tenant) => set({ activeTenant: tenant }),
    }),
    {
      name: 'psmx-tenant-storage',
    }
  )
);
