import { describe, expect, it } from 'vitest';
import { catalog } from '../library/catalog';
import type { LibraryItem, Scene } from '../types';
import { composeScenario } from './compose';

const scene: Scene = {
  format: '1:1',
  size: 'L',
  scheme: 'lilac',
  scale: 0.4,
};

function itemById(id: string): LibraryItem {
  const item = catalog.items.find((entry) => entry.id === id);
  if (!item) throw new Error(`Нет объекта ${id}`);
  return item;
}

/** Объект только с main-L: не подходит на роль background в размере L. */
const mainOnly: LibraryItem = {
  id: 'partial-main',
  name: 'Частичный',
  tags: ['частичный'],
  variants: {
    'main-L': { file: 'partial-main.svg', viewBox: [0, 0, 200, 200] },
  },
};

/** Объект только с background-L: не подходит на роль фокуса (main). */
const backgroundOnly: LibraryItem = {
  id: 'partial-background',
  name: 'Фоновый',
  tags: ['фоновый'],
  variants: {
    'background-L': { file: 'partial-background.svg', viewBox: [0, 0, 200, 200] },
  },
};

const items = [...catalog.items, mainOnly, backgroundOnly];

describe('compose: composeScenario', () => {
  it('ставит первый объект фокусом, остальные — background', () => {
    const result = composeScenario(
      [itemById('book'), itemById('phone'), itemById('lamp')],
      scene,
      items,
    );

    expect(result.skipped).toEqual([]);
    expect(result.inputs.map((input) => input.itemId)).toEqual([
      'phone',
      'lamp',
      'book',
    ]);
    expect(result.inputs.map((input) => input.variant)).toEqual([
      'background',
      'background',
      'main',
    ]);
    expect(result.focusIndex).toBe(2);
  });

  it('кладёт фокус последним и в центр холста (верхний слой)', () => {
    const result = composeScenario(
      [itemById('book'), itemById('phone'), itemById('lamp')],
      scene,
      items,
    );

    expect(result.inputs[result.focusIndex]).toMatchObject({
      itemId: 'book',
      variant: 'main',
      x: 540,
      y: 540,
      angle: 0,
    });
  });

  it('дедуплицирует одинаковые объекты по itemId', () => {
    const result = composeScenario(
      [itemById('book'), itemById('book')],
      scene,
      items,
    );

    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0]).toMatchObject({ itemId: 'book', variant: 'main' });
    expect(result.focusIndex).toBe(0);
  });

  it('пропускает support без нужного варианта и сообщает о нём', () => {
    const result = composeScenario([itemById('book'), mainOnly], scene, items);

    expect(result.inputs.map((input) => input.itemId)).toEqual(['book']);
    expect(result.focusIndex).toBe(0);
    expect(result.skipped).toEqual([
      {
        itemId: 'partial-main',
        name: 'Частичный',
        size: 'L',
        variant: 'background',
      },
    ]);
  });

  it('передаёт роль фокуса следующему объекту, если первый не подошёл', () => {
    const result = composeScenario(
      [backgroundOnly, itemById('book')],
      scene,
      items,
    );

    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0]).toMatchObject({ itemId: 'book', variant: 'main' });
    expect(result.skipped).toEqual([
      {
        itemId: 'partial-background',
        name: 'Фоновый',
        size: 'L',
        variant: 'main',
      },
    ]);
  });

  it('учитывает размер сцены при проверке вариантов', () => {
    const result = composeScenario([itemById('book'), mainOnly], {
      ...scene,
      size: 'S',
    }, items);

    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0]).toMatchObject({ itemId: 'book', size: 'S' });
    expect(result.skipped[0]).toMatchObject({
      itemId: 'partial-main',
      size: 'S',
      variant: 'background',
    });
  });

  it('возвращает пустой результат, если не подошёл ни один объект', () => {
    const result = composeScenario([backgroundOnly], scene, items);

    expect(result.inputs).toEqual([]);
    expect(result.focusIndex).toBe(-1);
    expect(result.skipped).toHaveLength(1);
  });

  it('для одного объекта делает его main-фокусом', () => {
    const result = composeScenario([itemById('lamp')], scene, items);

    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0]).toMatchObject({
      itemId: 'lamp',
      variant: 'main',
      size: 'L',
      x: 540,
      y: 540,
    });
    expect(result.focusIndex).toBe(0);
  });

  it('не мутирует массив выбранных объектов', () => {
    const selected = [itemById('book'), itemById('phone')];
    const snapshot = [...selected];

    composeScenario(selected, scene, items);

    expect(selected).toEqual(snapshot);
  });
});
