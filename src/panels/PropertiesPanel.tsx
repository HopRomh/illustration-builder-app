import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { catalog } from '../library/catalog';
import { useAppStore } from '../state/store';
import type { LibraryItem, Size, Variant } from '../types';

interface Draft {
  x: string;
  y: string;
  angle: string;
}

function formatValue(value: number): string {
  return String(Math.round(value * 100) / 100);
}

const emptyDraft: Draft = { x: '', y: '', angle: '' };

function variantKey(variant: Variant, size: Size): `${Variant}-${Size}` {
  return `${variant}-${size}`;
}

function hasVariant(item: LibraryItem | null, variant: Variant, size: Size): boolean {
  return Boolean(item?.variants[variantKey(variant, size)]);
}

const variantButtonClass = (active: boolean): string =>
  `flex-1 px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
    active ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-700 hover:bg-neutral-100'
  }`;

export function PropertiesPanel() {
  const instance = useAppStore(
    (state) => state.instances.find((item) => item.uid === state.selectedUid) ?? null,
  );
  const setPosition = useAppStore((state) => state.setPosition);
  const rotate = useAppStore((state) => state.rotate);
  const duplicate = useAppStore((state) => state.duplicate);
  const remove = useAppStore((state) => state.remove);
  const setVariant = useAppStore((state) => state.setVariant);

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  // Escape сбрасывает draft и снимает фокус. Без флага blur тут же
  // закоммитил бы старое значение из ещё не обновлённого состояния.
  const skipCommitRef = useRef(false);

  useEffect(() => {
    if (!instance) {
      setDraft(emptyDraft);
      return;
    }
    setDraft({
      x: formatValue(instance.x),
      y: formatValue(instance.y),
      angle: formatValue(instance.angle),
    });
  }, [instance?.uid, instance?.x, instance?.y, instance?.angle]);

  const resetDraft = () => {
    if (!instance) return;
    setDraft({
      x: formatValue(instance.x),
      y: formatValue(instance.y),
      angle: formatValue(instance.angle),
    });
  };

  const commitPosition = () => {
    if (!instance) return;
    if (skipCommitRef.current) {
      skipCommitRef.current = false;
      resetDraft();
      return;
    }
    const x = Number(draft.x);
    const y = Number(draft.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      resetDraft();
      return;
    }
    setPosition(instance.uid, x, y);
  };

  const commitAngle = () => {
    if (!instance) return;
    if (skipCommitRef.current) {
      skipCommitRef.current = false;
      resetDraft();
      return;
    }
    const angle = Number(draft.angle);
    if (!Number.isFinite(angle)) {
      resetDraft();
      return;
    }
    rotate(instance.uid, angle);
  };

  const handleCommitKey = (
    event: ReactKeyboardEvent<HTMLInputElement>,
    commit: () => void,
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      skipCommitRef.current = true;
      resetDraft();
      event.currentTarget.blur();
    }
  };

  const handleAngleKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (
      instance &&
      event.shiftKey &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      event.preventDefault();
      const current = Number(draft.angle);
      if (!Number.isFinite(current)) return;

      const delta = event.key === 'ArrowUp' ? 15 : -15;
      const next = current + delta;
      setDraft((value) => ({ ...value, angle: String(next) }));
      rotate(instance.uid, next);
      return;
    }

    handleCommitKey(event, commitAngle);
  };

  const item = instance
    ? (catalog.items.find((entry) => entry.id === instance.itemId) ?? null)
    : null;
  const canMain = instance ? hasVariant(item, 'main', instance.size) : false;
  const canBackground = instance ? hasVariant(item, 'background', instance.size) : false;

  return (
    <section className="flex shrink-0 flex-col border-b border-neutral-200">
      <div className="border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-semibold">Свойства</h2>
      </div>

      {!instance ? (
        <p className="p-4 text-sm text-neutral-500">Объект не выбран</p>
      ) : (
        <div className="flex flex-col gap-3 p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-neutral-900">
              {item?.name ?? instance.itemId}
            </p>
            <p className="truncate text-xs text-neutral-400">{instance.uid}</p>
            {instance.missingVariant ? (
              <span className="mt-1 inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                Нет размера {instance.size}
              </span>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-500">Вариант</span>
            <div className="flex overflow-hidden rounded-md border border-neutral-200">
              <button
                type="button"
                aria-pressed={instance.variant === 'main'}
                disabled={!canMain}
                title={canMain ? undefined : 'Нет варианта main для этого размера'}
                className={variantButtonClass(instance.variant === 'main')}
                onClick={() => setVariant(instance.uid, 'main')}
              >
                Основной
              </button>
              <button
                type="button"
                aria-pressed={instance.variant === 'background'}
                disabled={!canBackground}
                title={canBackground ? undefined : 'Нет варианта background для этого размера'}
                className={variantButtonClass(instance.variant === 'background')}
                onClick={() => setVariant(instance.uid, 'background')}
              >
                Фон
              </button>
            </div>
          </div>

          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
            Поворот
            <input
              type="number"
              step={1}
              value={draft.angle}
              onChange={(event) => setDraft((value) => ({ ...value, angle: event.target.value }))}
              onBlur={commitAngle}
              onKeyDown={handleAngleKey}
              className="rounded-md border border-neutral-200 px-2 py-1.5 text-sm font-normal text-neutral-900 outline-none focus:border-neutral-400"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
              X
              <input
                type="number"
                step={1}
                value={draft.x}
                onChange={(event) => setDraft((value) => ({ ...value, x: event.target.value }))}
                onBlur={commitPosition}
                onKeyDown={(event) => handleCommitKey(event, commitPosition)}
                className="rounded-md border border-neutral-200 px-2 py-1.5 text-sm font-normal text-neutral-900 outline-none focus:border-neutral-400"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
              Y
              <input
                type="number"
                step={1}
                value={draft.y}
                onChange={(event) => setDraft((value) => ({ ...value, y: event.target.value }))}
                onBlur={commitPosition}
                onKeyDown={(event) => handleCommitKey(event, commitPosition)}
                className="rounded-md border border-neutral-200 px-2 py-1.5 text-sm font-normal text-neutral-900 outline-none focus:border-neutral-400"
              />
            </label>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => duplicate(instance.uid)}
              className="flex-1 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
            >
              Дублировать
            </button>
            <button
              type="button"
              onClick={() => remove(instance.uid)}
              className="flex-1 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
            >
              Удалить
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
