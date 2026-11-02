import { describe, expect, it } from 'vitest';
import {
  init,
  push,
  redo,
  undo,
} from './history';
import type { Snapshot } from './history';
import type { Instance } from './store';
import type { Scene } from '../types';

function makeInstance(x: number): Instance {
  return {
    uid: `instance-${x}`,
    itemId: 'book',
    variant: 'main',
    size: 'L',
    x,
    y: 0,
    scale: 0.4,
    angle: 0,
  };
}

function makeSnapshot(x: number, scene: Partial<Scene> = {}): Snapshot {
  return {
    instances: [makeInstance(x)],
    selectedUid: null,
    scene: { format: '1:1', size: 'L', scheme: 'lilac', scale: 0.4, ...scene },
  };
}

describe('history', () => {
  it('init создаёт пустую историю и клонирует снапшот', () => {
    const snapshot = makeSnapshot(1);
    const history = init(snapshot);

    expect(history.past).toEqual([]);
    expect(history.future).toEqual([]);
    expect(history.present.instances[0].x).toBe(1);
    expect(history.present.instances[0]).not.toBe(snapshot.instances[0]);
    expect(history.present.scene).toEqual(snapshot.scene);
    expect(history.present.scene).not.toBe(snapshot.scene);
  });

  it('undo и redo восстанавливают сцену вместе с инстансами', () => {
    const first = makeSnapshot(1, { format: '1:1', scheme: 'lilac' });
    const second = makeSnapshot(2, { format: '4:3', scheme: 'peach' });
    const pushed = push(init(first), second);

    const undone = undo(pushed);
    expect(undone.snapshot?.scene).toEqual(first.scene);
    expect(undone.history.present.scene.scheme).toBe('lilac');
    expect(undone.history.present.scene.format).toBe('1:1');

    const redone = redo(undone.history);
    expect(redone.snapshot?.scene).toEqual(second.scene);
    expect(redone.history.present.scene.scheme).toBe('peach');
    expect(redone.history.present.scene.format).toBe('4:3');
  });

  it('push кладёт предыдущий present в past, а новый — в present', () => {
    const first = makeSnapshot(1);
    const second = makeSnapshot(2);
    const history = push(init(first), second);

    expect(history.past).toHaveLength(1);
    expect(history.past[0].instances[0].x).toBe(1);
    expect(history.present.instances[0].x).toBe(2);
    expect(history.future).toEqual([]);
  });

  it('undo и redo возвращают снапшоты и двигают present', () => {
    const first = makeSnapshot(1);
    const second = makeSnapshot(2);
    const pushed = push(init(first), second);

    const undone = undo(pushed);
    expect(undone.snapshot?.instances[0].x).toBe(1);
    expect(undone.history.present.instances[0].x).toBe(1);
    expect(undone.history.future).toHaveLength(1);

    const redone = redo(undone.history);
    expect(redone.snapshot?.instances[0].x).toBe(2);
    expect(redone.history.present.instances[0].x).toBe(2);
    expect(redone.history.past).toHaveLength(1);
  });

  it('undo/redo на границах — no-op', () => {
    const history = init(makeSnapshot(1));

    const undone = undo(history);
    expect(undone.snapshot).toBeNull();
    expect(undone.history).toBe(history);

    const redone = redo(history);
    expect(redone.snapshot).toBeNull();
    expect(redone.history).toBe(history);
  });

  it('push очищает redo-ветку', () => {
    const first = makeSnapshot(1);
    const second = makeSnapshot(2);
    const third = makeSnapshot(3);

    const undone = undo(push(init(first), second));
    expect(undone.history.future).toHaveLength(1);

    const pushed = push(undone.history, third);
    expect(pushed.future).toEqual([]);
    expect(pushed.present.instances[0].x).toBe(3);
  });

  it('держит лимит 50 и вытесняет самый старый снапшот', () => {
    let history = init(makeSnapshot(0));
    for (let index = 1; index <= 51; index += 1) {
      history = push(history, makeSnapshot(index));
    }

    expect(history.past).toHaveLength(50);
    expect(history.past[0].instances[0].x).toBe(1);
    expect(history.present.instances[0].x).toBe(51);
  });

  it('не мутирует вход и клонирует инстансы', () => {
    const first = makeSnapshot(1);
    const second = makeSnapshot(2);
    const originalX = first.instances[0].x;

    const history = init(first);
    const pushed = push(history, second);

    expect(first.instances[0].x).toBe(originalX);
    expect(history.present.instances[0]).not.toBe(first.instances[0]);
    expect(pushed.present.instances[0]).not.toBe(second.instances[0]);
    expect(pushed.past[0].instances[0]).not.toBe(first.instances[0]);
  });
});
