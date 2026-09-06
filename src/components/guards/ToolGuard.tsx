import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { hasTool, ToolKey, TOOL_LABELS } from '@/utils/permissions';

interface ToolGuardProps {
  tool: ToolKey;
}

/**
 * Control de herramientas POR USUARIO — capa adicional a FeatureGuard (que
 * solo mira el flag del tenant) y a RoleGuard (que solo mira el rol). Se usa
 * ANIDADO junto a esos guards, nunca en su lugar: el rol y el feature flag
 * del tenant siguen siendo el techo de seguridad real, esto solo puede
 * ESTRECHAR el acceso dentro de lo que ya está permitido, nunca ampliarlo.
 */
export const ToolGuard = ({ tool }: ToolGuardProps) => {
  const { activeMembership, user, impersonatedName } = useAuthStore();

  const isSuperAdmin = !!user?.isSuperAdmin;
  if (isSuperAdmin && !impersonatedName) return <Outlet />;

  if (!hasTool(activeMembership, tool)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200 mb-2">
          Acceso restringido
        </h2>
        <p className="text-slate-500 dark:text-slate-400 max-w-sm">
          No tenés habilitada la herramienta "{TOOL_LABELS[tool]}". Pedile a tu administrador que te la active desde Gestión de Usuarios.
        </p>
        <Navigate to="/dashboard" replace />
      </div>
    );
  }

  return <Outlet />;
};
