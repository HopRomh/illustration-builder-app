import { useEffect } from 'react';
import { useHistoryStore } from '../state/historyStore';
import { useAppStore } from '../state/store';

type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'code'>;

/**
 * Сравнивает и логическую клавишу, и физический code.
 * На русской раскладке Ctrl+Z приходит как key: 'я', code: 'KeyZ',
 * Ctrl+D — key: 'в', code: 'KeyD'.
 */
export function matchesShortcut(
  event: ShortcutEvent,
  latinKey: string,
  code: string,
  cyrillicKey: string,
): boolean {
  const key = event.key.toLowerCase();
  return key === latinKey || key === cyrillicKey || event.code === code;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  return target.isContentEditable;
}

export function useHotkeys(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      const { selectedUid, duplicate, remove, nudge } = useAppStore.getState();
      const key = event.key;
      const mod = event.ctrlKey || event.metaKey;
      const shift = event.shiftKey;

      const isUndoKey = matchesShortcut(event, 'z', 'KeyZ', 'я');
      const isDuplicateKey = matchesShortcut(event, 'd', 'KeyD', 'в');

      if (mod && isUndoKey) {
        event.preventDefault();
        if (shift) useHistoryStore.getState().redo();
        else useHistoryStore.getState().undo();
        return;
      }

      if (mod && isDuplicateKey) {
        event.preventDefault();
        if (selectedUid) duplicate(selectedUid);
        return;
      }

      if (key === 'Delete' || key === 'Backspace') {
        event.preventDefault();
        if (selectedUid) remove(selectedUid);
        return;
      }

      const step = shift ? 10 : 1;
      let dx = 0;
      let dy = 0;

      if (key === 'ArrowLeft') dx = -step;
      else if (key === 'ArrowRight') dx = step;
      else if (key === 'ArrowUp') dy = -step;
      else if (key === 'ArrowDown') dy = step;
      else return;

      event.preventDefault();
      if (selectedUid) nudge(selectedUid, dx, dy);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
