import { create } from 'zustand';
import {
  init,
  push as pushHistory,
  redo as redoHistory,
  undo as undoHistory,
  updatePresent,
} from './history';
import type { History, Snapshot } from './history';
import { DEFAULT_SCENE, isReconciling, useAppStore } from './store';

interface HistoryState {
  history: History;
  isRestoring: boolean;
  push(snapshot: Snapshot): void;
  syncPresent(snapshot: Snapshot): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

const initialSnapshot: Snapshot = {
  instances: [],
  selectedUid: null,
  scene: { ...DEFAULT_SCENE },
};

export const useHistoryStore = create<HistoryState>((set, get) => ({
  history: init(initialSnapshot),
  isRestoring: false,

  push(snapshot) {
    if (get().isRestoring || isReconciling()) return;
    set((state) => ({ history: pushHistory(state.history, snapshot) }));
  },

  syncPresent(snapshot) {
    set((state) => ({ history: updatePresent(state.history, snapshot) }));
  },

  undo() {
    const { history, isRestoring } = get();
    if (isRestoring || history.past.length === 0) return;

    set({ isRestoring: true });
    try {
      const result = undoHistory(history);
      if (!result.snapshot) return;

      useAppStore.getState().replaceSnapshot(result.snapshot);
      set({ history: result.history });
    } finally {
      set({ isRestoring: false });
    }
  },

  redo() {
    const { history, isRestoring } = get();
    if (isRestoring || history.future.length === 0) return;

    set({ isRestoring: true });
    try {
      const result = redoHistory(history);
      if (!result.snapshot) return;

      useAppStore.getState().replaceSnapshot(result.snapshot);
      set({ history: result.history });
    } finally {
      set({ isRestoring: false });
    }
  },

  canUndo() {
    return get().history.past.length > 0;
  },

  canRedo() {
    return get().history.future.length > 0;
  },
}));
