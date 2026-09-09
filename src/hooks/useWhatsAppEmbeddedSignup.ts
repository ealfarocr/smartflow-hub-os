import { useCallback, useRef, useState } from 'react';
import { loadFacebookSdk, launchWhatsappEmbeddedSignup } from '@/utils/facebookSdk';
import { WhatsappIntegrationService } from '@/services/firebase/WhatsappIntegrationService';

export type EmbeddedSignupStatus = 'idle' | 'loading-sdk' | 'waiting-popup' | 'saving' | 'success' | 'error';

export interface EmbeddedSignupConnectedInfo {
  displayPhoneNumber: string | null;
  verifiedName: string | null;
}

/**
 * Core reutilizable de Embedded Signup de WhatsApp (Fase 3 del LOOP maestro).
 * Encapsula el flujo completo: cargar SDK de Meta -> popup -> code de
 * autorización -> completeWhatsappEmbeddedSignup (code exchange server-side,
 * el App Secret nunca sale del backend) -> integración persistida.
 * Cualquier punto de entrada (Super Admin, tarjeta de /integraciones,
 * onboarding de landing) debe usar este hook en vez de reimplementar el flujo.
 */
export function useWhatsAppEmbeddedSignup(tenantId: string) {
  const [status, setStatus] = useState<EmbeddedSignupStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [connectedInfo, setConnectedInfo] = useState<EmbeddedSignupConnectedInfo | null>(null);
  const activeRunRef = useRef(0);

  const start = useCallback(async (connectionType: 'api' | 'coexistent') => {
    const runId = ++activeRunRef.current;
    const isStale = () => activeRunRef.current !== runId;

    setStatus('loading-sdk');
    setErrorMessage('');
    try {
      await loadFacebookSdk();
      if (isStale()) return;
      setStatus('waiting-popup');
      const result = await launchWhatsappEmbeddedSignup(connectionType);
      if (isStale()) return;
      setStatus('saving');
      const response = await WhatsappIntegrationService.completeEmbeddedSignup({
        code: result.code,
        tenantId,
        wabaId: result.wabaId,
        phoneNumberId: result.phoneNumberId,
        connectionType,
      });
      if (isStale()) return;
      setConnectedInfo({ displayPhoneNumber: response.displayPhoneNumber, verifiedName: response.verifiedName });
      setStatus('success');
    } catch (err: unknown) {
      if (isStale()) return;
      const message = err instanceof Error ? err.message : 'No se pudo completar la conexión con WhatsApp';
      setErrorMessage(message);
      setStatus('error');
    }
  }, [tenantId]);

  const reset = useCallback(() => {
    activeRunRef.current++; // invalida cualquier intento en curso
    setStatus('idle');
    setErrorMessage('');
    setConnectedInfo(null);
  }, []);

  return { status, errorMessage, connectedInfo, start, reset };
}
