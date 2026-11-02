import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SCENE, isReconciling, useAppStore } from './store';
import type { Instance } from './store';

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

function seed(instances: Instance[], selectedUid: string | null = null): void {
  useAppStore.setState({ instances, selectedUid, scene: { ...DEFAULT_SCENE } });
}

function current(): Instance[] {
  return useAppStore.getState().instances;
}

function uids(): string[] {
  return current().map((instance) => instance.uid);
}

beforeEach(() => {
  seed([], null);
});

describe('store: add/duplicate/remove', () => {
  it('add кладёт инстанс в конец и выделяет его', () => {
    const uid = useAppStore.getState().add({
      itemId: 'book',
      variant: 'main',
      size: 'L',
      x: 540,
      y: 540,
      angle: 0,
    });

    expect(current()).toHaveLength(1);
    expect(current()[0].uid).toBe(uid);
    expect(current()[0].scale).toBe(0.4);
    expect(useAppStore.getState().selectedUid).toBe(uid);
  });

  it('add берёт единый масштаб из сцены, а не из аргумента', () => {
    useAppStore.getState().setScene({ format: '4:3' });

    const uid = useAppStore.getState().add({
      itemId: 'book',
      variant: 'main',
      size: 'L',
      x: 720,
      y: 540,
      angle: 0,
    });

    expect(current()[0].uid).toBe(uid);
    expect(current()[0].scale).toBe(0.4);
  });

  it('duplicate создаёт новый uid со смещением +20/+20 и ставит в конец', () => {
    seed([makeInstance({ uid: 'a', x: 100, y: 200 })], 'a');

    const newUid = useAppStore.getState().duplicate('a');

    expect(newUid).not.toBeNull();
    expect(newUid).not.toBe('a');
    expect(uids()).toEqual(['a', newUid]);
    expect(current()[1].x).toBe(120);
    expect(current()[1].y).toBe(220);
    expect(current()[1].angle).toBe(0);
    expect(useAppStore.getState().selectedUid).toBe(newUid);
  });

  it('duplicate несуществующего uid возвращает null и ничего не меняет', () => {
    seed([makeInstance()]);

    expect(useAppStore.getState().duplicate('missing')).toBeNull();
    expect(uids()).toEqual(['a']);
  });

  it('remove удаляет инстанс и сбрасывает выделение только для него', () => {
    seed([makeInstance({ uid: 'a' }), makeInstance({ uid: 'b' })], 'b');

    useAppStore.getState().remove('b');

    expect(uids()).toEqual(['a']);
    expect(useAppStore.getState().selectedUid).toBeNull();

    seed([makeInstance({ uid: 'a' }), makeInstance({ uid: 'b' })], 'a');
    useAppStore.getState().remove('b');
    expect(useAppStore.getState().selectedUid).toBe('a');
  });
});

describe('store: transform', () => {
  it('nudge меняет x/y на дельту и не клампит', () => {
    seed([makeInstance({ x: 100, y: 200 })]);

    useAppStore.getState().nudge('a', -150, 20);

    expect(current()[0].x).toBe(-50);
    expect(current()[0].y).toBe(220);
  });

  it('setPosition задаёт абсолютные координаты', () => {
    seed([makeInstance({ x: 100, y: 200 })]);

    useAppStore.getState().setPosition('a', 540, 600);

    expect(current()[0].x).toBe(540);
    expect(current()[0].y).toBe(600);
  });

  it('rotate нормализует угол в [0, 360)', () => {
    seed([makeInstance({ angle: 0 })]);

    useAppStore.getState().rotate('a', -30);
    expect(current()[0].angle).toBe(330);

    useAppStore.getState().rotate('a', 725);
    expect(current()[0].angle).toBe(5);
  });
});

describe('store: z-order', () => {
  const three = (): Instance[] => [
    makeInstance({ uid: 'a' }),
    makeInstance({ uid: 'b' }),
    makeInstance({ uid: 'c' }),
  ];

  it('bringForward меняет местами с соседом сверху', () => {
    seed(three());
    useAppStore.getState().bringForward('b');
    expect(uids()).toEqual(['a', 'c', 'b']);
  });

  it('bringForward верхнего — no-op', () => {
    seed(three());
    const before = current();
    useAppStore.getState().bringForward('c');
    expect(current()).toBe(before);
  });

  it('sendBackward меняет местами с соседом снизу', () => {
    seed(three());
    useAppStore.getState().sendBackward('b');
    expect(uids()).toEqual(['b', 'a', 'c']);
  });

  it('sendBackward нижнего — no-op', () => {
    seed(three());
    const before = current();
    useAppStore.getState().sendBackward('a');
    expect(current()).toBe(before);
  });

  it('bringToFront переносит в конец массива', () => {
    seed(three());
    useAppStore.getState().bringToFront('a');
    expect(uids()).toEqual(['b', 'c', 'a']);
  });

  it('sendToBack переносит в начало массива', () => {
    seed(three());
    useAppStore.getState().sendToBack('c');
    expect(uids()).toEqual(['c', 'a', 'b']);
  });
});

describe('store: scene и variant', () => {
  it('setVariant меняет только variant, сохраняя uid/x/y/angle/scale/индекс', () => {
    seed(
      [
        makeInstance({ uid: 'a' }),
        makeInstance({ uid: 'b', x: 300, y: 400, angle: 45, scale: 0.4 }),
        makeInstance({ uid: 'c' }),
      ],
      'b',
    );

    useAppStore.getState().setVariant('b', 'background');

    const updated = current();
    expect(updated.map((item) => item.uid)).toEqual(['a', 'b', 'c']);
    expect(updated[1]).toMatchObject({
      uid: 'b',
      variant: 'background',
      x: 300,
      y: 400,
      angle: 45,
      scale: 0.4,
    });
    expect(useAppStore.getState().selectedUid).toBe('b');
  });

  it('setVariant с тем же значением не меняет массив', () => {
    seed([makeInstance({ uid: 'a', variant: 'main' })]);
    const before = current();

    useAppStore.getState().setVariant('a', 'main');

    expect(current()).toBe(before);
  });

  it('setScene 1:1 → 4:3 центрирует объекты и сохраняет масштаб', () => {
    seed([makeInstance({ x: 100, y: 200, scale: 0.4 })]);
    const before = current();

    useAppStore.getState().setScene({ format: '4:3' });

    expect(current()[0].x).toBe(280);
    expect(current()[0].y).toBe(200);
    expect(current()[0].scale).toBe(0.4);
    expect(before[0].x).toBe(100);
    expect(useAppStore.getState().scene).toMatchObject({ format: '4:3', scale: 0.4 });
  });

  it('setScene 1:1 → 3:4 сдвигает объекты по вертикали', () => {
    seed([makeInstance({ x: 100, y: 200 })]);

    useAppStore.getState().setScene({ format: '3:4' });

    expect(current()[0].x).toBe(100);
    expect(current()[0].y).toBe(380);
    expect(useAppStore.getState().scene.format).toBe('3:4');
  });

  it('setScene со сменой только схемы не пересоздаёт instances', () => {
    seed([makeInstance()]);
    const before = current();

    useAppStore.getState().setScene({ scheme: 'peach' });

    expect(useAppStore.getState().scene.scheme).toBe('peach');
    expect(useAppStore.getState().scene.scale).toBe(0.4);
    expect(current()).toBe(before);
  });

  it('setScene на текущий формат — no-op', () => {
    seed([makeInstance()]);
    const before = current();
    const beforeScene = useAppStore.getState().scene;

    useAppStore.getState().setScene({ format: '1:1' });

    expect(current()).toBe(before);
    expect(useAppStore.getState().scene).toBe(beforeScene);
  });

  it('setSceneSize L → S сохраняет uid/x/y/angle/scale/индекс и меняет size', () => {
    seed(
      [
        makeInstance({ uid: 'a', itemId: 'book', x: 100, y: 200, angle: 30, scale: 0.4 }),
        makeInstance({ uid: 'b', itemId: 'coin', x: 300, y: 400, angle: 45, scale: 0.4 }),
      ],
      'b',
    );

    useAppStore.getState().setSceneSize('S');

    const updated = current();
    expect(updated.map((item) => item.uid)).toEqual(['a', 'b']);
    expect(updated[0]).toMatchObject({
      uid: 'a',
      itemId: 'book',
      size: 'S',
      x: 100,
      y: 200,
      angle: 30,
      scale: 0.4,
    });
    expect(updated[1]).toMatchObject({
      uid: 'b',
      itemId: 'coin',
      size: 'S',
      x: 300,
      y: 400,
      angle: 45,
      scale: 0.4,
    });
    expect(updated[0].missingVariant).toBeUndefined();
    expect(updated[1].missingVariant).toBeUndefined();
    expect(useAppStore.getState().scene.size).toBe('S');
    expect(useAppStore.getState().selectedUid).toBe('b');
  });

  it('setSceneSize L → S → L возвращает исходный размер и снимает missingVariant', () => {
    seed([makeInstance({ uid: 'a', itemId: 'book' })]);

    useAppStore.getState().setSceneSize('S');
    expect(current()[0].size).toBe('S');

    useAppStore.getState().setSceneSize('L');
    expect(current()[0].size).toBe('L');
    expect(current()[0].missingVariant).toBeUndefined();
    expect(useAppStore.getState().scene.size).toBe('L');
  });

  it('setSceneSize помечает missingVariant, если варианта нет в каталоге', () => {
    seed([makeInstance({ uid: 'a', itemId: 'unknown-item', x: 10, y: 20, angle: 15 })]);

    useAppStore.getState().setSceneSize('S');

    expect(current()[0]).toMatchObject({
      uid: 'a',
      itemId: 'unknown-item',
      size: 'S',
      x: 10,
      y: 20,
      angle: 15,
      missingVariant: true,
    });
  });

  it('setSceneSize на текущий размер — no-op', () => {
    seed([makeInstance()]);
    const before = current();
    const beforeScene = useAppStore.getState().scene;

    useAppStore.getState().setSceneSize('L');

    expect(current()).toBe(before);
    expect(useAppStore.getState().scene).toBe(beforeScene);
  });

  it('setScene({ size }) тоже переключает варианты (единая логика)', () => {
    seed([makeInstance({ uid: 'a', itemId: 'book' })]);

    useAppStore.getState().setScene({ size: 'S' });

    expect(current()[0].size).toBe('S');
    expect(useAppStore.getState().scene.size).toBe('S');
  });

  it('setVariant снимает missingVariant, когда нужный вариант существует', () => {
    seed([makeInstance({ uid: 'a', itemId: 'book', variant: 'main', size: 'S', missingVariant: true })]);

    useAppStore.getState().setVariant('a', 'background');

    expect(current()[0].variant).toBe('background');
    expect(current()[0].missingVariant).toBeUndefined();
  });

  it('setVariant помечает missingVariant, когда нужного варианта нет', () => {
    seed([makeInstance({ uid: 'a', itemId: 'unknown-item', variant: 'main', size: 'S' })]);

    useAppStore.getState().setVariant('a', 'background');

    expect(current()[0]).toMatchObject({
      variant: 'background',
      missingVariant: true,
    });
  });

  it('replaceSnapshot восстанавливает instances/selectedUid/scene и копирует данные', () => {
    seed([makeInstance({ uid: 'a' })], 'a');
    const restored = [makeInstance({ uid: 'b', x: 10, y: 20 })];

    useAppStore.getState().replaceSnapshot({
      instances: restored,
      selectedUid: 'b',
      scene: { format: '3:4', size: 'L', scheme: 'mint', scale: 0.4 },
    });

    expect(uids()).toEqual(['b']);
    expect(useAppStore.getState().selectedUid).toBe('b');
    expect(useAppStore.getState().scene).toEqual({
      format: '3:4',
      size: 'L',
      scheme: 'mint',
      scale: 0.4,
    });
    expect(current()[0]).not.toBe(restored[0]);
  });

  it('replaceSnapshot с невалидным selectedUid сбрасывает выделение', () => {
    seed([makeInstance({ uid: 'a' })], 'a');

    useAppStore.getState().replaceSnapshot({
      instances: [makeInstance({ uid: 'b' })],
      selectedUid: 'a',
      scene: DEFAULT_SCENE,
    });

    expect(useAppStore.getState().selectedUid).toBeNull();
  });
});

describe('store: addMany', () => {
  function makeInputs(ids: string[]) {
    return ids.map((itemId, index) => ({
      itemId,
      variant: index === 0 ? ('main' as const) : ('background' as const),
      size: 'L' as const,
      x: 100 + index,
      y: 200 + index,
      angle: 0,
    }));
  }

  it('делает один set: одно уведомление подписчиков', () => {
    let calls = 0;
    const unsubscribe = useAppStore.subscribe(() => {
      calls += 1;
    });

    useAppStore.getState().addMany(makeInputs(['book', 'phone', 'lamp']), 0);
    unsubscribe();

    expect(calls).toBe(1);
  });

  it('сохраняет порядок inputs и возвращает uid в том же порядке', () => {
    const uids = useAppStore
      .getState()
      .addMany(makeInputs(['book', 'phone', 'lamp']), 0);

    expect(uids).toHaveLength(3);
    expect(new Set(uids).size).toBe(3);
    expect(current().map((instance) => instance.itemId)).toEqual([
      'book',
      'phone',
      'lamp',
    ]);
    expect(current().map((instance) => instance.uid)).toEqual(uids);
    expect(current()[0].x).toBe(100);
    expect(current()[1].x).toBe(101);
    expect(current()[2].x).toBe(102);
  });

  it('дописывает объекты в конец существующего массива', () => {
    seed([makeInstance({ uid: 'existing' })]);

    const created = useAppStore.getState().addMany(makeInputs(['phone', 'lamp']), 0);

    expect(uids()).toEqual(['existing', ...created]);
  });

  it('выделяет фокус по focusIndex, а не первый объект', () => {
    const uids = useAppStore
      .getState()
      .addMany(makeInputs(['phone', 'lamp', 'book']), 2);

    expect(useAppStore.getState().selectedUid).toBe(uids[2]);
  });

  it('по умолчанию выделяет последний объект (он же верхний слой)', () => {
    const uids = useAppStore
      .getState()
      .addMany(makeInputs(['book', 'phone', 'lamp']));

    expect(useAppStore.getState().selectedUid).toBe(uids[2]);
  });

  it('клампит focusIndex в допустимый диапазон', () => {
    const below = useAppStore.getState().addMany(makeInputs(['book', 'phone']), -3);
    expect(useAppStore.getState().selectedUid).toBe(below[0]);

    const above = useAppStore.getState().addMany(makeInputs(['book', 'phone']), 99);
    expect(useAppStore.getState().selectedUid).toBe(above[1]);
  });

  it('берёт scale из сцены и ставит корректный missingVariant', () => {
    useAppStore.getState().setScene({ format: '4:3' });

    useAppStore
      .getState()
      .addMany(
        [
          {
            itemId: 'book',
            variant: 'main',
            size: 'L',
            x: 100,
            y: 100,
            angle: 0,
          },
          {
            itemId: 'unknown-item',
            variant: 'background',
            size: 'L',
            x: 200,
            y: 200,
            angle: 0,
          },
        ],
        0,
      );

    expect(current()[0].scale).toBe(0.4);
    expect(current()[1].scale).toBe(0.4);
    expect(current()[0].missingVariant).toBeUndefined();
    expect(current()[1].missingVariant).toBe(true);
  });

  it('пустой вход не меняет стор и не уведомляет', () => {
    let calls = 0;
    const unsubscribe = useAppStore.subscribe(() => {
      calls += 1;
    });

    const uids = useAppStore.getState().addMany([], 0);
    unsubscribe();

    expect(uids).toEqual([]);
    expect(calls).toBe(0);
    expect(current()).toEqual([]);
  });
});

describe('store: replaceInstances и updateFromCanvas', () => {
  it('replaceInstances сбрасывает невалидный selectedUid', () => {
    seed([makeInstance({ uid: 'a' })], 'a');

    useAppStore
      .getState()
      .replaceInstances([makeInstance({ uid: 'b' })], 'a');

    expect(uids()).toEqual(['b']);
    expect(useAppStore.getState().selectedUid).toBeNull();
  });

  it('replaceInstances сохраняет валидный selectedUid и копирует инстансы', () => {
    const snapshot = [makeInstance({ uid: 'b' })];

    useAppStore.getState().replaceInstances(snapshot, 'b');

    expect(useAppStore.getState().selectedUid).toBe('b');
    expect(current()[0]).not.toBe(snapshot[0]);
  });

  it('updateFromCanvas пишет значения и поднимает isReconciling только на время set', () => {
    seed([makeInstance({ uid: 'a', x: 10, y: 20, angle: 0 })]);

    const seen: boolean[] = [];
    const unsubscribe = useAppStore.subscribe(() => {
      seen.push(isReconciling());
    });

    useAppStore.getState().updateFromCanvas('a', {
      x: 30,
      y: 40,
      angle: -15,
      isReconciling: true,
    });
    unsubscribe();

    expect(current()[0].x).toBe(30);
    expect(current()[0].y).toBe(40);
    expect(current()[0].angle).toBe(345);
    expect(seen).toEqual([true]);
    expect(isReconciling()).toBe(false);
  });

  it('updateFromCanvas не уведомляет, если значения не изменились', () => {
    seed([makeInstance({ uid: 'a', x: 10, y: 20, angle: 0 })]);

    let calls = 0;
    const unsubscribe = useAppStore.subscribe(() => {
      calls += 1;
    });

    useAppStore.getState().updateFromCanvas('a', { x: 10, y: 20, angle: 0 });
    unsubscribe();

    expect(calls).toBe(0);
  });
});
