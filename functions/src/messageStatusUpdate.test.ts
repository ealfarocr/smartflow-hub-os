import { describe, it, expect } from 'vitest';
import { shouldApplyStatusUpdate } from './messageStatusUpdate';

describe('shouldApplyStatusUpdate — webhook status updates (LOOP nocturno USADITOS, Fase 6)', () => {
  it('sent -> delivered avanza', () => {
    expect(shouldApplyStatusUpdate('sent', 'delivered')).toBe(true);
  });

  it('delivered -> read avanza', () => {
    expect(shouldApplyStatusUpdate('delivered', 'read')).toBe(true);
  });

  it('sent -> read avanza (saltea delivered, puede pasar)', () => {
    expect(shouldApplyStatusUpdate('sent', 'read')).toBe(true);
  });

  it('read -> delivered NO retrocede (evento fuera de orden)', () => {
    expect(shouldApplyStatusUpdate('read', 'delivered')).toBe(false);
  });

  it('delivered -> sent NO retrocede', () => {
    expect(shouldApplyStatusUpdate('delivered', 'sent')).toBe(false);
  });

  it('mismo status repetido (idempotencia) NO reaplica', () => {
    expect(shouldApplyStatusUpdate('delivered', 'delivered')).toBe(false);
  });

  it('failed sobre sent se aplica (terminal)', () => {
    expect(shouldApplyStatusUpdate('sent', 'failed')).toBe(true);
  });

  it('failed sobre delivered se aplica (terminal, aunque sea raro)', () => {
    expect(shouldApplyStatusUpdate('delivered', 'failed')).toBe(true);
  });

  it('un mensaje ya failed NO se revive por un evento tardío', () => {
    expect(shouldApplyStatusUpdate('failed', 'delivered')).toBe(false);
    expect(shouldApplyStatusUpdate('failed', 'sent')).toBe(false);
    expect(shouldApplyStatusUpdate('failed', 'read')).toBe(false);
  });

  it('status desconocido no se aplica', () => {
    expect(shouldApplyStatusUpdate('sent', 'some_new_meta_status')).toBe(false);
  });

  it('sin status actual (undefined/null/pending), sent se aplica', () => {
    expect(shouldApplyStatusUpdate(undefined, 'sent')).toBe(true);
    expect(shouldApplyStatusUpdate(null, 'sent')).toBe(true);
    expect(shouldApplyStatusUpdate('pending', 'sent')).toBe(true);
  });
});
