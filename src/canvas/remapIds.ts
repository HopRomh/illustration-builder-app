/**
 * Ремап id внутри SVG перед вставкой на холст.
 *
 * Зачем: в одном SVG-документе два экземпляра с одинаковыми id (особенно
 * clipPath/gradient/mask) конфликтуют. Каждому экземпляру даём свой префикс.
 *
 * Модуль намеренно не импортирует fabric и DOM: тест гоняется в Vitest с
 * environment: 'node' без canvas/jsdom.
 */

export interface RemapResult {
  /** Новый SVG-текст. Входная строка не мутируется. */
  svg: string;
  /** old id -> new id (для отладки и проверок). */
  idMap: Record<string, string>;
}

const ID_ATTR_RE = /(?<![-:\w])(id\s*=\s*)(["'])(.*?)\2/g;
const URL_REF_RE = /url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g;
const HREF_RE = /(?<![-:\w])((?:xlink:)?href\s*=\s*)(["'])#([^"']+)\2/g;

/**
 * Префиксует все id и ссылки на них.
 *
 * Поддерживаются:
 *  - id="...";
 *  - url(#...) в fill/stroke/clip-path/mask/filter/marker-…/style;
 *  - href="#..." и xlink:href="#..." (в библиотеке их нет, но формат общий).
 *
 * Ссылки на неизвестные id (например, внешние) не трогаются.
 */
export function remapSvgIds(svg: string, prefix: string): RemapResult {
  const idMap: Record<string, string> = {};

  // 1. Собираем объявленные id.
  for (const match of svg.matchAll(ID_ATTR_RE)) {
    const oldId = match[3];
    if (oldId && !(oldId in idMap)) idMap[oldId] = `${prefix}${oldId}`;
  }

  // 2. Переписываем сами объявления id.
  let result = svg.replace(ID_ATTR_RE, (match, before: string, quote: string, oldId: string) => {
    const nextId = idMap[oldId];
    return nextId ? `${before}${quote}${nextId}${quote}` : match;
  });

  // 3. Переписываем url(#...) — покрывает fill/stroke/clip-path/mask/filter/marker-*.
  result = result.replace(URL_REF_RE, (match, _quote: string, oldId: string) => {
    const nextId = idMap[oldId];
    return nextId ? `url(#${nextId})` : match;
  });

  // 4. Переписываем локальные href/xlink:href.
  result = result.replace(HREF_RE, (match, before: string, quote: string, oldId: string) => {
    const nextId = idMap[oldId];
    return nextId ? `${before}${quote}#${nextId}${quote}` : match;
  });

  return { svg: result, idMap };
}
