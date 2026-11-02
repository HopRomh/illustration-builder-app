import type { TSVGExportOptions } from 'fabric';
import type { Palette, Scene } from '../types';
import { getPalette, normalizeColor, PALETTES } from './recolor';
import { FORMATS } from './sizing';

/** Минимальный контракт: тесты экспорта не должны поднимать реальный Fabric. */
export interface ExportCanvas {
  toSVG(options?: TSVGExportOptions): string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * Векторный экспорт: убираем всё растровое и нормализуем корневой тег.
 * id групп объектов (`instance-*`) и ремапленные id клипов приходят из
 * canvas.toSVG(), потому что CanvasStage проставляет их Fabric-объектам.
 */
export function exportSvg(
  canvas: ExportCanvas,
  scene: Scene,
  palettes: readonly Palette[] = PALETTES,
): string {
  const { width, height } = FORMATS[scene.format];
  const palette = getPalette(scene.scheme, palettes);

  const raw = canvas.toSVG({
    viewBox: { x: 0, y: 0, width, height },
    width: String(width),
    height: String(height),
  });

  let svg = stripUnsupportedMarkup(raw);
  svg = normalizeRootTag(svg, width, height);
  svg = applyBackground(svg, palette.colors['bg-1'], width, height);
  svg = cleanStyleAttributes(svg);

  const foreign = findForeignColors(svg, palette);
  if (foreign.length > 0) {
    console.warn(
      `exportSvg: в SVG есть цвета вне схемы «${scene.scheme}»: ${foreign.join(', ')}`,
    );
  }

  return svg;
}

function stripUnsupportedMarkup(svg: string): string {
  return svg
    .replace(/<image\b[^>]*>[\s\S]*?<\/image>/gi, '')
    .replace(/<image\b[^>]*\/>/gi, '')
    .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/<foreignObject\b[^>]*\/>/gi, '')
    .replace(/<filter\b[^>]*>[\s\S]*?<\/filter>/gi, '')
    .replace(/\sfilter="url\(#[^"]*\)"/gi, '')
    .replace(/\sfilter\s*:\s*url\([^)]*\)\s*;?/gi, '');
}

function normalizeRootTag(svg: string, width: number, height: number): string {
  const root = svg.match(/<svg\b[^>]*>/i);
  if (!root) {
    throw new Error('exportSvg: canvas.toSVG() вернул строку без корневого <svg>.');
  }

  const rest = root[0]
    .replace(/^<svg\b/i, '')
    .replace(/\/?>$/, '')
    .replace(/\s(?:xmlns(?::xlink)?|width|height|viewBox)\s*=\s*("[^"]*"|'[^']*')/gi, '');

  const normalized =
    `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" ` +
    `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"${rest}>`;

  return svg.replace(root[0], normalized);
}

/**
 * Fabric кладёт цвет холста отдельным <rect> сразу после <defs>.
 * Заменяем его на bg-1 целевой схемы; если такого rect нет — добавляем.
 */
function applyBackground(svg: string, color: string, width: number, height: number): string {
  const rect = `<rect x="0" y="0" width="${width}" height="${height}" fill="${color}"></rect>`;
  // Fabric 7 кладёт фон с явными width/height, старые версии — с 100%.
  const fullSize = new RegExp(
    `<rect\\b(?=[^>]*\\bx="0")(?=[^>]*\\by="0")` +
      `(?=[^>]*\\bwidth="(?:100%|${width})")(?=[^>]*\\bheight="(?:100%|${height})")` +
      `[^>]*?(?:\\/>|>[\\s\\S]*?<\\/rect>)`,
    'i',
  );

  if (fullSize.test(svg)) return svg.replace(fullSize, rect);

  const defsEnd = svg.indexOf('</defs>');
  if (defsEnd !== -1) {
    const insertAt = defsEnd + '</defs>'.length;
    return `${svg.slice(0, insertAt)}\n${rect}${svg.slice(insertAt)}`;
  }

  return svg.replace(/(<svg\b[^>]*>)/i, `$1\n${rect}`);
}

/** Убирает пустые style и лишние пробелы; сами стили Fabric оставляем. */
function cleanStyleAttributes(svg: string): string {
  return svg.replace(/\sstyle="([^"]*)"/gi, (_match, raw: string) => {
    const style = raw
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .join('; ');
    return style ? ` style="${style}"` : '';
  });
}

/** Цвета fill/stroke/stop-color, которых нет в палитре текущей схемы. */
export function findForeignColors(svg: string, palette: Palette): string[] {
  const allowed = new Set(
    Object.values(palette.colors)
      .map((color) => normalizeColor(color))
      .filter((color): color is string => color !== null),
  );
  // §8: фиксированный чёрный/белый допустим, если его нет в палитре.
  allowed.add('#000000');

  const found = new Set<string>();
  const collect = (value: string | undefined): void => {
    const color = normalizeColor(value);
    if (color && !allowed.has(color)) found.add(color);
  };

  const attr = /\b(?:fill|stroke|stop-color)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let match: RegExpExecArray | null = attr.exec(svg);
  while (match) {
    collect(match[1] ?? match[2]);
    match = attr.exec(svg);
  }

  // Fabric переносит заливки в style="fill: rgb(...)"; без этого прохода
  // проверка схемы пропускала бы почти все цвета объектов.
  const styleAttr = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  match = styleAttr.exec(svg);
  while (match) {
    const style = match[1] ?? match[2] ?? '';
    for (const declaration of style.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon === -1) continue;

      const property = declaration.slice(0, colon).trim().toLowerCase();
      if (property === 'fill' || property === 'stroke' || property === 'stop-color') {
        collect(declaration.slice(colon + 1));
      }
    }
    match = styleAttr.exec(svg);
  }

  return [...found];
}
