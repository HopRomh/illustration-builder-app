import { useEffect } from 'react';
import { CanvasStage } from './canvas/CanvasStage';
import { LibraryPanel } from './library/LibraryPanel';
import { LayersPanel } from './panels/LayersPanel';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { Toolbar } from './panels/Toolbar';
import { useHistoryStore } from './state/historyStore';
import { isReconciling, useAppStore } from './state/store';

export default function App() {
  useEffect(() => {
    return useAppStore.subscribe((state, previous) => {
      const instancesChanged = state.instances !== previous.instances;
      const selectionChanged = state.selectedUid !== previous.selectedUid;
      const sceneChanged = state.scene !== previous.scene;
      if (!instancesChanged && !selectionChanged && !sceneChanged) return;

      const snapshot = {
        instances: state.instances,
        selectedUid: state.selectedUid,
        scene: state.scene,
      };
      const history = useHistoryStore.getState();

      // Во время undo/redo present выставит сам historyStore после восстановления.
      if (history.isRestoring) return;

      // select не создаёт шаг истории, но present обязан отражать текущее
      // выделение. Клампинг reconciler'а тоже только синхронизирует present.
      if (isReconciling() || (!instancesChanged && !sceneChanged)) {
        history.syncPresent(snapshot);
        return;
      }

      history.push(snapshot);
    });
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-neutral-100 text-neutral-900">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <LibraryPanel />
        <main className="flex min-w-0 flex-1 flex-col">
          <CanvasStage />
        </main>
        <div className="flex w-72 shrink-0 flex-col border-l border-neutral-200 bg-white">
          <PropertiesPanel />
          <LayersPanel />
        </div>
      </div>
    </div>
  );
}
