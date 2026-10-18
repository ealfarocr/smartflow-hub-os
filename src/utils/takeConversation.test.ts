import { describe, it, expect } from 'vitest';
import { canShowTakeButton } from './takeConversation';

describe('canShowTakeButton', () => {
  it('conversación ya asignada: nunca', () => {
    expect(canShowTakeButton({ advisorId: 'u1' }, false, 'Owner')).toBe(false);
    expect(canShowTakeButton({ advisorId: 'u1' }, true, 'Asesor Comercial')).toBe(false);
  });
  it('Modo Libre: se muestra a cualquiera (flujo de ese modo)', () => {
    expect(canShowTakeButton({ advisorId: '' }, false, 'Asesor Comercial')).toBe(true);
    expect(canShowTakeButton({}, false, 'Asesor Comercial')).toBe(true);
  });
  it('asignación automática: el asesor NO ve Tomar', () => {
    expect(canShowTakeButton({ advisorId: '' }, true, 'Asesor Comercial')).toBe(false);
    expect(canShowTakeButton({ advisorId: null }, true, 'Técnico')).toBe(false);
    expect(canShowTakeButton({ advisorId: '' }, true, undefined)).toBe(false);
  });
  it('asignación automática: Owner/Admin conservan la contingencia', () => {
    expect(canShowTakeButton({ advisorId: '' }, true, 'Owner')).toBe(true);
    expect(canShowTakeButton({ advisorId: '' }, true, 'Admin')).toBe(true);
  });
});
