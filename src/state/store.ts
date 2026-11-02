import { create } from 'zustand';
import { recenterRescale } from '../canvas/layout';
import { getSceneScale } from '../canvas/sizing';
import { catalog } from '../library/catalog';
import type { Scene, Size, Variant } from '../types';
import type { Snapshot } from './history';

export interface Instance {
  /** Уникальный id инстанса (не id объекта из каталога). */
  uid: string;
  itemId: string;
  variant: Variant;
  size: Size;
  x: number;
  y: number;
  scale: number;
  angle: number;
  /** В каталоге нет файла для текущего variant-size. */
  missingVariant?: boolean;
}

/** Патч из CanvasStage. isReconciling не попадает в Instance. */
export interface CanvasPatch extends Partial<Pick<Instance, 'x' | 'y' | 'angle'>> {
  isReconciling?: boolean;
}

export interface AppState {
  instances: Instance[];
  selectedUid: string | null;
  scene: Scene;
  add(instance: Omit<Instance, 'uid' | 'scale'>): string;
  addMany(instances: Omit<Instance, 'uid' | 'scale'>[], focusIndex?: number): string[];
  duplicate(uid: string): string | null;
  remove(uid: string): void;
  select(uid: string | null): void;
  updateFromCanvas(uid: string, patch: CanvasPatch): void;
  rotate(uid: string, angle: number): void;
  nudge(uid: string, dx: number, dy: number): void;
  setPosition(uid: string, x: number, y: number): void;
  bringForward(uid: string): void;
  sendBackward(uid: string): void;
  bringToFront(uid: string): void;
  sendToBack(uid: string): void;
  setScene(patch: Partial<Scene>): void;
  setSceneSize(size: Size): void;
  setVariant(uid: string, variant: Variant): void;
  replaceSnapshot(snapshot: Snapshot): void;
  replaceInstances(instances: Instance[], selectedUid: string | null): void;
}

export const DEFAULT_SCENE: Scene = {
  format: '1:1',
  size: 'L',
  scheme: 'lilac',
  scale: getSceneScale({ format: '1:1' }),
};

let instanceCounter = 0;
let reconcilingDepth = 0;

function nextUid(): string {
  instanceCounter += 1;
  return `instance-${instanceCounter}`;
}

function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function variantKey(variant: Variant, size: Size): `${Variant}-${Size}` {
  return `${variant}-${size}`;
}

function hasVariant(itemId: string, variant: Variant, size: Size): boolean {
  const item = catalog.items.find((entry) => entry.id === itemId);
  return Boolean(item?.variants[variantKey(variant, size)]);
}

/**
 * L ↔ S: меняется только размер и ссылка на файл (её выбирает reconciler).
 * uid, позиция, угол, scale и место в массиве сохраняются.
 */
function withSceneSize(instances: Instance[], size: Size): Instance[] {
  return instances.map((instance) => {
    const next: Instance = { ...instance, size };
    if (hasVariant(instance.itemId, instance.variant, size)) {
      delete next.missingVariant;
    } else {
      next.missingVariant = true;
    }
    return next;
  });
}

/**
 * Пока reconciler пишет clamped-координаты обратно в стор, подписка истории
 * должна обновить present, а не добавить новый шаг.
 */
export function isReconciling(): boolean {
  return reconcilingDepth > 0;
}

export const useAppStore = create<AppState>((set, get) => ({
  instances: [],
  selectedUid: null,
  scene: { ...DEFAULT_SCENE },

  add(instance) {
    const uid = nextUid();
    const scale = getSceneScale(get().scene);
    const next: Instance = { ...instance, uid, scale };
    if (hasVariant(instance.itemId, instance.variant, instance.size)) {
      delete next.missingVariant;
    } else {
      next.missingVariant = true;
    }

    set((state) => ({
      instances: [...state.instances, next],
      selectedUid: uid,
    }));
    return uid;
  },

  addMany(instances, focusIndex) {
    if (instances.length === 0) return [];

    const scale = getSceneScale(get().scene);
    const created = instances.map((instance) => {
      const uid = nextUid();
      const next: Instance = { ...instance, uid, scale };
      if (hasVariant(instance.itemId, instance.variant, instance.size)) {
        delete next.missingVariant;
      } else {
        next.missingVariant = true;
      }
      return next;
    });

    const requestedFocus =
      focusIndex === undefined || !Number.isFinite(focusIndex)
        ? created.length - 1
        : Math.trunc(focusIndex);
    const focus = Math.min(Math.max(requestedFocus, 0), created.length - 1);

    // Один set — один снапшот истории в App.tsx.
    set((state) => ({
      instances: [...state.instances, ...created],
      selectedUid: created[focus].uid,
    }));

    return created.map((instance) => instance.uid);
  },

  duplicate(uid) {
    const source = get().instances.find((item) => item.uid === uid);
    if (!source) return null;

    const newUid = nextUid();
    set((state) => ({
      instances: [
        ...state.instances,
        {
          ...source,
          uid: newUid,
          x: source.x + 20,
          y: source.y + 20,
        },
      ],
      selectedUid: newUid,
    }));
    return newUid;
  },

  remove(uid) {
    set((state) => ({
      instances: state.instances.filter((item) => item.uid !== uid),
      selectedUid: state.selectedUid === uid ? null : state.selectedUid,
    }));
  },

  select(uid) {
    set({ selectedUid: uid });
  },

  updateFromCanvas(uid, patch) {
    const { isReconciling: reconciling, ...rawValues } = patch;
    if (Object.keys(rawValues).length === 0) return;

    const values =
      rawValues.angle === undefined
        ? rawValues
        : { ...rawValues, angle: normalizeAngle(rawValues.angle) };

    if (reconciling) reconcilingDepth += 1;
    try {
      set((state) => {
        let changed = false;
        const instances = state.instances.map((item) => {
          if (item.uid !== uid) return item;

          const next = { ...item, ...values };
          if (
            next.x === item.x &&
            next.y === item.y &&
            next.angle === item.angle
          ) {
            return item;
          }

          changed = true;
          return next;
        });

        return changed ? { instances } : state;
      });
    } finally {
      if (reconciling) reconcilingDepth -= 1;
    }
  },

  rotate(uid, angle) {
    const normalized = normalizeAngle(angle);
    set((state) => {
      const target = state.instances.find((item) => item.uid === uid);
      if (!target || target.angle === normalized) return state;

      return {
        instances: state.instances.map((item) =>
          item.uid === uid ? { ...item, angle: normalized } : item,
        ),
      };
    });
  },

  nudge(uid, dx, dy) {
    if (dx === 0 && dy === 0) return;
    set((state) => {
      const target = state.instances.find((item) => item.uid === uid);
      if (!target) return state;

      return {
        instances: state.instances.map((item) =>
          item.uid === uid ? { ...item, x: item.x + dx, y: item.y + dy } : item,
        ),
      };
    });
  },

  setPosition(uid, x, y) {
    set((state) => {
      const target = state.instances.find((item) => item.uid === uid);
      if (!target || (target.x === x && target.y === y)) return state;

      return {
        instances: state.instances.map((item) =>
          item.uid === uid ? { ...item, x, y } : item,
        ),
      };
    });
  },

  bringForward(uid) {
    set((state) => {
      const index = state.instances.findIndex((item) => item.uid === uid);
      if (index < 0 || index >= state.instances.length - 1) return state;

      const instances = [...state.instances];
      [instances[index], instances[index + 1]] = [instances[index + 1], instances[index]];
      return { instances };
    });
  },

  sendBackward(uid) {
    set((state) => {
      const index = state.instances.findIndex((item) => item.uid === uid);
      if (index <= 0) return state;

      const instances = [...state.instances];
      [instances[index], instances[index - 1]] = [instances[index - 1], instances[index]];
      return { instances };
    });
  },

  bringToFront(uid) {
    set((state) => {
      const index = state.instances.findIndex((item) => item.uid === uid);
      if (index < 0 || index === state.instances.length - 1) return state;

      const instances = [...state.instances];
      const [target] = instances.splice(index, 1);
      instances.push(target);
      return { instances };
    });
  },

  sendToBack(uid) {
    set((state) => {
      const index = state.instances.findIndex((item) => item.uid === uid);
      if (index <= 0) return state;

      const instances = [...state.instances];
      const [target] = instances.splice(index, 1);
      instances.unshift(target);
      return { instances };
    });
  },

  setScene(patch) {
    set((state) => {
      const format = patch.format ?? state.scene.format;
      const size = patch.size ?? state.scene.size;
      const scheme = patch.scheme ?? state.scene.scheme;
      const next: Scene = {
        format,
        size,
        scheme,
        scale: getSceneScale({ format }),
      };

      if (
        next.format === state.scene.format &&
        next.size === state.scene.size &&
        next.scheme === state.scene.scheme &&
        next.scale === state.scene.scale
      ) {
        return state;
      }

      let instances = state.instances;
      if (next.size !== state.scene.size) {
        instances = withSceneSize(instances, next.size);
      }
      if (next.format !== state.scene.format) {
        instances = recenterRescale(instances, state.scene.format, next.format);
      }

      return { scene: next, instances };
    });
  },

  setSceneSize(size) {
    if (get().scene.size === size) return;
    get().setScene({ size });
  },

  setVariant(uid, variant) {
    set((state) => {
      const target = state.instances.find((item) => item.uid === uid);
      if (!target || target.variant === variant) return state;

      const next: Instance = { ...target, variant };
      if (hasVariant(target.itemId, variant, target.size)) {
        delete next.missingVariant;
      } else {
        next.missingVariant = true;
      }

      return {
        instances: state.instances.map((item) => (item.uid === uid ? next : item)),
      };
    });
  },

  replaceSnapshot(snapshot) {
    const validSelected =
      snapshot.selectedUid !== null &&
      snapshot.instances.some((item) => item.uid === snapshot.selectedUid)
        ? snapshot.selectedUid
        : null;

    set({
      instances: snapshot.instances.map((item) => ({ ...item })),
      selectedUid: validSelected,
      scene: { ...snapshot.scene },
    });
  },

  replaceInstances(instances, selectedUid) {
    get().replaceSnapshot({ instances, selectedUid, scene: get().scene });
  },
}));
