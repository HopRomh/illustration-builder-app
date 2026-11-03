/**
 * Перекраска по ролям палитры (§8).
 *
 * Объекты в assets/library/ выгружены в референсной схеме, которая указана
 * в data/object-map.json (`referenceScheme`). При загрузке SVG каждый
 * Fabric-объект один раз получает роли fill и stroke (WeakMap), а смена схемы
 * только подставляет цвета тех же ролей из целевой палитры. Fabric-объекты,
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
import objectMapJson from '../../data/object-map.json';
import type { FabricObject } from 'fabric';
import type { Palette, RoleId, SchemeId } from '../types';

export const PALETTES = palettesJson as unknown as Palette[];

interface ReferenceConfig {
  referenceScheme?: unknown;
}

/**
 * Референсная схема библиотеки. Читается из карты, а не хардкодится:
 * при смене referenceScheme перекраска продолжит работать без правок кода.
 * Если карта пуста/содержит неизвестную схему — берём первую палитру,
 * затем lilac как последний безопасный fallback.
 */
export function resolveReferenceScheme(
  config: ReferenceConfig = objectMapJson,
  palettes: readonly Palette[] = PALETTES,
): SchemeId {
  const candidate = config.referenceScheme;
  if (
    typeof candidate === 'string' &&
    palettes.some((palette) => palette.scheme === candidate)
  ) {
    return candidate;
  }

  return palettes[0]?.scheme ?? 'lilac';
}

export const REFERENCE_SCHEME: SchemeId = resolveReferenceScheme();

const NAMED_COLORS: Record<string, string> = {
  white: '#FFFFFF',
};

const roleTables = new WeakMap<Palette, Map<string, RoleId>>();

/** fill и stroke классифицируются независимо: у path они могут быть из разных ролей. */
interface ObjectRoles {
  fill: RoleId | null;
  stroke: RoleId | null;
}

const rolesByObject = new WeakMap<FabricObject, ObjectRoles>();

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
  const fill = classifyRole(colorOf(root.fill), palette);
  const stroke = classifyRole(colorOf(root.stroke), palette);

  if (fill || stroke) rolesByObject.set(root, { fill, stroke });

  for (const child of childrenOf(root)) tagRoles(child, palette);
}

/**
 * Перекрашивает группу in-place: fill и stroke каждого объекта получают
 * цвет своей роли из целевой схемы. Структура SVG, uid, позиция, угол и
 * слой не меняются.
 */
export function applyScheme(
  root: FabricObject,
  scheme: SchemeId,
  palettes: readonly Palette[] = PALETTES,
): void {
  const palette = getPalette(scheme, palettes);

  const visit = (object: FabricObject): void => {
    const roles = rolesByObject.get(object);

    if (roles?.fill && normalizeColor(colorOf(object.fill))) {
      object.set('fill', palette.colors[roles.fill]);
    }
    if (roles?.stroke && normalizeColor(colorOf(object.stroke))) {
      object.set('stroke', palette.colors[roles.stroke]);
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
