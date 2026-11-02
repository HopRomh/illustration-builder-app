import type { LibraryItem, Size } from '../types';

interface ObjectCardProps {
  item: LibraryItem;
  size: Size;
  onAdd: () => void;
}

export function ObjectCard({ item, size, onAdd }: ObjectCardProps) {
  const variant = item.variants[`main-${size}`];

  if (!variant) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={onAdd}
      title={`Добавить «${item.name}» на холст`}
      className="group flex flex-col gap-1 rounded-md border border-neutral-200 bg-white p-1.5 text-left transition-colors hover:border-neutral-400 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
    >
      <span className="flex aspect-square items-center justify-center overflow-hidden rounded bg-neutral-100">
        <img
          src={encodeURI(variant.file)}
          alt=""
          loading="lazy"
          draggable={false}
          className="h-full w-full object-contain p-2"
        />
      </span>
      <span className="truncate px-1 pb-0.5 text-xs font-medium text-neutral-700">
        {item.name}
      </span>
    </button>
  );
}
