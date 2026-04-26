import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

interface UIState {
  isMobileMenuOpen: boolean;
  toasts: ToastMessage[];
  
  toggleMobileMenu: (isOpen?: boolean) => void;
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isMobileMenuOpen: false,
  toasts: [],
  
  toggleMobileMenu: (isOpen) => set((state) => ({ 
    isMobileMenuOpen: isOpen !== undefined ? isOpen : !state.isMobileMenuOpen 
  })),
  
  addToast: (message, type = 'info') => {
    const id = `toast-${Date.now()}`;
    set((state) => ({
      toasts: [...state.toasts, { id, type, message }]
    }));
    
    // Auto remove after 3 seconds
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter(t => t.id !== id)
      }));
    }, 3000);
  },
  
  removeToast: (id: string) => set((state) => ({
    toasts: state.toasts.filter(t => t.id !== id)
  })),
}));
