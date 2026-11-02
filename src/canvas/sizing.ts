/** Геометрия холста и вставки. Не импортирует fabric — можно использовать в панели. */

import type { Format, Scene } from '../types';

export const CANVAS_SIZE = 1080;

/**
 * Единый масштаб сцены для всех объектов.
 *
 * Жёсткое правило (§3.3): пропорции объектов относительно друг друга не меняются,
 * отдельный объект масштабировать нельзя — только всю сцену целиком. Поэтому
 * здесь одна константа на все карточки, а не расчёт под размер каждого viewBox.
 *
 * 0.4 — самый крупный L-объект (книга 1446×977) занимает ~54% ширины холста,
 * при этом пропорции исходников сохраняются: монета (287×189) остаётся
 * заметно меньше книги, как и в библиотеке.
 */
export const SCENE_SCALE = 0.4;

/** Размеры backstore для каждого формата. */
export const FORMATS: Record<Format, { width: number; height: number }> = {
  '1:1': { width: 1080, height: 1080 },
  '4:3': { width: 1440, height: 1080 },
  '3:4': { width: 1080, height: 1440 },
};

/** CSS aspect-ratio для обёртки холста: '4:3' → '4 / 3'. */
export function formatAspectRatio(format: Format): string {
  switch (format) {
    case '1:1':
      return '1 / 1';
    case '4:3':
      return '4 / 3';
    case '3:4':
      return '3 / 4';
  }
}

/**
 * Масштаб формата относительно квадрата 1080×1080.
 * Для всех трёх текущих форматов равен 1: композиция центрируется,
 * а не растягивается под новый формат.
 */
export function getFormatScale(format: Format): number {
  const { width, height } = FORMATS[format];
  return Math.min(width, height) / CANVAS_SIZE;
}

/**
 * Масштаб сцены с учётом формата. Базовая вставка (SCENE_SCALE) сохраняется,
 * поэтому объекты не прыгают в 2.5 раза при смене формата.
 *
 * Отличие от буквальной формулы §3.1 «min(W, H) / 1080»: та даёт 1 для всех
 * трёх форматов, но тогда новые объекты были бы в 2.5 раза крупнее уже
 * добавленных (их scale = 0.4). Поэтому коэффициент формата умножается на
 * базовый SCENE_SCALE; при 1:1 результат по-прежнему 0.4.
 */
export function getSceneScale(scene: Pick<Scene, 'format'>): number {
  return SCENE_SCALE * getFormatScale(scene.format);
}
