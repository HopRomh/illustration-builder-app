/**
 * Перекраска по ролям палитры (§8).
 *
 * Объекты в assets/library/ выгружены в референсной схеме lilac. При загрузке
 * SVG каждый Fabric-объект один раз получает роль (WeakMap), а смена схемы
 * только подставляет цвет той же роли из целевой палитры. Fabric-объекты,
 * их uid, координаты, углы и порядок слоёв не пересоздаются, кеш loadSvg
 * не инвалидируется.
 *
 * Роли определяются по таблице «HEX → роль» именно референсной схемы.
 * Глобальная таблица по всем схемам неоднозначна: #80DADA — это
 * peach:obj-2 и mint:bg-2, #BEEBEB — peach:obj-3 и mint:bg-1.
 *
 * В объектных SVG белый задан как fill="white", а не #FFFFFF, поэтому
 * именованный цвет нормализуется в #FFFFFF (роль obj-white).
 */
import palettesJson from '../../data/palettes.json';
import type { FabricObject } from 'fabric';
import type { Palette, RoleId, SchemeId } from '../types';

/** Референсная схема библиотеки. Константа, object-map.json в runtime не тянем. */
export const REFERENCE_SCHEME: SchemeId = 'lilac';

export const PALETTES = palettesJson as unknown as Palette[];

const NAMED_COLORS: Record<string, string> = {
  white: '#FFFFFF',
};

const roleTables = new WeakMap<Palette, Map<string, RoleId>>();
const roleByObject = new WeakMap<FabricObject, RoleId>();

/** Нормализует цвет к #RRGGBB в верхнем регистре; null — не цвет палитры. */
export function normalizeColor(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower === 'none' || lower === 'transparent' || lower.startsWith('url(')) {
    return null;
  }

  const named = NAMED_COLORS[lower];
  if (named) return named;

  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (match) {
    const hex =
      match[1].length === 3
        ? match[1]
            .split('')
            .map((char) => char + char)
            .join('')
        : match[1];

    return `#${hex.toUpperCase()}`;
  }

  // Fabric пишет цвета в style как rgb(...)/rgba(...), поэтому такие значения
  // тоже должны участвовать в проверке схемы.
  const rgb = /^rgba?\(\s*(\d{1,3})\s*(?:,\s*|\s+)(\d{1,3})\s*(?:,\s*|\s+)(\d{1,3})(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i.exec(
    trimmed,
  );
  if (!rgb) return null;

  const channels = rgb.slice(1, 4).map(Number);
  if (channels.some((channel) => channel > 255)) return null;

  return `#${channels
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

export function getPalette(
  scheme: SchemeId,
  palettes: readonly Palette[] = PALETTES,
): Palette {
  const palette = palettes.find((entry) => entry.scheme === scheme);
  if (!palette) {
    throw new Error(`recolor: схема «${scheme}» не найдена в palettes.json.`);
  }
  return palette;
}

function roleTable(palette: Palette): Map<string, RoleId> {
  const cached = roleTables.get(palette);
  if (cached) return cached;

  const table = new Map<string, RoleId>();
  for (const [role, color] of Object.entries(palette.colors) as [RoleId, string][]) {
    const normalized = normalizeColor(color);
    if (normalized) table.set(normalized, role);
  }

  roleTables.set(palette, table);
  return table;
}

/** Цвет → роль в заданной палитре; null, если цвет вне палитры. */
export function classifyRole(
  color: string | null | undefined,
  palette: Palette = getPalette(REFERENCE_SCHEME),
): RoleId | null {
  const normalized = normalizeColor(color);
  if (!normalized) return null;
  return roleTable(palette).get(normalized) ?? null;
}

interface GroupLike extends FabricObject {
  getObjects?: () => FabricObject[];
}

function childrenOf(object: FabricObject): FabricObject[] {
  const getObjects = (object as GroupLike).getObjects;
  return typeof getObjects === 'function' ? getObjects.call(object) : [];
}

function colorOf(value: FabricObject['fill'] | FabricObject['stroke']): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Рекурсивно проставляет роли по референсной схеме. Вызывается один раз
 * после loadSvg, до первой перекраски.
 */
export function tagRoles(
  root: FabricObject,
  palette: Palette = getPalette(REFERENCE_SCHEME),
): void {
  const role =
    classifyRole(colorOf(root.fill), palette) ?? classifyRole(colorOf(root.stroke), palette);

  if (role) roleByObject.set(root, role);

  for (const child of childrenOf(root)) tagRoles(child, palette);
}

/**
 * Перекрашивает группу in-place: у каждого объекта с известной ролью
 * fill/stroke заменяется цветом той же роли из целевой схемы.
 * Структура SVG, uid, позиция, угол и слой не меняются.
 */
export function applyScheme(
  root: FabricObject,
  scheme: SchemeId,
  palettes: readonly Palette[] = PALETTES,
): void {
  const palette = getPalette(scheme, palettes);

  const visit = (object: FabricObject): void => {
    const role = roleByObject.get(object);

    if (role) {
      const color = palette.colors[role];
      if (normalizeColor(colorOf(object.fill))) {
        object.set('fill', color);
      }
      if (normalizeColor(colorOf(object.stroke))) {
        object.set('stroke', color);
      }
    }

    object.dirty = true;
    for (const child of childrenOf(object)) visit(child);
  };

  visit(root);
}

/** Перекраска всех объектов сцены (значения objectsByUid из CanvasStage). */
export function applySchemeToScene(
  objects: Iterable<FabricObject>,
  scheme: SchemeId,
  palettes: readonly Palette[] = PALETTES,
): void {
  for (const object of objects) applyScheme(object, scheme, palettes);
}
