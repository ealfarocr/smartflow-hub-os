import { describe, it, expect } from 'vitest';
import { buildDiagnosticText, explainMissingControls, type ChatDiagState } from './mediaDiagReport';
import { describeEnvironment } from './mediaDiag';

const abierta: ChatDiagState = { conversacionAbierta: true, ventana: 'active', grabando: false };
const sinControles = { enDom: [], visibles: [] };

// Evidencia del teléfono: el panel decía "no hay controles en pantalla" con la
// tarjeta de prueba visible. No era el detector: el composer no estaba dibujado.
describe('Por qué no hay 📎 / 📷 en pantalla, en palabras', () => {
  it('con la lista de conversaciones abierta', () => {
    expect(explainMissingControls({ ...abierta, conversacionAbierta: false }, sinControles)).toMatch(/no hay conversación abierta/);
  });

  it('con la ventana de 24 h vencida', () => {
    expect(explainMissingControls({ ...abierta, ventana: 'expired' }, sinControles)).toMatch(/ventana de 24 h vencida/);
  });

  it('grabando una nota de voz', () => {
    expect(explainMissingControls({ ...abierta, grabando: true }, sinControles)).toMatch(/grabando/);
  });

  it('en el DOM pero ocultos', () => {
    expect(explainMissingControls(abierta, { enDom: ['clip'], visibles: [] })).toMatch(/sin tamaño/);
  });

  it('cuando están, los nombra', () => {
    expect(explainMissingControls(abierta, { enDom: ['clip', 'camera'], visibles: ['clip', 'camera'] })).toBe('visibles: clip, camera');
  });
});

describe('Texto de "Copiar diagnóstico"', () => {
  const env = describeEnvironment('Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36');
  const text = buildDiagnosticText({
    now: new Date('2026-09-11T10:00:00'),
    url: '/conversaciones',
    env,
    viewport: { w: 390, h: 844, dpr: 3, visualH: 700 },
    chat: abierta,
    controls: { enDom: ['clip', 'camera'], visibles: ['clip', 'camera'] },
    events: [
      { at: '10:00:02', step: 'CLIP_TAP', data: { habilitado: true } },
      { at: '10:00:01', step: 'POINTERCANCEL', data: { en: 'div' } },
      { at: '10:00:00', step: 'TOQUE', data: { xy: '30,780' } },
    ],
  });

  it('trae el entorno del navegador', () => {
    ['Navegador: Chrome', 'Embebido: no', 'showPicker:', 'Táctil:', 'UA: Mozilla/5.0'].forEach((s) => expect(text).toContain(s));
  });

  it('trae el estado del chat y los controles', () => {
    expect(text).toContain('conversación abierta sí');
    expect(text).toContain('Controles del chat: visibles: clip, camera');
  });

  it('trae TODOS los eventos con sus datos', () => {
    expect(text).toContain('3 eventos');
    expect(text).toContain('10:00:02 CLIP_TAP {"habilitado":true}');
    expect(text).toContain('POINTERCANCEL');
    expect(text).toContain('TOQUE {"xy":"30,780"}');
  });
});
