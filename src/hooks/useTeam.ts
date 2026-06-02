import { useState, useEffect } from 'react';
import { Membership } from '@/types';
import { AuthService } from '@/services/AuthService';

export const useTeam = (tenantId?: string) => {
  const [team, setTeam] = useState<Membership[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (tenantId) {
      setIsLoading(true);
      AuthService.getTenantMemberships(tenantId)
        .then(setTeam)
        .finally(() => setIsLoading(false));
    }
  }, [tenantId]);

  return { team, isLoading };
};
