import { describe, it, expect } from 'vitest';
import { computeMenuPosition } from './dropdownPosition';

const MARGIN = 8;
const inside = (p: ReturnType<typeof computeMenuPosition>, vw: number, vh: number) => {
  expect(p.left).toBeGreaterThanOrEqual(MARGIN);
  expect(p.left + p.width).toBeLessThanOrEqual(vw - MARGIN);
  expect(p.top).toBeGreaterThanOrEqual(0);
  expect(p.top + Math.min(p.maxHeight, 9999)).toBeLessThanOrEqual(vh);
};

describe('computeMenuPosition', () => {
  it('móvil: botón cerca del borde izquierdo (caso reportado) => no se recorta', () => {
    // 360px de ancho, botón en x 58..110 (junto al menú hamburguesa)
    const p = computeMenuPosition({ top: 100, bottom: 136, left: 58, right: 110 }, { width: 360, height: 640 }, { contentHeight: 212 });
    expect(p.left).toBe(MARGIN);
    inside(p, 360, 640);
  });
  it('escritorio: alineado al borde derecho del botón, sin moverse', () => {
    const p = computeMenuPosition({ top: 12, bottom: 48, left: 1000, right: 1130 }, { width: 1440, height: 900 }, { contentHeight: 212 });
    expect(p.left).toBe(1130 - 192);
    expect(p.width).toBe(192);
    expect(p.placement).toBe('below');
  });
  it('tablet 768: botón al centro-derecha', () => {
    const p = computeMenuPosition({ top: 12, bottom: 48, left: 560, right: 640 }, { width: 768, height: 1024 }, { contentHeight: 212 });
    expect(p.left).toBe(640 - 192);
    inside(p, 768, 1024);
  });
  it('botón pegado al borde derecho => se corre a la izquierda', () => {
    const p = computeMenuPosition({ top: 10, bottom: 40, left: 330, right: 380 }, { width: 360, height: 640 }, { contentHeight: 212 });
    inside(p, 360, 640);
  });
  it('viewport muy angosto (280px) => el ancho se acota', () => {
    const p = computeMenuPosition({ top: 10, bottom: 40, left: 20, right: 70 }, { width: 200, height: 600 }, { contentHeight: 212 });
    expect(p.width).toBe(200 - MARGIN * 2);
    inside(p, 200, 600);
  });
  it('sin espacio abajo y más arriba => flip hacia arriba', () => {
    const p = computeMenuPosition({ top: 560, bottom: 596, left: 20, right: 120 }, { width: 360, height: 640 }, { contentHeight: 212 });
    expect(p.placement).toBe('above');
    expect(p.top + 212).toBeLessThanOrEqual(560);
  });
  it('no cabe en ninguno => maxHeight acotado para scroll interno', () => {
    const p = computeMenuPosition({ top: 100, bottom: 136, left: 20, right: 120 }, { width: 360, height: 220 }, { contentHeight: 400 });
    expect(p.maxHeight).toBeLessThan(400);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(220);
  });
  it('cabe debajo => placement below, maxHeight >= contenido', () => {
    const p = computeMenuPosition({ top: 10, bottom: 40, left: 20, right: 120 }, { width: 360, height: 800 }, { contentHeight: 212 });
    expect(p.placement).toBe('below');
    expect(p.maxHeight).toBeGreaterThanOrEqual(212);
  });
});
