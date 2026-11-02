/** Геометрия viewport: зум меняет только viewportTransform, не scale объектов. */

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 5;

export type ViewportTransform = [number, number, number, number, number, number];

export const IDENTITY_VIEWPORT: ViewportTransform = [1, 0, 0, 1, 0, 0];

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/** Один тик колеса: 0.999^deltaY. Ограничение 0.1…5. */
export function zoomFromWheel(current: number, deltaY: number): number {
  return clampZoom(current * Math.pow(0.999, deltaY));
}
