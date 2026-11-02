/**
 * Перенос композиции между форматами.
 *
 * Координаты объектов — центры (originX/originY = 'center'), поэтому
 * достаточно пересчитать центр холста и общий коэффициент. Пропорции
 * объектов относительно друг друга сохраняются: масштаб один на всю сцену.
 */
import { catalog } from '../library/catalog';
import type { Format, LibraryItem, Scene, Size, Variant } from '../types';
import type { Instance } from '../state/store';
import { clampRectToBounds, rotatedBounds } from './geometry';
import { FORMATS } from './sizing';

/**
 * Возвращает новый массив: вход не мутируется.
 *
 * k = min(W_to, H_to) / min(W_from, H_from) — для текущих трёх форматов
 * всегда 1, поэтому объекты центрируются, а не растягиваются.
 */
export function recenterRescale(
  instances: Instance[],
  fromFormat: Format,
  toFormat: Format,
): Instance[] {
  const from = FORMATS[fromFormat];
  const to = FORMATS[toFormat];
  const k = Math.min(to.width, to.height) / Math.min(from.width, from.height);

  return instances.map((instance) => ({
    ...instance,
    x: to.width / 2 + (instance.x - from.width / 2) * k,
    y: to.height / 2 + (instance.y - from.height / 2) * k,
    scale: instance.scale * k,
  }));
}

/** Доля формата, которую layout оставляет свободной у каждого края. */
export const LAYOUT_SAFE_INSET = 0.08;

const SUPPORT_ANGLES = [-6, 5, -4, 6, -5, 4, -3, 3];

/**
 * Порядок предпочтения слотов. Первые четыре — углы, затем середины сторон.
 * Для каждого следующего support'а порядок циклически сдвигается, чтобы
 * объекты не претендовали на один и тот же угол.
 */
const CLASSIC_SLOTS = [
  { x: 0.24, y: 0.24 },
  { x: 0.76, y: 0.76 },
  { x: 0.76, y: 0.24 },
  { x: 0.24, y: 0.76 },
  { x: 0.5, y: 0.2 },
  { x: 0.5, y: 0.8 },
  { x: 0.2, y: 0.5 },
  { x: 0.8, y: 0.5 },
];

const GRID_FRACTIONS = [0.15, 0.38, 0.62, 0.85];

interface Slot {
  x: number;
  y: number;
}

interface Measured {
  width: number;
  height: number;
}

interface PlacedBox {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

function variantKey(variant: Variant, size: Size): `${Variant}-${Size}` {
  return `${variant}-${size}`;
}

function measure(instance: Instance, items: LibraryItem[]): Measured {
  const item = items.find((entry) => entry.id === instance.itemId);
  const viewBox = item?.variants[variantKey(instance.variant, instance.size)]?.viewBox;

  // 1 — только страховка для битого инстанса; сценарий фильтрует такие заранее.
  return {
    width: Math.max((viewBox?.[2] ?? 1) * instance.scale, 1),
    height: Math.max((viewBox?.[3] ?? 1) * instance.scale, 1),
  };
}

function slotOrder(supportIndex: number): Slot[] {
  const offset = supportIndex % CLASSIC_SLOTS.length;
  const classic = [
    ...CLASSIC_SLOTS.slice(offset),
    ...CLASSIC_SLOTS.slice(0, offset),
  ];

  const grid: Slot[] = [];
  for (const x of GRID_FRACTIONS) {
    for (const y of GRID_FRACTIONS) {
      // Центр занят фокусом; сетка нужна только для краёв.
      if (x >= 0.38 && x <= 0.62 && y >= 0.38 && y <= 0.62) continue;
      grid.push({ x, y });
    }
  }
  grid.sort(
    (a, b) => Math.hypot(b.x - 0.5, b.y - 0.5) - Math.hypot(a.x - 0.5, a.y - 0.5),
  );

  const seen = new Set<string>();
  return [...classic, ...grid].filter((slot) => {
    const key = `${slot.x.toFixed(3)}:${slot.y.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function placeAt(
  x: number,
  y: number,
  width: number,
  height: number,
  bounds: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  const rect = {
    left: x - width / 2,
    top: y - height / 2,
    width,
    height,
  };

  const { dx, dy } = clampRectToBounds(rect, bounds);
  let left = rect.left + dx;
  let top = rect.top + dy;

  // Если объект больше safe-area, не прижимаем его к одному краю, а центрируем.
  if (width >= bounds.width) left = bounds.left + (bounds.width - width) / 2;
  if (height >= bounds.height) top = bounds.top + (bounds.height - height) / 2;

  return { x: left + width / 2, y: top + height / 2 };
}

function overlapArea(a: PlacedBox, b: PlacedBox): number {
  const width =
    Math.min(a.x + a.halfWidth, b.x + b.halfWidth) -
    Math.max(a.x - a.halfWidth, b.x - b.halfWidth);
  const height =
    Math.min(a.y + a.halfHeight, b.y + b.halfHeight) -
    Math.max(a.y - a.halfHeight, b.y - b.halfHeight);

  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Раскладка сценарной композиции: фокус в центре, остальные — по краям.
 *
 * scale не меняется. Объекты клампятся в safe-area с учётом повёрнутого bbox,
 * поэтому reconciler в CanvasStage не должен двигать их после загрузки.
 * focusIndex передаётся явно: для z-order фокус может быть последним в массиве.
 */
export function layoutComposition(
  instances: Instance[],
  scene: Scene,
  focusIndex = 0,
  items: LibraryItem[] = catalog.items,
): Instance[] {
  if (instances.length === 0) return [];

  const rawFocus = Number.isFinite(focusIndex) ? Math.trunc(focusIndex) : 0;
  const focus = Math.min(Math.max(rawFocus, 0), instances.length - 1);

  const format = FORMATS[scene.format];
  const insetX = format.width * LAYOUT_SAFE_INSET;
  const insetY = format.height * LAYOUT_SAFE_INSET;
  const bounds = {
    left: insetX,
    top: insetY,
    width: format.width - insetX * 2,
    height: format.height - insetY * 2,
  };

  const measured = instances.map((instance) => measure(instance, items));
  const result = instances.map((instance) => ({ ...instance }));
  const placed: PlacedBox[] = [];

  const focusMeasure = measured[focus];
  const focusPosition = placeAt(
    format.width / 2,
    format.height / 2,
    focusMeasure.width,
    focusMeasure.height,
    bounds,
  );

  result[focus] = {
    ...result[focus],
    x: focusPosition.x,
    y: focusPosition.y,
    angle: 0,
  };
  placed.push({
    x: focusPosition.x,
    y: focusPosition.y,
    halfWidth: focusMeasure.width / 2,
    halfHeight: focusMeasure.height / 2,
  });

  let supportIndex = 0;

  for (let index = 0; index < instances.length; index += 1) {
    if (index === focus) continue;

    const angle = SUPPORT_ANGLES[supportIndex % SUPPORT_ANGLES.length];
    const size = measured[index];
    const rotated = rotatedBounds(size.width, size.height, angle);
    const slots = slotOrder(supportIndex);

    let best: { position: { x: number; y: number }; overlap: number } | null = null;

    for (const slot of slots) {
      const position = placeAt(
        slot.x * format.width,
        slot.y * format.height,
        rotated.width,
        rotated.height,
        bounds,
      );
      const box: PlacedBox = {
        x: position.x,
        y: position.y,
        halfWidth: rotated.width / 2,
        halfHeight: rotated.height / 2,
      };
      const overlap = placed.reduce((sum, placedBox) => sum + overlapArea(box, placedBox), 0);

      if (!best || overlap < best.overlap - 1e-6) {
        best = { position, overlap };
      }
      if (overlap <= 1e-6) break;
    }

    const position = best?.position ?? {
      x: format.width / 2,
      y: format.height / 2,
    };

    result[index] = {
      ...result[index],
      x: position.x,
      y: position.y,
      angle,
    };
    placed.push({
      x: position.x,
      y: position.y,
      halfWidth: rotated.width / 2,
      halfHeight: rotated.height / 2,
    });

    supportIndex += 1;
  }

  return result;
}
