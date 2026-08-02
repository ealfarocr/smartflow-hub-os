// src/services/firebase/WhatsappIntegrationService.ts
import { getFunctions, httpsCallable } from 'firebase/functions';

export interface CompleteEmbeddedSignupRequest {
  code: string;
  tenantId: string;
  wabaId: string;
  phoneNumberId: string;
  connectionType: 'api' | 'coexistent';
}

export interface CompleteEmbeddedSignupResponse {
  success: boolean;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
}

const functions = getFunctions();

export const WhatsappIntegrationService = {
  /**
   * Envía el código de autorización del Embedded Signup de Meta al backend,
   * que lo intercambia por un access_token y crea/actualiza la integración
   * de WhatsApp del tenant en Firestore.
   */
  completeEmbeddedSignup: async (
    payload: CompleteEmbeddedSignupRequest
  ): Promise<CompleteEmbeddedSignupResponse> => {
    const fn = httpsCallable<CompleteEmbeddedSignupRequest, CompleteEmbeddedSignupResponse>(
      functions,
      'completeWhatsappEmbeddedSignup'
    );
    const res = await fn(payload);
    return res.data;
  },
};
