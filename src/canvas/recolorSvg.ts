import type { Palette, RoleId, SchemeId } from '../types';
import { getPalette, normalizeColor, PALETTES, REFERENCE_SCHEME } from './recolor';

/**
 * Перекраска SVG-разметки до загрузки в <image>. Нужна превью Сценария 1:
 * файл из библиотеки всегда в референсной схеме, а превью должно совпадать
 * с финальным холстом (peach/mint).
 */
export function recolorSvgMarkup(
  svg: string,
  scheme: SchemeId,
  palettes: readonly Palette[] = PALETTES,
): string {
  if (scheme === REFERENCE_SCHEME) return svg;

  const from = getPalette(REFERENCE_SCHEME, palettes);
  const to = getPalette(scheme, palettes);
  const replacements = new Map<string, string>();

  for (const role of Object.keys(from.colors) as RoleId[]) {
    const source = normalizeColor(from.colors[role]);
    const target = normalizeColor(to.colors[role]);
    if (source && target) replacements.set(source, target);
  }

  return svg.replace(/#[0-9a-f]{6}\b/gi, (hex) => {
    return replacements.get(hex.toUpperCase()) ?? hex;
  });
}

/** data-URL для <image href>, чтобы браузер не кешировал исходный lilac-файл. */
export function recolorSvgDataUrl(
  svg: string,
  scheme: SchemeId,
  palettes: readonly Palette[] = PALETTES,
): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    recolorSvgMarkup(svg, scheme, palettes),
  )}`;
}

const pending = new Map<string, Promise<string>>();

/**
 * Загружает SVG из public/ и возвращает data-URL в нужной схеме.
 * Одинаковые файлы/схемы переиспользуют один запрос.
 */
export function loadRecoloredSvg(file: string, scheme: SchemeId): Promise<string> {
  const key = `${scheme}|${file}`;
  const cached = pending.get(key);
  if (cached) return cached;

  const request = fetch(encodeURI(file))
    .then((response) => {
      if (!response.ok) {
        throw new Error(`не удалось загрузить ${file}: HTTP ${response.status}`);
      }
      return response.text();
    })
    .then((svg) => recolorSvgDataUrl(svg, scheme));

  pending.set(key, request);
  // Ошибку не кешируем: следующий рендер может повторить запрос.
  void request.catch(() => pending.delete(key));

  return request;
}
