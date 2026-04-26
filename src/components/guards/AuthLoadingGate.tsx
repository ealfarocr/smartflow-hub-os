import { ReactNode } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { Loader2 } from 'lucide-react';

export const AuthLoadingGate = ({ children }: { children: ReactNode }) => {
  const { isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center z-[9999]">
        <Loader2 className="w-12 h-12 text-primary-500 animate-spin mb-4" />
        <p className="text-slate-500 dark:text-slate-400 font-medium animate-pulse">Conectando al Workspace...</p>
      </div>
    );
  }

  return <>{children}</>;
};
