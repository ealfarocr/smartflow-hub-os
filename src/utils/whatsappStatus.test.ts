import { describe, it, expect } from 'vitest';
import { deriveStatusFromSuperAdminEntry, deriveStatusFromIntegration, WHATSAPP_STATUS_LABEL } from './whatsappStatus';

/**
 * Reconciliación del estado de WhatsApp en el SuperAdmin global.
 * Regla dura: "Conectar WhatsApp" solo puede ofrecerse cuando de verdad se sabe
 * que el tenant no tiene integración — nunca cuando la consulta falló.
 */
describe('deriveStatusFromSuperAdminEntry', () => {
  it('CASO 1 — tenant con integración válida (USADITOS) no ofrece conectar', () => {
    const usaditos = {
      isActive: true,
      phoneNumberId: '1354454937743475',
      displayPhoneNumber: '50672292718',
    };
    expect(deriveStatusFromSuperAdminEntry(usaditos)).toBe('CONNECTED');
    expect(deriveStatusFromSuperAdminEntry(usaditos, true)).toBe('CONNECTED');
  });

  it('CASO 2 — tenant sin integración, con la consulta OK, sí ofrece conectar', () => {
    expect(deriveStatusFromSuperAdminEntry(undefined)).toBe('NOT_CONNECTED');
    expect(deriveStatusFromSuperAdminEntry(null)).toBe('NOT_CONNECTED');
  });

  it('CASO 3 — metadata parcial no se reporta como conectada', () => {
    expect(deriveStatusFromSuperAdminEntry({ isActive: false, phoneNumberId: '123' })).toBe('PENDING');
    expect(deriveStatusFromSuperAdminEntry({ isActive: true, phoneNumberId: null, displayPhoneNumber: null })).toBe('ERROR');
    expect(deriveStatusFromSuperAdminEntry({ isActive: true, phoneNumberId: '123', error: 'token inválido' })).toBe('ERROR');
  });

  it('CASO 4 — si la consulta al backend falló, el estado es UNKNOWN, no NOT_CONNECTED', () => {
    expect(deriveStatusFromSuperAdminEntry(undefined, true)).toBe('UNKNOWN');
    expect(WHATSAPP_STATUS_LABEL.UNKNOWN).toBe('Revisar WhatsApp');
    expect(WHATSAPP_STATUS_LABEL.UNKNOWN).not.toBe(WHATSAPP_STATUS_LABEL.NOT_CONNECTED);
  });
});

describe('deriveStatusFromIntegration', () => {
  it('exige isActive + phoneNumberId + accessToken para CONNECTED', () => {
    expect(deriveStatusFromIntegration({ isActive: true, phoneNumberId: '1', accessToken: 'x' })).toBe('CONNECTED');
    expect(deriveStatusFromIntegration({ isActive: true, phoneNumberId: '1', accessToken: null })).toBe('ERROR');
    expect(deriveStatusFromIntegration(null)).toBe('NOT_CONNECTED');
  });
});
