import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { isAdminRole } from '@/utils/permissions';

/**
 * A dónde aterriza cada quien al entrar por la puerta principal ("/").
 *
 * El Asesor Comercial trabaja todo el día en las conversaciones: mandarlo al
 * Dashboard le agrega un rebote antes de poder atender. Owner, Admin y
 * SuperAdmin conservan el Dashboard, que es donde sí miran el estado del
 * negocio.
 *
 * Mientras la membership no terminó de cargar NO se decide: justo después de
 * entrar (por código o por equipo reconocido) el rol todavía puede no estar
 * resuelto, y decidir con el rol vacío mandaría a un Owner a las conversaciones.
 *
 * Esto SOLO decide el destino por defecto. Un deep link concreto no pasa por
 * acá: quien abre /crm o /agenda directamente va ahí, y ProtectedRoute sigue
 * siendo quien controla el acceso.
 */
export const LandingRedirect = () => {
  const { activeMembership, user } = useAuthStore();

  if (!activeMembership && !user?.isSuperAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const destino = user?.isSuperAdmin || isAdminRole(activeMembership?.role) ? '/dashboard' : '/conversaciones';
  return <Navigate to={destino} replace />;
};
