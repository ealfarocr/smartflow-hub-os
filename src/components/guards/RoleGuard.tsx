import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Role } from '@/types';

interface RoleGuardProps {
  allowedRoles: Role[];
}

export const RoleGuard = ({ allowedRoles }: RoleGuardProps) => {
  const { activeMembership } = useAuthStore();

  if (!activeMembership) {
    return <Navigate to="/switch-tenant" replace />;
  }

  if (!allowedRoles.includes(activeMembership.role)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
         <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200 mb-2">Acceso Restringido</h2>
         <p className="text-slate-500 dark:text-slate-400">Tu nivel de acceso ({activeMembership.role}) no te permite ver este módulo.</p>
      </div>
    );
  }

  return <Outlet />;
};
