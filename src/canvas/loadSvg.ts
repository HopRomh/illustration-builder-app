/**
 * Импорт SVG из assets/library/ в Fabric.
 *
 * Каждый вызов:
 *  1) берёт исходный текст из кеша (fetch один раз на file);
 *  2) ремапит id новым детерминированным префиксом (u1-, u2-, ...);
 *  3) парсит и собирает в Group.
 *
 * Масштаб здесь не применяется: единый масштаб сцены задаёт вызывающий код,
 * чтобы не нарушать пропорции объектов относительно друг друга.
 *
 * Важно: кешируется исходный текст, а не готовая группа. Иначе два экземпляра
 * одного SVG получили бы одинаковые id и сломали clipPath. Новый префикс на
 * каждый вызов — обязательное условие.
 */
import { Group, loadSVGFromString, util } from 'fabric';
import type { FabricObject } from 'fabric';
import { remapSvgIds } from './remapIds';

interface CachedSource {
  text: string;
  viewBox: [number, number, number, number];
}

const sourceCache = new Map<string, Promise<CachedSource>>();
let prefixCounter = 0;

/** Детерминированный префикс: u1-, u2-, ... (не randomUUID — тесты и идемпотентность). */
export function nextPrefix(): string {
  prefixCounter += 1;
  return `u${prefixCounter}-`;
}

function readViewBox(text: string, fileUrl: string): [number, number, number, number] {
  const rootTag = text.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const viewBoxMatch = rootTag.match(/\bviewBox\s*=\s*(["'])([^"']+)\1/i);
  if (viewBoxMatch) {
    const parts = viewBoxMatch[2]
      .trim()
      .split(/[\s,]+/)
      .map((part) => Number.parseFloat(part));
    if (parts.length === 4 && parts.every((part) => Number.isFinite(part))) {
      return [parts[0], parts[1], parts[2], parts[3]];
    }
    throw new Error(`loadSvg: ${fileUrl}: некорректный viewBox "${viewBoxMatch[2]}".`);
  }

  const widthMatch = rootTag.match(/\bwidth\s*=\s*(["'])([\d.]+)(?:px)?\1/i);
  const heightMatch = rootTag.match(/\bheight\s*=\s*(["'])([\d.]+)(?:px)?\1/i);
  const width = widthMatch ? Number.parseFloat(widthMatch[2]) : NaN;
  const height = heightMatch ? Number.parseFloat(heightMatch[2]) : NaN;
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return [0, 0, width, height];
  }

  throw new Error(`loadSvg: ${fileUrl}: не найден viewBox (и нет width/height).`);
}

async function getSource(fileUrl: string): Promise<CachedSource> {
  const cached = sourceCache.get(fileUrl);
  if (cached) return cached;

  const request = (async (): Promise<CachedSource> => {
    // encodeURI обязателен: в библиотеке есть «Книга.svg» и «Group 2136136335.svg».
    const response = await fetch(encodeURI(fileUrl));
    if (!response.ok) {
      throw new Error(`loadSvg: ${fileUrl}: HTTP ${response.status} ${response.statusText}.`);
    }
    const text = await response.text();
    return { text, viewBox: readViewBox(text, fileUrl) };
  })();

  sourceCache.set(fileUrl, request);
  try {
    return await request;
  } catch (error) {
    // Не кешируем сетевую/разборную ошибку: следующий клик может успеть.
    sourceCache.delete(fileUrl);
    throw error;
  }
}

export async function loadSvg(fileUrl: string): Promise<Group> {
  const source = await getSource(fileUrl);
  const { svg } = remapSvgIds(source.text, nextPrefix());

  const parsed = await loadSVGFromString(svg);
  const objects = parsed.objects.filter((object): object is FabricObject => object !== null);

  // Известный баг Fabric 7: на parsererror молча возвращает 0 объектов.
  // Нельзя возвращать пустую группу — только ошибка.
  if (parsed.elements.length === 0 || objects.length === 0) {
    throw new Error(
      `loadSvg: ${fileUrl}: получено 0 объектов ` +
        `(elements=${parsed.elements.length}, objects=${objects.length}). ` +
        'Проверь XML/viewBox и дубли атрибутов корневого <svg>.',
    );
  }

  const grouped = util.groupSVGElements(objects);
  const group = grouped instanceof Group ? grouped : new Group([grouped]);

  // Центр — точка привязки координат из стора (x/y задают центр объекта).
  group.set({ originX: 'center', originY: 'center' });

  return group;
}
