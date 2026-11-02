import { describe, expect, it } from 'vitest';
import { catalog } from '../library/catalog';
import type { Instance } from '../state/store';
import type { Format, Scene } from '../types';
import { rotatedBounds } from './geometry';
import { LAYOUT_SAFE_INSET, layoutComposition, recenterRescale } from './layout';
import { FORMATS, formatAspectRatio, getFormatScale, getSceneScale } from './sizing';

function makeInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    uid: 'a',
    itemId: 'book',
    variant: 'main',
    size: 'L',
    x: 100,
    y: 200,
    scale: 0.4,
    angle: 0,
    ...overrides,
  };
}

describe('layout: recenterRescale', () => {
  it('1:1 → 4:3 центрирует по x, не меняя y и масштаб', () => {
    const result = recenterRescale([makeInstance()], '1:1', '4:3');

    expect(result[0].x).toBe(280);
    expect(result[0].y).toBe(200);
    expect(result[0].scale).toBe(0.4);
  });

  it('1:1 → 3:4 центрирует по y, не меняя x', () => {
    const result = recenterRescale([makeInstance()], '1:1', '3:4');

    expect(result[0].x).toBe(100);
    expect(result[0].y).toBe(380);
    expect(result[0].scale).toBe(0.4);
  });

  it('4:3 → 1:1 и 3:4 → 1:1 возвращают обратные сдвиги', () => {
    const fromLandscape = recenterRescale([makeInstance({ x: 280, y: 200 })], '4:3', '1:1');
    expect(fromLandscape[0].x).toBe(100);
    expect(fromLandscape[0].y).toBe(200);

    const fromPortrait = recenterRescale([makeInstance({ x: 100, y: 380 })], '3:4', '1:1');
    expect(fromPortrait[0].x).toBe(100);
    expect(fromPortrait[0].y).toBe(200);
  });

  it('сохраняет композицию при цикле форматов', () => {
    const source = [makeInstance(), makeInstance({ uid: 'b', x: 700, y: 900 })];
    const roundTrip = recenterRescale(
      recenterRescale(source, '1:1', '4:3'),
      '4:3',
      '1:1',
    );

    expect(roundTrip[0]).toMatchObject({ x: 100, y: 200, scale: 0.4 });
    expect(roundTrip[1]).toMatchObject({ x: 700, y: 900, scale: 0.4 });
  });

  it('не мутирует вход и возвращает новые объекты', () => {
    const source = [makeInstance()];

    const result = recenterRescale(source, '1:1', '4:3');

    expect(source[0].x).toBe(100);
    expect(result).not.toBe(source);
    expect(result[0]).not.toBe(source[0]);
  });
});

function makeScene(format: Format): Scene {
  return { format, size: 'L', scheme: 'lilac', scale: 0.4 };
}

function makeItemInstance(
  itemId: string,
  uid: string,
  overrides: Partial<Instance> = {},
): Instance {
  return makeInstance({ uid, itemId, variant: 'main', ...overrides });
}

function visualBounds(instance: Instance): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const item = catalog.items.find((entry) => entry.id === instance.itemId);
  const viewBox = item?.variants[`${instance.variant}-${instance.size}`]?.viewBox;

  if (!viewBox) throw new Error(`Нет viewBox для ${instance.itemId}`);

  const rotated = rotatedBounds(
    viewBox[2] * instance.scale,
    viewBox[3] * instance.scale,
    instance.angle,
  );

  return {
    left: instance.x - rotated.width / 2,
    right: instance.x + rotated.width / 2,
    top: instance.y - rotated.height / 2,
    bottom: instance.y + rotated.height / 2,
  };
}

describe('layout: layoutComposition', () => {
  const formats: Format[] = ['1:1', '4:3', '3:4'];

  it.each(formats)('все объекты внутри safe-area для формата %s', (format) => {
    const source = [
      makeItemInstance('book', 'focus'),
      makeItemInstance('phone', 'support-1'),
      makeItemInstance('lamp', 'support-2'),
    ];

    const laid = layoutComposition(source, makeScene(format), 0);
    const { width, height } = FORMATS[format];
    const insetX = width * LAYOUT_SAFE_INSET;
    const insetY = height * LAYOUT_SAFE_INSET;
    const epsilon = 1e-6;

    expect(laid).toHaveLength(3);

    for (const instance of laid) {
      const bounds = visualBounds(instance);

      expect(bounds.left).toBeGreaterThanOrEqual(insetX - epsilon);
      expect(bounds.right).toBeLessThanOrEqual(width - insetX + epsilon);
      expect(bounds.top).toBeGreaterThanOrEqual(insetY - epsilon);
      expect(bounds.bottom).toBeLessThanOrEqual(height - insetY + epsilon);
    }
  });

  it('ставит фокус в центр, а не на место instances[0]', () => {
    const source = [
      makeItemInstance('book', 'book'),
      makeItemInstance('phone', 'focus'),
      makeItemInstance('lamp', 'lamp'),
    ];

    const laid = layoutComposition(source, makeScene('1:1'), 1);

    expect(laid.map((instance) => instance.uid)).toEqual(['book', 'focus', 'lamp']);
    expect(laid[1]).toMatchObject({ x: 540, y: 540, angle: 0 });
    expect(laid[0].angle).not.toBe(0);
    expect(laid[2].angle).not.toBe(0);
  });

  it('не меняет scale ни у фокуса, ни у support-объектов', () => {
    const source = [
      makeItemInstance('book', 'focus', { scale: 0.37 }),
      makeItemInstance('phone', 'support', { scale: 0.37 }),
    ];

    const laid = layoutComposition(source, makeScene('1:1'), 0);

    expect(laid.every((instance) => instance.scale === 0.37)).toBe(true);
  });

  it('держит детерминированные углы в диапазоне ±8°', () => {
    const source = [
      makeItemInstance('book', 'focus'),
      makeItemInstance('phone', 'a'),
      makeItemInstance('lamp', 'b'),
      makeItemInstance('headphones', 'c'),
    ];

    const first = layoutComposition(source, makeScene('1:1'), 0);
    const second = layoutComposition(source, makeScene('1:1'), 0);

    expect(second).toEqual(first);
    expect(first[0].angle).toBe(0);
    for (const instance of first.slice(1)) {
      expect(Math.abs(instance.angle)).toBeLessThanOrEqual(8);
    }
  });

  it('не мутирует вход и возвращает новые объекты', () => {
    const source = [
      makeItemInstance('book', 'focus', { x: 10, y: 20 }),
      makeItemInstance('phone', 'support', { x: 30, y: 40, angle: 30 }),
    ];
    const snapshot = source.map((instance) => ({ ...instance }));

    const laid = layoutComposition(source, makeScene('1:1'), 0);

    expect(source).toEqual(snapshot);
    expect(laid).not.toBe(source);
    expect(laid[0]).not.toBe(source[0]);
    expect(laid[1]).not.toBe(source[1]);
  });

  it.each([1, 2, 3, 4, 5])('корректно раскладывает %i объект(а/ов)', (count) => {
    const ids = ['book', 'phone', 'lamp', 'headphones', 'wallet'];
    const source = ids
      .slice(0, count)
      .map((id, index) => makeItemInstance(id, `uid-${index}`));

    const laid = layoutComposition(source, makeScene('1:1'), 0);

    expect(laid).toHaveLength(count);
    expect(laid.map((instance) => instance.uid)).toEqual(
      source.map((instance) => instance.uid),
    );

    for (const instance of laid) {
      const bounds = visualBounds(instance);
      const inset = FORMATS['1:1'].width * LAYOUT_SAFE_INSET;
      const epsilon = 1e-6;

      expect(bounds.left).toBeGreaterThanOrEqual(inset - epsilon);
      expect(bounds.right).toBeLessThanOrEqual(FORMATS['1:1'].width - inset + epsilon);
      expect(bounds.top).toBeGreaterThanOrEqual(inset - epsilon);
      expect(bounds.bottom).toBeLessThanOrEqual(FORMATS['1:1'].height - inset + epsilon);
    }
  });

  it('не пересекает мелкие объекты при пяти инстансах', () => {
    const ids = ['coin', 'wallet', 'pen', 'phone', 'puzzle'];
    const source = ids.map((id, index) => makeItemInstance(id, `uid-${index}`));

    const laid = layoutComposition(source, makeScene('1:1'), 0);
    const boxes = laid.map(visualBounds);

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);

        expect(overlapX <= 0 || overlapY <= 0).toBe(true);
      }
    }
  });

  it('клампит focusIndex за пределами массива', () => {
    const source = [
      makeItemInstance('book', 'a'),
      makeItemInstance('phone', 'b'),
    ];

    expect(layoutComposition(source, makeScene('1:1'), -5)[0]).toMatchObject({
      x: 540,
      y: 540,
    });
    expect(layoutComposition(source, makeScene('1:1'), 99)[1]).toMatchObject({
      x: 540,
      y: 540,
    });
  });

  it('возвращает пустой массив для пустого входа', () => {
    expect(layoutComposition([], makeScene('1:1'), 0)).toEqual([]);
  });
});

describe('sizing: формат и масштаб', () => {
  it('getFormatScale = 1 для всех трёх форматов', () => {
    expect(getFormatScale('1:1')).toBe(1);
    expect(getFormatScale('4:3')).toBe(1);
    expect(getFormatScale('3:4')).toBe(1);
  });

  it('getSceneScale сохраняет базовый масштаб 0.4 на всех форматах', () => {
    expect(getSceneScale({ format: '1:1' })).toBe(0.4);
    expect(getSceneScale({ format: '4:3' })).toBe(0.4);
    expect(getSceneScale({ format: '3:4' })).toBe(0.4);
  });

  it('formatAspectRatio отдаёт CSS-значения', () => {
    expect(formatAspectRatio('1:1')).toBe('1 / 1');
    expect(formatAspectRatio('4:3')).toBe('4 / 3');
    expect(formatAspectRatio('3:4')).toBe('3 / 4');
  });
});
