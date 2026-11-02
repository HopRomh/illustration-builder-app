import { layoutComposition } from '../canvas/layout';
import { catalog } from '../library/catalog';
import type { Instance } from '../state/store';
import type { LibraryItem, Scene, Size, Variant } from '../types';

export interface SkippedObject {
  itemId: string;
  name: string;
  size: Size;
  variant: Variant;
}

export interface ComposeResult {
  /** Вход для addMany: сначала support'ы, последним — фокус (верхний слой). */
  inputs: Array<Omit<Instance, 'uid' | 'scale'>>;
  focusIndex: number;
  skipped: SkippedObject[];
}

function variantKey(variant: Variant, size: Size): `${Variant}-${Size}` {
  return `${variant}-${size}`;
}

function hasVariant(item: LibraryItem, variant: Variant, size: Size): boolean {
  return Boolean(item.variants[variantKey(variant, size)]);
}

function mergeUnique(items: LibraryItem[]): LibraryItem[] {
  const seen = new Set<string>();
  const result: LibraryItem[] = [];

  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }

  return result;
}

/**
 * Собирает вход для addMany: первый валидный объект — main/фокус,
 * остальные — background. Объекты без нужного варианта пропускаются.
 */
export function composeScenario(
  selected: LibraryItem[],
  scene: Scene,
  items: LibraryItem[] = catalog.items,
): ComposeResult {
  const skipped: SkippedObject[] = [];
  const prepared: Instance[] = [];
  const focusPreparedIndex = { value: -1 };

  for (const item of mergeUnique(selected)) {
    const variant: Variant = focusPreparedIndex.value < 0 ? 'main' : 'background';

    if (!hasVariant(item, variant, scene.size)) {
      skipped.push({ itemId: item.id, name: item.name, size: scene.size, variant });
      continue;
    }

    if (focusPreparedIndex.value < 0) focusPreparedIndex.value = prepared.length;

    prepared.push({
      uid: `draft-${prepared.length}`,
      itemId: item.id,
      variant,
      size: scene.size,
      x: 0,
      y: 0,
      scale: scene.scale,
      angle: 0,
    });
  }

  if (prepared.length === 0 || focusPreparedIndex.value < 0) {
    return { inputs: [], focusIndex: -1, skipped };
  }

  const focus = focusPreparedIndex.value;
  const laid = layoutComposition(prepared, scene, focus, items);
  const focusInstance = laid[focus];
  const ordered = [
    ...laid.slice(0, focus),
    ...laid.slice(focus + 1),
    focusInstance,
  ];

  const inputs = ordered.map((instance) => ({
    itemId: instance.itemId,
    variant: instance.variant,
    size: instance.size,
    x: instance.x,
    y: instance.y,
    angle: instance.angle,
  }));

  return {
    inputs,
    focusIndex: inputs.length - 1,
    skipped,
  };
}
