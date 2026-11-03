import { Canvas, Point } from 'fabric';
import type { FabricObject, TPointerEventInfo } from 'fabric';
import { useEffect, useRef, useState } from 'react';
import { catalog } from '../library/catalog';
import { useAppStore } from '../state/store';
import type { Instance } from '../state/store';
import type { Format, Size, Variant } from '../types';
import { registerCanvas, unregisterCanvas } from './canvasRegistry';
import { clampRectToBounds } from './geometry';
import { loadSvg } from './loadSvg';
import { applyScheme, applySchemeToScene, getPalette, tagRoles } from './recolor';
import { FORMATS, formatAspectRatio } from './sizing';
import { useHotkeys } from './useHotkeys';
import { IDENTITY_VIEWPORT, zoomFromWheel } from './viewport';

const SELECTION_COLOR = '#6D7BFC';
const ROTATION_SNAP = 15;

function applyObjectLocks(object: FabricObject): void {
  object.set({
    lockScalingX: true,
    lockScalingY: true,
    lockUniScaling: true,
    lockSkewingX: true,
    lockSkewingY: true,
    lockRotation: false,
    hasControls: true,
    borderColor: SELECTION_COLOR,
    borderScaleFactor: 2,
    selectable: true,
    evented: true,
    hoverCursor: 'move',
    moveCursor: 'move',
  });
  object.setControlsVisibility({
    tl: false,
    tr: false,
    bl: false,
    br: false,
    ml: false,
    mt: false,
    mr: false,
    mb: false,
    mtr: true,
  });
}

/** id нужен экспорту: каждый объект станет <g id="instance-…"> в SVG. */
function assignSvgId(object: FabricObject, id: string): void {
  (object as FabricObject & { id?: string }).id = id;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLButtonElement ||
    target instanceof HTMLAnchorElement
  ) {
    return true;
  }
  return target.isContentEditable;
}

/** Не даёт объекту выйти за границы холста. Возвращает true, если сдвинул. */
function clampToCanvas(object: FabricObject, width: number, height: number): boolean {
  const bounds = object.getBoundingRect();
  const { dx, dy } = clampRectToBounds(bounds, {
    left: 0,
    top: 0,
    width,
    height,
  });

  if (dx === 0 && dy === 0) return false;

  object.set({
    left: (object.left ?? 0) + dx,
    top: (object.top ?? 0) + dy,
  });
  object.setCoords();
  return true;
}

/**
 * Fabric при setDimensions выставляет инлайновые width/height в пикселях
 * backstore. Растягиваем отображение на обёртку без !important: инлайновые
 * 100% перекрывают пиксельные значения Fabric.
 */
function fitCanvasToWrapper(canvas: Canvas): void {
  const style = { width: '100%', height: '100%' };
  Object.assign(canvas.wrapperEl.style, style);
  Object.assign(canvas.lowerCanvasEl.style, style);
  Object.assign(canvas.upperCanvasEl.style, style);
}

/** Меняет backstore под формат. Возвращает true, если размеры изменились. */
function applyCanvasDimensions(canvas: Canvas, format: Format): boolean {
  const { width, height } = FORMATS[format];
  const changed = canvas.getWidth() !== width || canvas.getHeight() !== height;

  if (changed) canvas.setDimensions({ width, height });
  fitCanvasToWrapper(canvas);
  canvas.calcOffset();

  return changed;
}

function findVariant(instance: Instance) {
  const item = catalog.items.find((entry) => entry.id === instance.itemId);
  if (!item) return null;

  const key = `${instance.variant}-${instance.size}` as `${Variant}-${Size}`;
  return item.variants[key] ?? null;
}

export function CanvasStage() {
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const format = useAppStore((state) => state.scene.format);
  const { width: canvasWidth, height: canvasHeight } = FORMATS[format];

  useHotkeys();

  useEffect(() => {
    const element = canvasElementRef.current;
    if (!element) return;

    const initialScene = useAppStore.getState().scene;
    const initialSize = FORMATS[initialScene.format];

    const canvas = new Canvas(element, {
      width: initialSize.width,
      height: initialSize.height,
      backgroundColor: getPalette(initialScene.scheme).colors['bg-1'],
      preserveObjectStacking: true,
      selection: false,
    });

    const objectsByUid = new Map<string, FabricObject>();
    /** Какой variant-size реально загружен в Fabric для uid. */
    const loadedKeysByUid = new Map<string, string>();
    const objectUid = new WeakMap<FabricObject, string>();
    const pendingUids = new Set<string>();
    /** Ключи uid+variant, по которым toast уже показан (не спамим при каждом sync). */
    const notifiedMissing = new Set<string>();
    let pendingSelectionUid: string | null = null;
    let suppressSelectionSync = false;
    let disposed = false;
    let syncQueue: Promise<void> = Promise.resolve();
    let backdropToken = 0;
    let spacePressed = false;
    let isPanning = false;

    fitCanvasToWrapper(canvas);
    registerCanvas(canvas);

    const applyBackdrop = async () => {
      const scene = useAppStore.getState().scene;
      const token = (backdropToken += 1);

      // Поля вокруг подложки всегда цвета bg-1 целевой схемы.
      canvas.backgroundColor = getPalette(scene.scheme).colors['bg-1'];
      canvas.requestRenderAll();

      const backdrop = catalog.backdrops.find(
        (item) => item.scheme === scene.scheme && item.size === scene.size,
      );
      if (!backdrop) {
        console.error(
          `CanvasStage: подложка ${scene.scheme}-${scene.size} не найдена в catalog.json.`,
        );
        return;
      }

      try {
        const group = await loadSvg(backdrop.file);
        if (disposed || token !== backdropToken) return;

        const width = canvas.getWidth();
        const height = canvas.getHeight();
        const vbWidth = backdrop.viewBox[2] || 1;
        const vbHeight = backdrop.viewBox[3] || 1;

        // Пропорции подложки сохраняются, поля закрашивает backgroundColor.
        const k = Math.min(width / vbWidth, height / vbHeight);

        assignSvgId(group, 'backdrop');
        group.set({
          originX: 'left',
          originY: 'top',
          left: (width - vbWidth * k) / 2,
          top: (height - vbHeight * k) / 2,
          scaleX: k,
          scaleY: k,
          selectable: false,
          evented: false,
          hasControls: false,
          hasBorders: false,
        });
        group.setCoords();

        canvas.backgroundImage = group;
        canvas.requestRenderAll();
      } catch (error) {
        console.error('CanvasStage: не удалось загрузить подложку', error);
      }
    };

    const applySceneScheme = (scheme: string) => {
      applySchemeToScene(objectsByUid.values(), scheme);
      canvas.backgroundColor = getPalette(scheme).colors['bg-1'];
      canvas.requestRenderAll();
    };

    const applySelection = (uid: string | null) => {
      if (disposed) return;

      if (uid === null) {
        pendingSelectionUid = null;
        if (canvas.getActiveObject()) {
          canvas.discardActiveObject();
          canvas.requestRenderAll();
        }
        return;
      }

      const object = objectsByUid.get(uid);
      if (!object) {
        pendingSelectionUid = uid;
        return;
      }

      pendingSelectionUid = null;
      if (canvas.getActiveObject() !== object) {
        canvas.setActiveObject(object);
        canvas.requestRenderAll();
      }
    };

    const syncInstances = async () => {
      if (disposed) return;

      const requested = useAppStore.getState().instances;
      const missingThisPass = new Set<string>();

      for (const request of requested) {
        if (pendingUids.has(request.uid)) continue;

        const variantKey = `${request.variant}-${request.size}`;
        const existing = objectsByUid.get(request.uid);
        const loadedKey = loadedKeysByUid.get(request.uid);

        // Вариант не менялся — трансформ обновит общий проход ниже.
        if (existing && loadedKey === variantKey) continue;

        const variant = findVariant(request);
        if (!variant) {
          const missingKey = `${request.uid}:${variantKey}`;
          // Старый L-объект нельзя оставлять при переключении на S: иначе
          // на холсте смешиваются размеры. Убираем его и сообщаем причину.
          if (existing) {
            suppressSelectionSync = true;
            try {
              canvas.remove(existing);
            } finally {
              suppressSelectionSync = false;
            }
            objectsByUid.delete(request.uid);
            loadedKeysByUid.delete(request.uid);
            objectUid.delete(existing);
            if (pendingSelectionUid === request.uid) pendingSelectionUid = null;

            if (!notifiedMissing.has(missingKey)) {
              notifiedMissing.add(missingKey);
              const name =
                catalog.items.find((entry) => entry.id === request.itemId)?.name ??
                request.itemId;
              missingThisPass.add(name);
            }
          }

          // missingVariant уже показан бейджем в панелях; не спамим консоль.
          if (!request.missingVariant) {
            console.error(
              `CanvasStage: у объекта ${request.itemId} нет варианта ${variantKey}.`,
            );
          }
          continue;
        }

        notifiedMissing.delete(`${request.uid}:${variantKey}`);

        pendingUids.add(request.uid);
        try {
          const group = await loadSvg(variant.file);
          if (disposed) return;

          // Пока грузились, инстанс могли удалить, сдвинуть или переключить.
          const live = useAppStore
            .getState()
            .instances.find((entry) => entry.uid === request.uid);
          if (!live) continue;

          // Вариант успели сменить ещё раз (например, undo во время загрузки):
          // не вставляем устаревший SVG, следующий проход очереди загрузит живой.
          if (`${live.variant}-${live.size}` !== variantKey) continue;

          const liveIndex = useAppStore
            .getState()
            .instances.findIndex((entry) => entry.uid === request.uid);

          tagRoles(group);
          applyObjectLocks(group);
          assignSvgId(group, live.uid);
          group.set({
            left: live.x,
            top: live.y,
            scaleX: live.scale,
            scaleY: live.scale,
            angle: live.angle,
          });
          group.setCoords();
          applyScheme(group, useAppStore.getState().scene.scheme);

          if (existing) {
            // Старый вариант снимаем без побочной синхронизации выделения:
            // selectedUid в сторе не должен обнулиться.
            suppressSelectionSync = true;
            try {
              canvas.remove(existing);
            } finally {
              suppressSelectionSync = false;
            }
            objectUid.delete(existing);
          }

          objectsByUid.set(request.uid, group);
          objectUid.set(group, request.uid);
          loadedKeysByUid.set(request.uid, variantKey);

          // insertAt сохраняет z-index; moveObjectTo ниже доводит порядок.
          if (existing) canvas.insertAt(Math.max(liveIndex, 0), group);
          else canvas.add(group);
        } catch (error) {
          console.error(
            `CanvasStage: не удалось добавить ${request.itemId} (${request.uid})`,
            error,
          );
        } finally {
          pendingUids.delete(request.uid);
        }
      }

      if (missingThisPass.size > 0) {
        const names = [...missingThisPass];
        const size = useAppStore.getState().scene.size;
        setToast(
          `Нет варианта ${size} для: ${names.join(', ')}. ${
            names.length === 1 ? 'Объект скрыт' : 'Объекты скрыты'
          } с холста.`,
        );
      }

      // После всех await берём актуальный порядок и координаты.
      const instances = useAppStore.getState().instances;
      const alive = new Set(instances.map((instance) => instance.uid));

      // canvas.remove снимает активный объект и шлёт selection:cleared.
      // Во время reconcile выделение задаёт стор, а не этот побочный эффект:
      // иначе undo, восстанавливающий другое выделение, его потеряет.
      suppressSelectionSync = true;
      try {
        for (const [uid, object] of [...objectsByUid]) {
          if (!alive.has(uid)) {
            canvas.remove(object);
            objectsByUid.delete(uid);
            loadedKeysByUid.delete(uid);
            objectUid.delete(object);
            if (pendingSelectionUid === uid) pendingSelectionUid = null;
          }
        }
      } finally {
        suppressSelectionSync = false;
      }

      for (const instance of instances) {
        const object = objectsByUid.get(instance.uid);
        if (!object) continue;

        object.set({
          left: instance.x,
          top: instance.y,
          scaleX: instance.scale,
          scaleY: instance.scale,
          angle: instance.angle,
        });
        object.setCoords();

        if (clampToCanvas(object, canvas.getWidth(), canvas.getHeight())) {
          useAppStore.getState().updateFromCanvas(instance.uid, {
            x: object.left ?? 0,
            y: object.top ?? 0,
            isReconciling: true,
          });
        }
      }

      for (let index = 0; index < instances.length; index += 1) {
        const object = objectsByUid.get(instances[index].uid);
        if (object) canvas.moveObjectTo(object, index);
      }

      applySelection(useAppStore.getState().selectedUid);
      canvas.requestRenderAll();
    };

    const requestSync = () => {
      syncQueue = syncQueue
        .then(() => syncInstances())
        .catch((error) => {
          console.error('CanvasStage: reconciler упал', error);
        });
    };

    const handleMoving = (event: { target: FabricObject }) => {
      if (objectUid.has(event.target)) {
        clampToCanvas(event.target, canvas.getWidth(), canvas.getHeight());
      }
    };

    const handleRotating = (event: {
      target: FabricObject;
      e?: { shiftKey?: boolean };
    }) => {
      if (!objectUid.has(event.target) || !event.e?.shiftKey) return;

      const snapped = Math.round((event.target.angle ?? 0) / ROTATION_SNAP) * ROTATION_SNAP;
      event.target.set({ angle: ((snapped % 360) + 360) % 360 });
      event.target.setCoords();
    };

    const handleModified = (event: { target: FabricObject }) => {
      const target = event.target;
      if (!objectUid.has(target)) return;

      clampToCanvas(target, canvas.getWidth(), canvas.getHeight());
      const uid = objectUid.get(target);
      if (!uid) return;

      useAppStore.getState().updateFromCanvas(uid, {
        x: target.left ?? 0,
        y: target.top ?? 0,
        angle: target.angle ?? 0,
      });
    };

    const handleSelection = () => {
      if (suppressSelectionSync) return;

      const active = canvas.getActiveObject();

      // На этапе 4 мультивыделение запрещено; если ActiveSelection всё же
      // возник (например, программно), сбрасываем его.
      if (active && !objectUid.has(active)) {
        canvas.discardActiveObject();
        if (useAppStore.getState().selectedUid !== null) {
          useAppStore.getState().select(null);
        }
        return;
      }

      const uid = active ? (objectUid.get(active) ?? null) : null;
      if (useAppStore.getState().selectedUid !== uid) {
        useAppStore.getState().select(uid);
      }
    };

    const handleWheel = (event: TPointerEventInfo<WheelEvent>) => {
      event.e.preventDefault();
      event.e.stopPropagation();

      const nextZoom = zoomFromWheel(canvas.getZoom(), event.e.deltaY);
      if (nextZoom === canvas.getZoom()) return;
      canvas.zoomToPoint(event.viewportPoint, nextZoom);
    };

    const handleMouseDown = () => {
      if (!spacePressed) return;
      isPanning = true;
      canvas.selection = false;
      canvas.skipTargetFind = true;
      canvas.setCursor('grabbing');
    };

    const handleMouseMove = (event: TPointerEventInfo) => {
      if (!isPanning) return;

      // Зум/пан двигают только viewportTransform; instance.scale не трогаем.
      const { movementX, movementY } = event.e as MouseEvent;
      if (movementX === 0 && movementY === 0) return;
      canvas.relativePan(new Point(movementX, movementY));
    };

    const handleMouseUp = () => {
      if (!isPanning) return;
      isPanning = false;
      canvas.skipTargetFind = spacePressed;
      canvas.setCursor(spacePressed ? 'grab' : 'default');
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isInteractiveTarget(event.target)) return;
      event.preventDefault();

      if (spacePressed) return;
      spacePressed = true;
      canvas.skipTargetFind = true;
      canvas.defaultCursor = 'grab';
      canvas.setCursor('grab');
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;

      spacePressed = false;
      isPanning = false;
      canvas.skipTargetFind = false;
      canvas.defaultCursor = 'default';
      canvas.setCursor('default');
    };

    const handleWindowBlur = () => {
      spacePressed = false;
      isPanning = false;
      canvas.skipTargetFind = false;
      canvas.defaultCursor = 'default';
      canvas.setCursor('default');
    };

    canvas.on('mouse:wheel', handleWheel);
    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    // Если отпустить кнопку вне холста, Fabric может не прислать mouse:up.
    window.addEventListener('mouseup', handleMouseUp);

    canvas.on('object:moving', handleMoving);
    canvas.on('object:rotating', handleRotating);
    canvas.on('object:modified', handleModified);
    canvas.on('selection:created', handleSelection);
    canvas.on('selection:updated', handleSelection);
    canvas.on('selection:cleared', handleSelection);

    const unsubscribeInstances = useAppStore.subscribe((state, previous) => {
      if (state.instances !== previous.instances) requestSync();
    });

    const unsubscribeScene = useAppStore.subscribe((state, previous) => {
      if (state.scene === previous.scene) return;

      const formatChanged = state.scene.format !== previous.scene.format;
      const schemeChanged = state.scene.scheme !== previous.scene.scheme;
      const sizeChanged = state.scene.size !== previous.scene.size;

      if (formatChanged) {
        applyCanvasDimensions(canvas, state.scene.format);
        // Новый формат — новый кадр; зум/пан не должны «уносить» сцену.
        canvas.setViewportTransform(IDENTITY_VIEWPORT);
      }
      if (schemeChanged) {
        applySceneScheme(state.scene.scheme);
      }
      if (formatChanged || schemeChanged || sizeChanged) {
        void applyBackdrop();
      }

      canvas.requestRenderAll();
    });

    const unsubscribeSelection = useAppStore.subscribe((state, previous) => {
      if (state.selectedUid !== previous.selectedUid) {
        applySelection(state.selectedUid);
      }
    });

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => canvas.calcOffset());
    resizeObserver?.observe(canvas.wrapperEl);

    applyCanvasDimensions(canvas, initialScene.format);
    void applyBackdrop();
    requestSync();

    return () => {
      disposed = true;
      backdropToken += 1;
      resizeObserver?.disconnect();
      unsubscribeInstances();
      unsubscribeScene();
      unsubscribeSelection();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('mouseup', handleMouseUp);
      canvas.off('mouse:wheel', handleWheel);
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:up', handleMouseUp);
      canvas.off('object:moving', handleMoving);
      canvas.off('object:rotating', handleRotating);
      canvas.off('object:modified', handleModified);
      canvas.off('selection:created', handleSelection);
      canvas.off('selection:updated', handleSelection);
      canvas.off('selection:cleared', handleSelection);
      unregisterCanvas(canvas);
      objectsByUid.clear();
      loadedKeysByUid.clear();
      pendingUids.clear();
      pendingSelectionUid = null;
      void canvas.dispose();
    };
  }, []);

  const ratio = canvasWidth / canvasHeight;

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center bg-neutral-300 p-6">
      <div
        className="w-full overflow-hidden bg-white shadow-xl ring-1 ring-black/10"
        style={{
          aspectRatio: formatAspectRatio(format),
          maxWidth: `calc((100vh - 10rem) * ${ratio})`,
        }}
      >
        <canvas ref={canvasElementRef} aria-label={`Холст ${canvasWidth} на ${canvasHeight}`} />
      </div>

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="absolute bottom-4 left-1/2 z-10 flex max-w-md -translate-x-1/2 items-start gap-3 rounded-md bg-neutral-900 px-3 py-2 text-xs text-white shadow-lg"
        >
          <span>{toast}</span>
          <button
            type="button"
            aria-label="Скрыть уведомление"
            className="shrink-0 text-base leading-none text-neutral-400 transition-colors hover:text-white"
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
