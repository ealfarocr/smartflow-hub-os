import { describe, it, expect } from 'vitest';
import { shouldApplyStatusUpdate, buildWebhookMetaError } from './messageStatusUpdate';

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

describe('buildWebhookMetaError — diagnostico de failed por webhook', () => {
  it('captura code/title/message/fbtrace_id y details, sin undefined', () => {
    const r = buildWebhookMetaError(
      { code: 131053, title: 'Media upload error', message: 'Media upload error', type: 'OAuthException', fbtrace_id: 'AbC', error_data: { details: 'Unsupported codec', secret: 'x' } },
      'wamid.X', '2026-10-17T19:54:25.000Z'
    );
    expect(r).toEqual({
      source: 'webhook', code: 131053, subcode: null, title: 'Media upload error', message: 'Media upload error',
      type: 'OAuthException', fbtraceId: 'AbC', details: 'Unsupported codec', wamid: 'wamid.X', receivedAt: '2026-10-17T19:54:25.000Z',
    });
    expect(Object.values(r).includes(undefined as any)).toBe(false);
  });

  it('acepta error ausente y subcode alterno', () => {
    expect(buildWebhookMetaError(undefined, 'w', 't').code).toBeNull();
    expect(buildWebhookMetaError({ subcode: 7 }, 'w', 't').subcode).toBe(7);
  });

  it('recorta textos largos', () => {
    expect(buildWebhookMetaError({ message: 'a'.repeat(900) }, 'w', 't').message).toHaveLength(500);
  });
});
