import { getActiveCanvas, resetViewport } from '../canvas/canvasRegistry';
import { exportSvg } from '../canvas/exportSvg';
import { PALETTES } from '../canvas/recolor';
import type { Format, Size } from '../types';
import { useHistoryStore } from '../state/historyStore';
import { useAppStore } from '../state/store';

const toolbarButtonClass =
  'shrink-0 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40';

const segmentButtonClass = (active: boolean): string =>
  `px-3 py-1.5 text-sm font-medium transition-colors ${
    active ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-700 hover:bg-neutral-100'
  }`;

const formats: { id: Format; label: string }[] = [
  { id: '1:1', label: 'Квадрат' },
  { id: '4:3', label: 'Горизонталь' },
  { id: '3:4', label: 'Вертикаль' },
];

const sizes: { id: Size; label: string }[] = [
  { id: 'L', label: 'L' },
  { id: 'S', label: 'S' },
];

const schemeLabels: Record<string, string> = {
  lilac: 'Сиреневая',
  peach: 'Персиковая',
  mint: 'Мятная',
};

// Список схем — из данных, а не из отдельного hardcode: новая палитра
// в palettes.json появится в тулбаре автоматически (label — fallback на id).
const schemes = PALETTES.map((palette) => ({
  id: palette.scheme,
  label: schemeLabels[palette.scheme] ?? palette.scheme,
}));

export function Toolbar() {
  const selectedUid = useAppStore((state) => state.selectedUid);
  const format = useAppStore((state) => state.scene.format);
  const size = useAppStore((state) => state.scene.size);
  const scheme = useAppStore((state) => state.scene.scheme);
  const setScene = useAppStore((state) => state.setScene);
  const setSceneSize = useAppStore((state) => state.setSceneSize);
  const duplicate = useAppStore((state) => state.duplicate);
  const remove = useAppStore((state) => state.remove);
  const undo = useHistoryStore((state) => state.undo);
  const redo = useHistoryStore((state) => state.redo);
  const canUndo = useHistoryStore((state) => state.history.past.length > 0);
  const canRedo = useHistoryStore((state) => state.history.future.length > 0);

  const handleExport = () => {
    const canvas = getActiveCanvas();
    if (!canvas) {
      console.error('[toolbar] холст ещё не готов к экспорту');
      return;
    }

    try {
      const svg = exportSvg(canvas, useAppStore.getState().scene, PALETTES);
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'composition.svg';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Даём браузеру начать скачивание, затем освобождаем blob URL.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error('[toolbar] не удалось экспортировать SVG', error);
    }
  };

  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2">
      <button
        type="button"
        className={toolbarButtonClass}
        disabled={!canUndo}
        onClick={() => undo()}
      >
        Undo
      </button>
      <button
        type="button"
        className={toolbarButtonClass}
        disabled={!canRedo}
        onClick={() => redo()}
      >
        Redo
      </button>

      <div className="mx-1 h-6 w-px shrink-0 bg-neutral-200" />

      <button
        type="button"
        className={toolbarButtonClass}
        disabled={!selectedUid}
        onClick={() => {
          if (selectedUid) duplicate(selectedUid);
        }}
      >
        Дубль
      </button>
      <button
        type="button"
        className={toolbarButtonClass}
        disabled={!selectedUid}
        onClick={() => {
          if (selectedUid) remove(selectedUid);
        }}
      >
        Удалить
      </button>

      <div className="mx-1 h-6 w-px shrink-0 bg-neutral-200" />

      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-neutral-500">
        Формат
      </span>
      <div className="flex shrink-0 overflow-hidden rounded-md border border-neutral-200">
        {formats.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={format === item.id}
            className={segmentButtonClass(format === item.id)}
            onClick={() => setScene({ format: item.id })}
          >
            {item.label}
          </button>
        ))}
      </div>

      <span className="ml-2 shrink-0 text-xs font-medium uppercase tracking-wide text-neutral-500">
        Размер
      </span>
      <div className="flex shrink-0 overflow-hidden rounded-md border border-neutral-200">
        {sizes.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={size === item.id}
            className={segmentButtonClass(size === item.id)}
            onClick={() => setSceneSize(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <span className="ml-2 shrink-0 text-xs font-medium uppercase tracking-wide text-neutral-500">
        Схема
      </span>
      <div className="flex shrink-0 overflow-hidden rounded-md border border-neutral-200">
        {schemes.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={scheme === item.id}
            className={segmentButtonClass(scheme === item.id)}
            onClick={() => setScene({ scheme: item.id })}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button type="button" className={toolbarButtonClass} onClick={() => resetViewport()}>
          Сбросить зум
        </button>
        <button
          type="button"
          className="shrink-0 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
          onClick={handleExport}
        >
          Экспорт SVG
        </button>
      </div>
    </header>
  );
}
