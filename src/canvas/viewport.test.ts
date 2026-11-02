import { describe, expect, it } from 'vitest';
import { clampZoom, MAX_ZOOM, MIN_ZOOM, zoomFromWheel } from './viewport';

describe('viewport: зум', () => {
  it('clampZoom держит диапазон 0.1…5', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(10)).toBe(MAX_ZOOM);
    expect(clampZoom(2)).toBe(2);
  });

  it('некорректное значение сбрасывается в 1', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('zoomFromWheel приближает и не выходит за границы', () => {
    expect(zoomFromWheel(1, -600)).toBeCloseTo(Math.pow(0.999, -600), 6);
    expect(zoomFromWheel(4.9, -1000)).toBe(MAX_ZOOM);
    expect(zoomFromWheel(0.11, 1000)).toBe(MIN_ZOOM);
  });
});
