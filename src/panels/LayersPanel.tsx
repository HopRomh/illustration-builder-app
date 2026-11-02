import { catalog } from '../library/catalog';
import { useAppStore } from '../state/store';

const layerButtonClass =
  'rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40';

export function LayersPanel() {
  const instances = useAppStore((state) => state.instances);
  const selectedUid = useAppStore((state) => state.selectedUid);
  const select = useAppStore((state) => state.select);
  const bringForward = useAppStore((state) => state.bringForward);
  const sendBackward = useAppStore((state) => state.sendBackward);
  const bringToFront = useAppStore((state) => state.bringToFront);
  const sendToBack = useAppStore((state) => state.sendToBack);

  const selectedIndex = instances.findIndex((item) => item.uid === selectedUid);
  const canForward = selectedIndex >= 0 && selectedIndex < instances.length - 1;
  const canBackward = selectedIndex > 0;
  const ordered = [...instances].reverse();

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-semibold">Слои</h2>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-neutral-200 p-2">
        <button
          type="button"
          className={layerButtonClass}
          disabled={!canForward}
          onClick={() => {
            if (selectedUid) bringForward(selectedUid);
          }}
        >
          Вперёд
        </button>
        <button
          type="button"
          className={layerButtonClass}
          disabled={!canBackward}
          onClick={() => {
            if (selectedUid) sendBackward(selectedUid);
          }}
        >
          Назад
        </button>
        <button
          type="button"
          className={layerButtonClass}
          disabled={!canForward}
          onClick={() => {
            if (selectedUid) bringToFront(selectedUid);
          }}
        >
          На передний
        </button>
        <button
          type="button"
          className={layerButtonClass}
          disabled={!canBackward}
          onClick={() => {
            if (selectedUid) sendToBack(selectedUid);
          }}
        >
          На задний
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {instances.length === 0 ? (
          <p className="p-2 text-sm text-neutral-500">Слоёв пока нет</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {ordered.map((instance, orderedIndex) => {
              const item = catalog.items.find((entry) => entry.id === instance.itemId);
              const selected = instance.uid === selectedUid;
              return (
                <li key={instance.uid}>
                  <button
                    type="button"
                    onClick={() => select(instance.uid)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                      selected
                        ? 'bg-neutral-900 text-white'
                        : 'text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    <span className="min-w-0 truncate font-medium">
                      {item?.name ?? instance.itemId}
                    </span>
                    {instance.missingVariant ? (
                      <span
                        className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold ${
                          selected
                            ? 'bg-amber-300 text-amber-950'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        Нет размера {instance.size}
                      </span>
                    ) : null}
                    <span
                      className={`shrink-0 text-[10px] ${
                        selected ? 'text-white/60' : 'text-neutral-400'
                      }`}
                    >
                      #{instances.length - orderedIndex}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
