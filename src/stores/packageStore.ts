import { create } from 'zustand';
import { Package } from '@/types';
import { PackageService } from '@/services/firebase/PackageService';

interface PackageState {
  packages: Package[];
  isLoading: boolean;
  error: string | null;
  
  // Actions
  setPackages: (packages: Package[]) => void;
  addPackage: (pkg: Omit<Package, 'id'>) => Promise<void>;
  updatePackage: (id: string, data: Partial<Package>) => Promise<void>;
  subscribe: (tenantId: string) => () => void;
}

export const usePackageStore = create<PackageState>((set) => ({
  packages: [],
  isLoading: true,
  error: null,
  
  setPackages: (packages) => set({ packages, isLoading: false }),
  
  addPackage: async (pkg) => {
    // La escritura en Firestore disparará el onSnapshot y actualizará el estado automáticamente
    await PackageService.createPackage(pkg);
  },
  
  updatePackage: async (id, data) => {
    await PackageService.updatePackage(id, data);
  },

  subscribe: (tenantId) => {
    set({ isLoading: true, error: null });
    const unsubscribe = PackageService.subscribeToPackages(tenantId, 
      (packages) => {
        set({ packages, isLoading: false });
      },
      (error) => {
        set({ error: error.message, isLoading: false });
      }
    );
    return unsubscribe;
  }
}));
