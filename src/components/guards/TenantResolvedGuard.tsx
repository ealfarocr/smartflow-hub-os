import { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

export const TenantResolvedGuard = ({ children }: { children?: ReactNode }) => {
  const { memberships, activeMembership, isAuthenticated } = useAuthStore();

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (memberships.length === 0) {
    return <Navigate to="/access-pending" replace />;
  }

  if (memberships.length > 1 && !activeMembership) {
    return <Navigate to="/switch-tenant" replace />;
  }

  // Si hay 1 membership, el authStore ya lo auto-resuelve como activeMembership
  if (activeMembership) {
    return children ? <>{children}</> : <Outlet />;
  }

  // Fallback de seguridad (Si memberships = 1 pero falló algo)
  if (memberships.length === 1 && !activeMembership) {
    return <div className="p-8">Resolviendo su única empresa...</div>;
  }

  return <Navigate to="/access-pending" replace />;
};
