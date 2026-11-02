/** Чистая геометрия: используется и layout'ом сценария, и CanvasStage. */

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SizeLike {
  width: number;
  height: number;
}

/** Размер axis-aligned bbox прямоугольника после поворота на angle (в градусах). */
export function rotatedBounds(width: number, height: number, angle: number): SizeLike {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));

  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  };
}

/**
 * Сдвиг, который возвращает прямоугольник внутрь bounds.
 * Формула совпадает с прежним clampToCanvas: сначала левый/верхний край,
 * затем правый/нижний. Для объектов больше контейнера поведение не меняется.
 */
export function clampRectToBounds(rect: RectLike, bounds: RectLike): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;

  if (rect.left < bounds.left) dx = bounds.left - rect.left;
  else if (rect.left + rect.width > bounds.left + bounds.width) {
    dx = bounds.left + bounds.width - (rect.left + rect.width);
  }

  if (rect.top < bounds.top) dy = bounds.top - rect.top;
  else if (rect.top + rect.height > bounds.top + bounds.height) {
    dy = bounds.top + bounds.height - (rect.top + rect.height);
  }

  return { dx, dy };
}
