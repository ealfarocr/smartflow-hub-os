import { Navigate, Outlet } from 'react-router-dom';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { TenantFeatures } from '@/types';

interface FeatureGuardProps {
  feature: keyof TenantFeatures;
}

/**
 * Protege rutas por Feature Flag.
 * Si el feature no está habilitado en la config del tenant, redirige al dashboard.
 * Nota: si el campo no existe en Firestore (tenant legacy), se trata como habilitado (true).
 */
export const FeatureGuard = ({ feature }: FeatureGuardProps) => {
  const { features } = useSettingsStore();
  const { user, impersonatedName } = useAuthStore();

  const isSuperAdmin = !!user?.isSuperAdmin;

  // Si es SuperAdmin y NO está suplantando a nadie (Hub Master), ve TODO sin restricciones
  if (isSuperAdmin && !impersonatedName) return <Outlet />;

  // Undefined → tenant sin campo features → permitir acceso (backward compat)
  const isEnabled = features?.[feature] !== false;

  if (!isEnabled) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200 mb-2">
          Módulo no disponible
        </h2>
        <p className="text-slate-500 dark:text-slate-400 max-w-sm">
          Este módulo no está habilitado para tu cuenta. Contacta a tu administrador para activarlo.
        </p>
        <Navigate to="/dashboard" replace />
      </div>
    );
  }

  return <Outlet />;
};
