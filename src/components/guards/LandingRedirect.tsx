import { Navigate } from 'react-router-dom';
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
 * Esto SOLO decide el destino por defecto. Un deep link concreto no pasa por
 * acá: quien abre /crm o /agenda directamente va ahí, y ProtectedRoute sigue
 * siendo quien controla el acceso.
 */
export const LandingRedirect = () => {
  const { activeMembership } = useAuthStore();
  const destino = isAdminRole(activeMembership?.role) ? '/dashboard' : '/conversaciones';
  return <Navigate to={destino} replace />;
};
