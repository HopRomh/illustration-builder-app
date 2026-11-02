import type { Scene } from '../types';
import type { Instance } from './store';

export interface Snapshot {
  instances: Instance[];
  selectedUid: string | null;
  scene: Scene;
}

export interface History {
  past: Snapshot[];
  present: Snapshot;
  future: Snapshot[];
}

export function cloneSnapshot(snapshot: Snapshot): Snapshot {
  return {
    instances: snapshot.instances.map((instance) => ({ ...instance })),
    selectedUid: snapshot.selectedUid,
    scene: { ...snapshot.scene },
  };
}

function trimPast(past: Snapshot[], limit: number): Snapshot[] {
  const max = Math.max(0, Math.floor(limit));
  if (past.length <= max) return past;
  return past.slice(past.length - max);
}

export function init(snapshot: Snapshot): History {
  return {
    past: [],
    present: cloneSnapshot(snapshot),
    future: [],
  };
}

/**
 * push кладёт предыдущий present в past, очищает redo-ветку и делает
 * переданный снапшот новым present. Входные данные не мутируются.
 */
export function push(history: History, snapshot: Snapshot, limit = 50): History {
  return {
    past: trimPast([...history.past, cloneSnapshot(history.present)], limit),
    present: cloneSnapshot(snapshot),
    future: [],
  };
}

export function undo(history: History): { history: History; snapshot: Snapshot | null } {
  if (history.past.length === 0) {
    return { history, snapshot: null };
  }

  const previous = history.past[history.past.length - 1];
  const present = cloneSnapshot(previous);
  return {
    history: {
      past: history.past.slice(0, -1),
      present,
      future: [cloneSnapshot(history.present), ...history.future],
    },
    snapshot: cloneSnapshot(present),
  };
}

export function redo(history: History): { history: History; snapshot: Snapshot | null } {
  if (history.future.length === 0) {
    return { history, snapshot: null };
  }

  const next = history.future[0];
  const present = cloneSnapshot(next);
  return {
    history: {
      past: trimPast([...history.past, cloneSnapshot(history.present)], 50),
      present,
      future: history.future.slice(1),
    },
    snapshot: cloneSnapshot(present),
  };
}

/**
 * Синхронизация present без нового шага истории. Нужна, когда reconciler
 * клампит координаты после действия и записывает фактические значения в стор.
 */
export function updatePresent(history: History, snapshot: Snapshot): History {
  return {
    ...history,
    present: cloneSnapshot(snapshot),
  };
}
