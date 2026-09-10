import { useState, useEffect } from 'react';
import { Membership } from '@/types';
import { AuthService } from '@/services/AuthService';

export const useTeam = (tenantId?: string) => {
  const [team, setTeam] = useState<Membership[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (tenantId) {
      setIsLoading(true);
      // Un asesor no puede listar las membresías del equipo (la Rule solo le deja
      // leer la propia): sin el catch, cada apertura del chat dejaba un rechazo
      // sin manejar. El equipo solo lo usa el selector de asignación de Owner/Admin.
      AuthService.getTenantMemberships(tenantId)
        .then(setTeam)
        .catch(() => setTeam([]))
        .finally(() => setIsLoading(false));
    }
  }, [tenantId]);

  return { team, isLoading };
};
