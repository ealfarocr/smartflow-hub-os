import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { canAccessLiveVideoQa } from './liveVideoQaAccess';

export const LiveVideoQaGuard = ({ children }: { children: ReactNode }) => {
  const { user, isLoading } = useAuthStore();
  if (isLoading) return null;
  if (!canAccessLiveVideoQa(user)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};
