import { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { getRememberedVendorIdentity } from '@/utils/deviceTrust';

export const ProtectedRoute = ({ children }: { children?: ReactNode }) => {
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    // Quien ya usó este equipo vuelve a SU pantalla (/acceso), no a la
    // corporativa. Antes todos caían en /login: el vendedor aterrizaba en una
    // pantalla de Google y correo/contraseña que no le sirve — su cuenta
    // técnica usa un password aleatorio que nadie conoce — y tenía que buscar
    // el acceso del equipo. /acceso decide solo qué mostrarle: entrada rápida
    // si su sesión sigue viva, o el código si de verdad hace falta.
    //
    // No es una decisión de seguridad: es a qué puerta se lo manda. Las dos
    // pantallas exigen exactamente lo mismo para entrar.
    const remembered = getRememberedVendorIdentity();
    return <Navigate to={remembered ? '/acceso' : '/login'} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
};
