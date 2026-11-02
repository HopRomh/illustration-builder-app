import { useState } from 'react';
import { FORMATS } from '../canvas/sizing';
import { useAppStore } from '../state/store';
import type { LibraryItem } from '../types';
import { MetaphorScenario } from '../scenarios/MetaphorScenario';
import { ObjectsScenario } from '../scenarios/ObjectsScenario';
import { catalog } from './catalog';
import { ObjectCard } from './ObjectCard';

type Tab = 'library' | 'scenarios';
type LibrarySection = 'objects' | 'backdrops';

export function LibraryPanel() {
  const [tab, setTab] = useState<Tab>('library');
  const [section, setSection] = useState<LibrarySection>('objects');
  const add = useAppStore((state) => state.add);
  const size = useAppStore((state) => state.scene.size);

  const addItem = (item: LibraryItem) => {
    const variant = item.variants[`main-${size}`];
    if (!variant) return;

    // Каскад, чтобы 10 кликов подряд не легли стопкой в одной точке.
    const count = useAppStore.getState().instances.length;
    const offset = (count % 10) * 24 - 108;
    const { width, height } = FORMATS[useAppStore.getState().scene.format];

    add({
      itemId: item.id,
      variant: 'main',
      size,
      x: width / 2 + offset,
      y: height / 2 + offset,
      angle: 0,
    });
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div className="flex gap-1 border-b border-neutral-200 p-2">
        <button
          type="button"
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === 'library'
              ? 'bg-neutral-900 text-white'
              : 'text-neutral-600 hover:bg-neutral-100'
          }`}
          onClick={() => setTab('library')}
        >
          Библиотека
        </button>
        <button
          type="button"
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === 'scenarios'
              ? 'bg-neutral-900 text-white'
              : 'text-neutral-600 hover:bg-neutral-100'
          }`}
          onClick={() => setTab('scenarios')}
        >
          Сценарии
        </button>
      </div>

      {tab === 'scenarios' ? (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-6">
            <MetaphorScenario />
            <ObjectsScenario />
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-1 border-b border-neutral-200 p-2">
            <button
              type="button"
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                section === 'objects'
                  ? 'bg-neutral-200 text-neutral-900'
                  : 'text-neutral-600 hover:bg-neutral-100'
              }`}
              onClick={() => setSection('objects')}
            >
              Объекты
            </button>
            <button
              type="button"
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                section === 'backdrops'
                  ? 'bg-neutral-200 text-neutral-900'
                  : 'text-neutral-600 hover:bg-neutral-100'
              }`}
              onClick={() => setSection('backdrops')}
            >
              Подложки
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {section === 'objects' ? (
              <div className="grid grid-cols-2 gap-2">
                {catalog.items.map((item) => (
                  <ObjectCard
                    key={item.id}
                    item={item}
                    size={size}
                    onAdd={() => addItem(item)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-neutral-500">
                Подложка выбирается автоматически по схеме и размеру сцены.
              </p>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
