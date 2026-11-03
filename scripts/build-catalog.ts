/**
 * Этап 2: сборка каталога и палитр.
 *
 * Источник правды — data/object-map.json (ручная карта). Скрипт не угадывает
 * по именам файлов и не меняет карту: имена, теги, пары, палитры, подложки,
 * исключения берутся из карты, а из assets/raw/ извлекаются только цвета,
 * геометрия (viewBox) и содержимое SVG.
 *
 * Выход:
 *  - assets/library/{main,background,backdrop}/{L,S}/<file>.svg — нормализованные SVG
 *  - data/catalog.json       — объекты и подложки (идемпотентно, ручные правки сохраняются)
 *  - data/palettes.json      — 3 схемы по 8 ролей
 *  - data/catalog-report.md  — отчёт (7 секций)
 *
 * Ошибки (шаги 1–3 и нормализация) останавливают сборку с кодом 1.
 * Предупреждения и цвета вне палитр не останавливают, попадают в отчёт.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Типы (§7 ТЗ)
// ---------------------------------------------------------------------------

export type Size = 'L' | 'S';
export type Variant = 'main' | 'background';
export type SchemeId = string;
export type RoleId =
  | 'bg-1'
  | 'bg-2'
  | 'bg-3'
  | 'bg-black'
  | 'obj-1'
  | 'obj-2'
  | 'obj-3'
  | 'obj-white';

export interface VariantFile {
  file: string;
  viewBox: [number, number, number, number];
}

export interface LibraryItem {
  id: string;
  name: string;
  tags: string[];
  variants: Partial<Record<`${Variant}-${Size}`, VariantFile>>;
}

export interface Backdrop {
  id: string;
  scheme: SchemeId;
  size: Size;
  file: string;
  viewBox: [number, number, number, number];
}

export interface Palette {
  scheme: SchemeId;
  colors: Record<RoleId, string>;
}

// Карта (data/object-map.json)
interface MapVariantRef {
  file: string;
  type: Variant;
  size: Size;
}
interface MapObject {
  id: string;
  name: string;
  tags: string[];
  'main-L'?: string;
  'background-L'?: string;
  'main-S'?: string;
  'background-S'?: string;
  pairing?: string;
}
interface MapExcluded {
  name: string;
  files: MapVariantRef[];
  reason?: string;
}
interface MapRef {
  scheme: string;
  size: Size;
  file: string;
}
export interface ObjectMap {
  folders: Record<string, string>;
  objects: MapObject[];
  excluded: MapExcluded[];
  palettes: MapRef[];
  backdrops: MapRef[];
  referenceScheme?: string;
}

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

// ---------------------------------------------------------------------------
// Константы
// ---------------------------------------------------------------------------

const VARIANT_KEYS = ['main-L', 'background-L', 'main-S', 'background-S'] as const;

const BG_COL_ROLES: RoleId[] = ['bg-1', 'bg-2', 'bg-3', 'bg-black'];
const OBJ_COL_ROLES: RoleId[] = ['obj-1', 'obj-2', 'obj-3', 'obj-white'];
const ALL_ROLES: RoleId[] = [...BG_COL_ROLES, ...OBJ_COL_ROLES];

/**
 * #FFFFFF — нейтральный белый (блик/фон), а не цвет объекта. В текущих
 * палитрах он совпадает с obj-white, но предупреждение о подложках для него
 * не выдаём: белый допустим в декоративных элементах фона.
 */
export const NEUTRAL_BACKDROP_WHITE = '#FFFFFF';

export type BackdropColorRole =
  | 'bg-1'
  | 'bg-2'
  | 'bg-3'
  | 'bg-black'
  | 'neutral-white'
  | 'obj-*'
  | 'вне палитр';

/**
 * Роль цвета в подложке конкретной схемы. Сначала проверяются bg-роли этой
 * схемы (один и тот же HEX может быть bg в одной схеме и obj в другой),
 * затем цвета объектов. #FFFFFF считается нейтральным.
 */
export function classifyBackdropColor(
  hex: string,
  palette: Palette,
  objRoleColors: ReadonlySet<string>,
): BackdropColorRole {
  if (hex === palette.colors['bg-1']) return 'bg-1';
  if (hex === palette.colors['bg-2']) return 'bg-2';
  if (hex === palette.colors['bg-3']) return 'bg-3';
  if (hex === palette.colors['bg-black']) return 'bg-black';
  if (hex === NEUTRAL_BACKDROP_WHITE) return 'neutral-white';
  if (objRoleColors.has(hex)) return 'obj-*';
  return 'вне палитр';
}

const LIBRARY_DIR = 'assets/library';
const RAW_DIR = 'assets/raw';

// ---------------------------------------------------------------------------
// Утилиты
// ---------------------------------------------------------------------------

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function readJson(file: string): unknown {
  if (!fs.existsSync(file)) {
    throw new CatalogError(`Не найден файл ${file}. Сначала собери карту object-map.json.`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new CatalogError(`Не удалось прочитать JSON ${file}: ${String(err)}`);
  }
}

/** Все SVG из папки assets/raw: относительные пути `папка/файл.svg` (сортировка стабильная). */
export function listRawFiles(rootDir: string): string[] {
  const raw = path.join(rootDir, RAW_DIR);
  if (!fs.existsSync(raw)) {
    throw new CatalogError(`Папка ${raw} не существует. Убедись, что этап 2 запускается из корня проекта.`);
  }
  const out: string[] = [];
  for (const folder of fs.readdirSync(raw)) {
    const abs = path.join(raw, folder);
    if (!fs.statSync(abs).isDirectory()) continue;
    for (const file of fs.readdirSync(abs)) {
      if (!file.toLowerCase().endsWith('.svg')) continue;
      out.push(toPosix(path.join(folder, file)));
    }
  }
  return out.sort();
}

/** Нормализация именованного цвета, #rgb/#rrggbb/#rrggbbaa и rgb(...) → #RRGGBB. */
const NAMED_COLORS: Record<string, string> = {
  white: '#FFFFFF', black: '#000000', silver: '#C0C0C0', gray: '#808080', grey: '#808080',
  red: '#FF0000', maroon: '#800000', yellow: '#FFFF00', olive: '#808000', lime: '#00FF00',
  green: '#008000', aqua: '#00FFFF', cyan: '#00FFFF', teal: '#008080', blue: '#0000FF',
  navy: '#000080', fuchsia: '#FF00FF', magenta: '#FF00FF', purple: '#800080',
  orange: '#FFA500', gold: '#FFD700', pink: '#FFC0CB', brown: '#A52A2A',
};

export function normalizeColor(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v || v === 'none') return null;
  if (v.startsWith('#')) {
    let hex = v.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length >= 6 && /^[0-9a-f]+$/.test(hex)) return `#${hex.slice(0, 6).toUpperCase()}`;
    return `#${v.toUpperCase()}`;
  }
  if (v.startsWith('rgb')) {
    const m = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
    if (m) {
      const toHex = (n: string) => Math.round(parseFloat(n)).toString(16).padStart(2, '0');
      return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`.toUpperCase();
    }
    return null;
  }
  return NAMED_COLORS[v] ?? v.toLowerCase();
}

// ---------------------------------------------------------------------------
// Лёгкий сканер SVG (без внешних зависимостей)
// ---------------------------------------------------------------------------

interface SvgElem {
  name: string;
  attrs: Record<string, string>;
  inDefs: boolean;
  isRoot: boolean;
  selfClosed: boolean;
}

/**
 * Сканирует XML-текст SVG: возвращает элементы с атрибутами.
 * Текстовые узлы, комментарии и CDATA пропускаются. Атрибуты в кавычках
 * (включая '>' внутри значения) учитываются.
 */
export function scanSvg(xml: string): SvgElem[] {
  const out: SvgElem[] = [];
  const stack: string[] = [];
  const inDefs = () => stack.includes('defs');

  let pos = 0;
  while (pos < xml.length) {
    const lt = xml.indexOf('<', pos);
    if (lt === -1) break;
    if (xml.startsWith('<!--', lt)) {
      const close = xml.indexOf('-->', lt + 4);
      pos = close === -1 ? xml.length : close + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const close = xml.indexOf(']]>', lt + 9);
      pos = close === -1 ? xml.length : close + 3;
      continue;
    }
    if (xml[lt + 1] === '!' || xml[lt + 1] === '?') {
      const gt = xml.indexOf('>', lt);
      pos = gt === -1 ? xml.length : gt + 1;
      continue;
    }
    const m = xml.slice(lt).match(/^<(\/)?([a-zA-Z][a-zA-Z0-9:_-]*)/);
    if (!m) {
      pos = lt + 1;
      continue;
    }
    // ищем конец тега, уважая кавычки в значениях атрибутов
    let i = lt + m[0].length;
    let quote = '';
    while (i < xml.length) {
      const ch = xml[i];
      if (quote !== '') {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      i++;
    }
    if (i >= xml.length) break;
    const inner = xml.slice(lt + m[0].length, i);
    const closing = m[1] === '/';
    const name = m[2];
    const selfClosed = !closing && /\/\s*$/.test(inner);

    const attrs: Record<string, string> = {};
    const attrRe = /\s+([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(inner))) {
      const key = am[1].toLowerCase();
      const val = am[2] ?? am[3] ?? am[4] ?? '';
      if (key && !(key in attrs)) attrs[key] = val;
    }

    if (closing) {
      stack.pop();
    } else if (!selfClosed) {
      stack.push(name);
    }

    out.push({
      name,
      attrs,
      inDefs: inDefs(),
      isRoot: name === 'svg' && out.every((e) => e.name !== 'svg'),
      selfClosed,
    });
    pos = i + 1;
  }
  return out;
}

interface RootSvgInfo {
  tagStart: number;
  tagEnd: number;
  viewBox: [number, number, number, number];
  width: number | null;
  height: number | null;
}

function parseRootSvg(xml: string): RootSvgInfo {
  const m = xml.match(/<svg[\s>]/);
  if (!m || m.index === undefined) {
    throw new CatalogError('Корневой <svg> не найден.');
  }
  const tagStart = m.index;
  // +4 — сразу после «<svg»; так корректно обрабатывается и корень без атрибутов («<svg>»)
  let i = tagStart + 4;
  let quote = '';
  while (i < xml.length) {
    const ch = xml[i];
    if (quote !== '') {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      break;
    }
    i++;
  }
  if (i >= xml.length) throw new CatalogError('Не найден конец корневого <svg>.');
  const attrs = parseRootAttrs(xml, tagStart, i);
  const get = (n: string) => attrs.find((a) => a.name.toLowerCase() === n)?.value;

  const vbTokens = (get('viewBox') ?? '')
    .split(/[\s,]+/)
    .map((t) => parseFloat(t))
    .filter((n) => Number.isFinite(n));

  let viewBox: [number, number, number, number];
  if (vbTokens.length === 4) {
    viewBox = [vbTokens[0], vbTokens[1], vbTokens[2], vbTokens[3]];
  } else {
    const w = parseFloat((get('width') ?? '').replace(/px$/, ''));
    const h = parseFloat((get('height') ?? '').replace(/px$/, ''));
    if (!Number.isFinite(w) || !Number.isFinite(h)) {
      throw new CatalogError(`Не удалось определить viewBox корневого <svg>: "${get('viewBox') ?? '—'}".`);
    }
    viewBox = [0, 0, w, h];
  }

  const width = get('width') ? parseFloat(get('width')!.replace(/px$/, '')) : viewBox[2];
  const height = get('height') ? parseFloat(get('height')!.replace(/px$/, '')) : viewBox[3];

  return { tagStart, tagEnd: i + 1, viewBox, width, height };
}

// общие данные корня для normalizeSvgXml (пересборка атрибутов в исходном порядке)
interface RootAttrPair {
  name: string;
  value: string;
}

function parseRootAttrs(xml: string, start: number, endExclusive: number): RootAttrPair[] {
  const inner = xml.slice(start + 4, endExclusive);
  const pairs: RootAttrPair[] = [];
  const attrRe = /\s+([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let am: RegExpExecArray | null;
  while ((am = attrRe.exec(inner))) {
    pairs.push({ name: am[1], value: am[2] ?? am[3] ?? am[4] ?? '' });
  }
  return pairs;
}

/**
 * Имена атрибутов, которые повторяются в корневом <svg>.
 * Сравнение регистронезависимое: `viewBox` и `viewbox` — одна и та же
 * семантика для нашей нормализации, и именно такой дубль ловится после
 * ошибочного `set('viewBox', ...)`.
 */
export function duplicateRootAttributes(xml: string): string[] {
  const root = parseRootSvg(xml);
  const counts = new Map<string, { name: string; count: number }>();
  for (const pair of parseRootAttrs(xml, root.tagStart, root.tagEnd - 1)) {
    const key = pair.name.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { name: pair.name, count: 1 });
  }
  return [...counts.values()]
    .filter((entry) => entry.count > 1)
    .map((entry) => `${entry.name}×${entry.count}`);
}

/**
 * Нормализация SVG: правится только корневой <svg> (width/height/viewBox),
 * остальной документ сохраняется байт-в-байт. Геометрия не меняется.
 */
export function normalizeSvgXml(xml: string): string {
  const root = parseRootSvg(xml);

  const frame = (n: number): string => {
    const s = String(n);
    return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
  };
  const vb = root.viewBox.map((n) => frame(n)).join(' ');

  // пересобираем атрибуты корня в исходном порядке, подменяя три ключевых
  const rawPairs = parseRootAttrs(xml, root.tagStart, root.tagEnd - 1);
  const set = (n: string, v: string) => {
    // Сравнение имён атрибутов регистронезависимое: XML-имена чувствительны
    // к регистру, а в исходниках встречается и `viewBox` (именно он), и
    // `viewbox`; без toLowerCase() существующий viewBox не находился и
    // добавлялся вторым — DOMParser получал parsererror.
    const found = rawPairs.find((p) => p.name.toLowerCase() === n.toLowerCase());
    if (found) found.value = v;
    else rawPairs.push({ name: n, value: v });
  };
  set('width', frame(root.width ?? root.viewBox[2]));
  set('height', frame(root.height ?? root.viewBox[3]));
  set('viewBox', vb);

  const tag = `<svg ${rawPairs.map((p) => `${p.name}="${p.value}"`).join(' ')}>`;
  return xml.slice(0, root.tagStart) + tag + xml.slice(root.tagEnd);
}

// ---------------------------------------------------------------------------
// Bbox пути по d (M/L/H/V/C/S/Q/T/A/Z; относительные и абсолютные) + дуги
// ---------------------------------------------------------------------------

export function pathToBBox(d: string): [number, number, number, number] | null {
  const toks = d.match(/([a-zA-Z])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g);
  if (!toks || toks.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  };

  const num = (i: number) => parseFloat(toks[i]);

  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let prevCtl: { x: number; y: number } | null = null;
  let prevCmd = '';

  const readPairs = (count: number, abs: boolean): number[][] => {
    const pts: number[][] = [];
    for (let k = 0; k < count; k++) {
      const px = num(i);
      const py = num(i + 1);
      i += 2;
      pts.push([abs ? px : x + px, abs ? py : y + py]);
    }
    return pts;
  };
  const readCoords = (count: number): number[] => {
    const out: number[] = [];
    for (let k = 0; k < count; k++) out.push(num(i++));
    return out;
  };

  while (i < toks.length) {
    const t = toks[i];
    if (/[a-zA-Z]/.test(t)) {
      cmd = t;
      i++;
      continue;
    }

    const abs = cmd === cmd.toUpperCase();
    const c = abs ? cmd : cmd.toUpperCase();

    switch (c) {
      case 'M': {
        const [mx, my] = readPairs(1, abs)[0];
        x = mx;
        y = my;
        startX = mx;
        startY = my;
        add(mx, my);
        prevCtl = null;
        // последующие пары после M — это L
        while (i < toks.length && !/[a-zA-Z]/.test(toks[i])) {
          const [lx, ly] = readPairs(1, abs)[0];
          x = lx;
          y = ly;
          add(lx, ly);
        }
        prevCmd = 'M';
        break;
      }
      case 'L': {
        const [lx, ly] = readPairs(1, abs)[0];
        x = lx;
        y = ly;
        add(lx, ly);
        prevCmd = 'L';
        break;
      }
      case 'H': {
        const nx = abs ? num(i++) : x + num(i++);
        x = nx;
        add(nx, y);
        prevCmd = 'H';
        break;
      }
      case 'V': {
        const ny = abs ? num(i++) : y + num(i++);
        y = ny;
        add(x, ny);
        prevCmd = 'V';
        break;
      }
      case 'C': {
        const six = readCoords(6);
        if (six.length < 6) {
          i = toks.length;
          break;
        }
        const ax = abs ? six[0] : x + six[0];
        const ay = abs ? six[1] : y + six[1];
        const bx = abs ? six[2] : x + six[2];
        const by = abs ? six[3] : y + six[3];
        const cx = abs ? six[4] : x + six[4];
        const cy = abs ? six[5] : y + six[5];
        add(ax, ay);
        add(bx, by);
        add(cx, cy);
        prevCtl = { x: bx, y: by };
        x = cx;
        y = cy;
        prevCmd = 'C';
        break;
      }
      case 'S': {
        const four = readCoords(4);
        if (four.length < 4) {
          i = toks.length;
          break;
        }
        const ax = prevCmd === 'C' || prevCmd === 'S' ? 2 * x - prevCtl!.x : x;
        const ay = prevCmd === 'C' || prevCmd === 'S' ? 2 * y - prevCtl!.y : y;
        const bx = abs ? four[0] : x + four[0];
        const by = abs ? four[1] : y + four[1];
        const cx = abs ? four[2] : x + four[2];
        const cy = abs ? four[3] : y + four[3];
        add(ax, ay);
        add(bx, by);
        add(cx, cy);
        prevCtl = { x: bx, y: by };
        x = cx;
        y = cy;
        prevCmd = 'S';
        break;
      }
      case 'Q': {
        const four = readCoords(4);
        if (four.length < 4) {
          i = toks.length;
          break;
        }
        const ax = abs ? four[0] : x + four[0];
        const ay = abs ? four[1] : y + four[1];
        const cx = abs ? four[2] : x + four[2];
        const cy = abs ? four[3] : y + four[3];
        add(ax, ay);
        add(cx, cy);
        prevCtl = { x: ax, y: ay };
        x = cx;
        y = cy;
        prevCmd = 'Q';
        break;
      }
      case 'T': {
        const two = readCoords(2);
        if (two.length < 2) {
          i = toks.length;
          break;
        }
        const ax: number = prevCmd === 'Q' || prevCmd === 'T' ? 2 * x - prevCtl!.x : x;
        const ay: number = prevCmd === 'Q' || prevCmd === 'T' ? 2 * y - prevCtl!.y : y;
        const cx = abs ? two[0] : x + two[0];
        const cy = abs ? two[1] : y + two[1];
        add(ax, ay);
        add(cx, cy);
        prevCtl = { x: ax, y: ay };
        x = cx;
        y = cy;
        prevCmd = 'T';
        break;
      }
      case 'A': {
        const seven = readCoords(7);
        if (seven.length < 7) {
          i = toks.length;
          break;
        }
        let rx = Number(seven[0]);
        let ry = Number(seven[1]);
        const phi = Number(seven[2]);
        const largeArc = Number(seven[3]) !== 0;
        const sweep = Number(seven[4]) !== 0;
        const cx = abs ? seven[5] : x + seven[5];
        const cy = abs ? seven[6] : y + seven[6];
        for (const p of arcSamples(x, y, rx, ry, phi, largeArc, sweep, cx, cy)) add(p[0], p[1]);
        x = cx;
        y = cy;
        prevCmd = 'A';
        break;
      }
      case 'Z': {
        add(startX, startY);
        x = startX;
        y = startY;
        prevCtl = null;
        prevCmd = 'Z';
        break;
      }
      default:
        i = toks.length;
    }
  }

  if (!Number.isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

/** Точки дуги (эндпоинт → центр, сэмплирование) для приближённого bbox. */
function arcSamples(
  x1: number, y1: number, rx0: number, ry0: number, phiDeg: number,
  largeArc: boolean, sweep: boolean, x2: number, y2: number,
): [number, number][] {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rx0);
  let ry = Math.abs(ry0);
  if (rx === 0 || ry === 0) return [[x2, y2]];
  const phi = (phiDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  const coef = den > 0 && num > 0 ? Math.sqrt(num / den) : 0;
  const sign = largeArc === sweep ? -1 : 1;
  const cxp = sign * coef * ((rx * y1p) / ry);
  const cyp = sign * coef * (-(ry * x1p) / rx);
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;

  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const ang = (ax: number, ay: number, bx: number, by: number) =>
    Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  let theta1 = ang(1, 0, ux, uy);
  let dTheta = ang(ux, uy, vx, vy);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const N = 24;
  const pts: [number, number][] = [];
  for (let k = 0; k <= N; k++) {
    const t = theta1 + (dTheta * k) / N;
    const ex = cx + rx * Math.cos(t) * cosP - ry * Math.sin(t) * sinP;
    const ey = cy + rx * Math.cos(t) * sinP + ry * Math.sin(t) * cosP;
    pts.push([ex, ey]);
  }
  return pts;
}

// ---------------------------------------------------------------------------
// SVG интерпретация: палитры, подложки, цвета
// ---------------------------------------------------------------------------

export interface Swatch {
  tag: string;
  order: number;
  bbox: [number, number, number, number];
  fill: string;
}

export interface PaletteExtract {
  swatches: Swatch[];
  roles: Record<RoleId, string>;
  viewBox: [number, number, number, number];
}

function elementBBox(el: SvgElem): [number, number, number, number] | null {
  if (el.name === 'rect') {
    const x = parseFloat(el.attrs.x ?? '0');
    const y = parseFloat(el.attrs.y ?? '0');
    const w = parseFloat(el.attrs.width ?? '');
    const h = parseFloat(el.attrs.height ?? '');
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
    return [x, y, x + w, y + h];
  }
  if (el.name === 'path') {
    const d = el.attrs.d;
    if (!d) return null;
    const bb = pathToBBox(d);
    return bb ? [bb[0], bb[1], bb[2], bb[3]] : null;
  }
  return null;
}

/**
 * Шаг 2: палитра по геометрии. Ровно 8 элементов с заливкой (rect или path
 * с bbox по d), сетка 2×4 (две колонки «фон»/«объекты», четыре строки).
 * Роли по позиции, не по HEX. Текст не учитывается.
 */
export function extractPalette(xml: string, label: string): PaletteExtract {
  const elements = scanSvg(xml);
  const viewBox = parseRootSvg(xml).viewBox;

  const swatches: Swatch[] = [];
  for (const el of elements) {
    if (el.isRoot || el.inDefs) continue;
    if (el.name !== 'rect' && el.name !== 'path') continue;
    const fill = normalizeColor(el.attrs.fill ?? '');
    if (!fill) continue;
    const bbox = elementBBox(el);
    if (!bbox) continue;
    swatches.push({ tag: el.name, order: swatches.length + 1, bbox, fill });
  }

  if (swatches.length !== 8) {
    const list = swatches
      .map((s) => `  ${s.order}. <${s.tag}> bbox=[${s.bbox.join(', ')}] fill=${s.fill}`)
      .join('\n');
    throw new CatalogError(
      `${label}: найдено ${swatches.length} элементов с заливкой, ожидалось ровно 8 (сетка 2×4).\nНайденные:\n${list || '  (нет)'}`,
    );
  }

  // кластеризация центров: 2 колонки и 4 строки
  const centerX = swatches.map((s) => (s.bbox[0] + s.bbox[2]) / 2);
  const centerY = swatches.map((s) => (s.bbox[1] + s.bbox[3]) / 2);
  const round3 = (n: number) => Math.round(n * 1000) / 1000;

  const uniqueCenters = (vals: number[]) => {
    const sorted = [...new Set(vals.map(round3))].sort((a, b) => a - b);
    const groups: number[][] = [];
    for (const v of sorted) {
      const g = groups.find((gr) => Math.abs(gr[0] - v) < 0.5);
      if (g) g.push(v);
      else groups.push([v]);
    }
    return groups;
  };

  const colGroups = uniqueCenters(centerX);
  const rowGroups = uniqueCenters(centerY);

  const describe = (g: number[][]): string =>
    g.map((gr, idx) => `${idx + 1}: ${gr.join(', ')}`).join('; ');

  if (colGroups.length !== 2 || rowGroups.length !== 4) {
    const list = swatches
      .map((s) => `  ${s.order}. <${s.tag}> cx=${round3((s.bbox[0] + s.bbox[2]) / 2)} cy=${round3((s.bbox[1] + s.bbox[3]) / 2)} fill=${s.fill}`)
      .join('\n');
    throw new CatalogError(
      `${label}: сетка не 2×4 (колонок ${colGroups.length}, строк ${rowGroups.length}).` +
        `\nКолонки по cx: ${describe(colGroups)}\nСтроки по cy: ${describe(rowGroups)}\nНайденные:\n${list}`,
    );
  }

  const roles = {} as Record<RoleId, string>;
  const rowIndex = (s: Swatch) => {
    const cy = round3((s.bbox[1] + s.bbox[3]) / 2);
    const rows = rowGroups.map((gr) => gr[0]).sort((a, b) => a - b);
    for (let r = 0; r < rows.length; r++) {
      if (Math.abs(rows[r] - cy) < 0.5) return r;
    }
    return -1;
  };

  const leftX = Math.min(...swatches.map((s) => (s.bbox[0] + s.bbox[2]) / 2));
  for (const s of swatches) {
    const col = (s.bbox[0] + s.bbox[2]) / 2 - leftX > 0 ? 1 : 0;
    const row = rowIndex(s);
    if (row < 0) {
      throw new CatalogError(`${label}: элемент вне строк сетки: <${s.tag}> fill=${s.fill}`);
    }
    const role = col === 0 ? BG_COL_ROLES[row] : OBJ_COL_ROLES[row];
    if (roles[role] && roles[role] !== s.fill) {
      throw new CatalogError(`${label}: две заливки в одной ячейке роли ${role}: ${roles[role]} и ${s.fill}`);
    }
    roles[role] = s.fill;
  }

  for (const role of ALL_ROLES) {
    if (!roles[role]) {
      throw new CatalogError(`${label}: не хватает ячейки роли ${role}.`);
    }
  }

  return { swatches, roles, viewBox };
}

export interface BackdropColorStats {
  fillCount: number;
  strokeCount: number;
}

export interface BackdropAnalysis {
  viewBox: [number, number, number, number];
  mainRectFill: string | null;
  /** цвета видимых элементов (без defs), ключ — HEX */
  colors: Map<string, BackdropColorStats>;
}

/**
 * Анализ подложки: основной прямоугольник (bbox ≈ viewBox), видимые цвета
 * (fill+stroke всех элементов вне <defs>). Текст не учитывается.
 */
export function analyzeBackdrop(xml: string, label: string): BackdropAnalysis {
  const root = parseRootSvg(xml);
  const [vx, vy, vw, vh] = root.viewBox;
  const elements = scanSvg(xml);

  const rects: SvgElem[] = elements.filter(
    (el) => !el.isRoot && !el.inDefs && el.name === 'rect',
  );
  const mainRects = rects.filter((r) => {
    const x = parseFloat(r.attrs.x ?? '0');
    const y = parseFloat(r.attrs.y ?? '0');
    const w = parseFloat(r.attrs.width ?? '');
    const h = parseFloat(r.attrs.height ?? '');
    const tol = Math.max(0.001, 0.0001 * Math.max(vw, vh));
    return (
      Number.isFinite(w) &&
      Number.isFinite(h) &&
      Math.abs(x - vx) < tol &&
      Math.abs(y - vy) < tol &&
      Math.abs(w - vw) < tol &&
      Math.abs(h - vh) < tol
    );
  });

  if (mainRects.length === 0) {
    const rectList = rects
      .map((r) => {
        const x = parseFloat(r.attrs.x ?? '0');
        const y = parseFloat(r.attrs.y ?? '0');
        return `  <rect x=${x} y=${y} width=${r.attrs.width} height=${r.attrs.height} fill=${r.attrs.fill ?? '—'}`;
      })
      .join('\n');
    throw new CatalogError(
      `${label}: не найден основной прямоугольник (нет rect размером с viewBox ${root.viewBox.join(' ')}).\nrect-элементы:\n${rectList || '  (нет)'}`,
    );
  }
  if (mainRects.length > 1) {
    throw new CatalogError(`${label}: найдено ${mainRects.length} прямоугольников размером с viewBox.`);
  }

  const mainRectFill = normalizeColor(mainRects[0].attrs.fill ?? '');
  const colors = new Map<string, BackdropColorStats>();
  for (const el of elements) {
    if (el.isRoot || el.inDefs) continue;
    for (const key of ['fill', 'stroke'] as const) {
      const color = normalizeColor(el.attrs[key] ?? '');
      if (!color) continue;
      const stats = colors.get(color) ?? { fillCount: 0, strokeCount: 0 };
      if (key === 'fill') stats.fillCount += 1;
      else stats.strokeCount += 1;
      colors.set(color, stats);
    }
  }

  return { viewBox: root.viewBox, mainRectFill, colors };
}

/** Цвета (fill/stroke) всех элементов SVG вне <defs>; ключ — HEX, значение — счётчик. */
export function collectColors(xml: string): {
  fills: Map<string, number>;
  strokes: Map<string, number>;
} {
  const fills = new Map<string, number>();
  const strokes = new Map<string, number>();
  for (const el of scanSvg(xml)) {
    if (el.isRoot || el.inDefs) continue;
    const fill = normalizeColor(el.attrs.fill ?? '');
    if (fill) fills.set(fill, (fills.get(fill) ?? 0) + 1);
    const stroke = normalizeColor(el.attrs.stroke ?? '');
    if (stroke) strokes.set(stroke, (strokes.get(stroke) ?? 0) + 1);
  }
  return { fills, strokes };
}

// ---------------------------------------------------------------------------
// Шаг 1: карта ↔ assets/raw (54 файла, 1-в-1)
// ---------------------------------------------------------------------------

export interface FileRef {
  relPath: string; // «папка/файл.svg» — как в assets/raw/
  source: string; // откуда в карте: «objects.book.main-L», «excluded.Vector», «palettes.lilac-L», ...
}

/** Собирает все ссылки на файлы из карты: формат [type]-[size] → папка из map.folders. */
export function collectReferences(map: ObjectMap): FileRef[] {
  const refs: FileRef[] = [];
  const problems: string[] = [];

  const folderFor = (kind: 'main' | 'background' | 'palette' | 'backdrop', size: Size): string => {
    const key = `${kind}-${size}`;
    const f = map.folders?.[key];
    if (!f) problems.push(`В карте нет folders.${key}.`);
    return f ?? '';
  };

  for (const obj of map.objects) {
    if (!obj.id) problems.push('В карте объект без id.');
    if (!Array.isArray(obj.tags)) problems.push(`У объекта ${obj.id ?? '?'} нет массива tags.`);
    for (const key of VARIANT_KEYS) {
      const [type, size] = key.split('-') as [Variant, Size];
      const file = obj[key];
      if (!file || typeof file !== 'string') {
        problems.push(`У объекта ${obj.id ?? '?'} нет варианта ${key}.`);
        continue;
      }
      refs.push({ relPath: `${folderFor(type, size)}/${file}`, source: `objects.${obj.id}.${key}` });
    }
  }

  for (const ex of map.excluded ?? []) {
    for (const f of ex.files ?? []) {
      const folder = folderFor(f.type, f.size);
      refs.push({ relPath: `${folder}/${f.file}`, source: `excluded.${ex.name}.${f.type}-${f.size}` });
    }
  }

  for (const p of map.palettes ?? []) {
    refs.push({ relPath: `${folderFor('palette', p.size)}/${p.file}`, source: `palettes.${p.scheme}-${p.size}` });
  }
  for (const b of map.backdrops ?? []) {
    refs.push({ relPath: `${folderFor('backdrop', b.size)}/${b.file}`, source: `backdrops.${b.scheme}-${b.size}` });
  }

  if (problems.length > 0) {
    throw new CatalogError(`Некорректная карта object-map.json:\n- ${problems.join('\n- ')}`);
  }

  // дубликаты в самой карте
  const seen = new Map<string, string>();
  for (const r of refs) {
    if (seen.has(r.relPath)) {
      throw new CatalogError(`В карте файл встречается дважды: ${r.relPath} (${seen.get(r.relPath)} и ${r.source}).`);
    }
    seen.set(r.relPath, r.source);
  }

  return refs;
}

/** Шаг 1: сверка ссылок карты с реальными файлами assets/raw/. Возвращает список ошибок. */
export function verifyCoverage(rawFiles: string[], refs: FileRef[]): string[] {
  const errors: string[] = [];
  const rawSet = new Set(rawFiles);

  for (const r of refs) {
    if (!rawSet.has(r.relPath)) {
      errors.push(`Карта ссылается на несуществующий файл: ${r.relPath} (${r.source}).`);
    }
  }

  const refCount = new Map<string, number>();
  for (const r of refs) refCount.set(r.relPath, (refCount.get(r.relPath) ?? 0) + 1);
  for (const file of rawFiles) {
    const n = refCount.get(file) ?? 0;
    if (n === 0) {
      errors.push(`Файл ${file} из assets/raw/ не упомянут в карте (не objects, не excluded, не palettes, не backdrops).`);
    } else if (n > 1) {
      errors.push(`Файл ${file} упомянут в карте ${n} раз.`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Логика этапа: палитры, схемы, референс, цвета вне палитр
// ---------------------------------------------------------------------------

export interface SchemePalettes {
  L: Palette;
  S: Palette;
}

/** Шаг 4: сверка палитры S с L по 8 ролям. Возвращает список расхождений. */
export function comparePalettes(L: Record<RoleId, string>, S: Record<RoleId, string>): string[] {
  const diffs: string[] = [];
  for (const role of ALL_ROLES) {
    if (L[role] !== S[role]) diffs.push(`${role}: L=${L[role]} S=${S[role]}`);
  }
  return diffs;
}

/** Шаг 3: цвет основного прямоугольника подложки должен быть bg-1/bg-2/bg-3 палитры L схемы. */
export function validateBackdropScheme(
  backdropLabel: string,
  bgColor: string,
  paletteL: Palette,
): void {
  const valid = new Set([paletteL.colors['bg-1'], paletteL.colors['bg-2'], paletteL.colors['bg-3']]);
  if (!valid.has(bgColor)) {
    throw new CatalogError(
      `${backdropLabel}: цвет подложки ${bgColor} не совпадает ни с bg-1/bg-2/bg-3 палитры ${paletteL.scheme} ` +
        `(${[...valid].join(', ')}).`,
    );
  }
}

/**
 * Шаг 4: референсная схема — палитра, с которой совпало наибольшее число
 * уникальных цветов объектов. Возвращает счёт по всем схемам.
 */
export function pickReferenceScheme(
  objectColors: Set<string>,
  palettes: Record<string, Palette>,
): { reference: string; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  for (const scheme of Object.keys(palettes)) {
    const roleSet = new Set(Object.values(palettes[scheme].colors));
    counts[scheme] = [...objectColors].filter((c) => roleSet.has(c)).length;
  }
  const entries = Object.entries(counts);
  const max = Math.max(...entries.map(([, n]) => n));
  const winners = entries.filter(([, n]) => n === max).map(([s]) => s);
  let reference: string;
  if (winners.length === 1) reference = winners[0];
  else if (winners.length > 1) reference = winners.sort()[0]; // ничья — фиксируем первую по алфавиту и сообщаем
  else reference = entries[0][0];
  return { reference, counts };
}

// ---------------------------------------------------------------------------
// Сборка каталога (шаги 9–10)
// ---------------------------------------------------------------------------

/** file — путь от корня проекта до нормализованного SVG в assets/library/. */
export function libraryPath(variant: 'main' | 'background' | 'backdrop', size: Size, file: string): string {
  return `${LIBRARY_DIR}/${variant}/${size}/${file}`;
}

export interface CatalogBuildInput {
  map: ObjectMap;
  viewBoxOf: (relPath: string) => [number, number, number, number];
  refToFile: (ref: FileRef) => string;
  objectRefs: Map<string, FileRef>; // key: objects.<id>.<variantKey>
}

export interface CatalogData {
  items: LibraryItem[];
  backdrops: Backdrop[];
}

/** Шаг 9: catalog.json из карты. excluded-файлы сюда не попадают (проверено тестом). */
export function buildCatalogData(input: CatalogBuildInput): CatalogData {
  const { map, viewBoxOf, refToFile } = input;
  const items: LibraryItem[] = map.objects.map((obj) => {
    const variants: LibraryItem['variants'] = {};
    for (const key of VARIANT_KEYS) {
      const file = obj[key];
      const ref = input.objectRefs.get(`objects.${obj.id}.${key}`);
      if (!file || !ref) continue;
      const viewBox = viewBoxOf(ref.relPath);
      variants[key] = { file: refToFile(ref), viewBox };
    }
    const item: LibraryItem = { id: obj.id, name: obj.name, tags: [...obj.tags], variants };
    return item;
  });

  const backdrops: Backdrop[] = map.backdrops.map((b) => {
    const rel = `${map.folders[`backdrop-${b.size}`]}/${b.file}`;
    return {
      id: `${b.scheme}-${b.size}`,
      scheme: b.scheme,
      size: b.size,
      file: libraryPath('backdrop', b.size, b.file),
      viewBox: viewBoxOf(rel),
    };
  });

  return { items, backdrops };
}

/** Идемпотентность: сохраняет ручные правки (доп. теги, доп. поля), данные из карты — приоритетны. */
export function mergeCatalog(prev: unknown, fresh: CatalogData): CatalogData {
  const prevObj = (prev && typeof prev === 'object' ? prev : {}) as Record<string, unknown>;
  const prevItems = Array.isArray(prevObj.items) ? (prevObj.items as Record<string, unknown>[]) : [];

  const STANDARD_ITEM_KEYS = new Set(['id', 'name', 'tags', 'variants']);
  const STANDARD_BD_KEYS = new Set(['id', 'scheme', 'size', 'file', 'viewBox']);

  const findIn = (id: string, arr: Record<string, unknown>[]) => arr.find((x) => x.id === id);

  /** Подпись набора вариантов: позволяет найти ручную правку, даже если id изменили. */
  const variantSignature = (variants: unknown): string => {
    if (!variants || typeof variants !== 'object') return '';
    const v = variants as Record<string, unknown>;
    return VARIANT_KEYS.map((key) => {
      const item = v[key];
      if (!item || typeof item !== 'object') return '';
      const file = (item as Record<string, unknown>).file;
      return typeof file === 'string' ? file : '';
    }).join('|');
  };

  const prevBySignature = new Map<string, Record<string, unknown>>();
  for (const prev of prevItems) {
    const sig = variantSignature(prev.variants);
    if (sig.replace(/\|/g, '') !== '' && !prevBySignature.has(sig)) {
      prevBySignature.set(sig, prev);
    }
  }

  const usedIds = new Set<string>();

  const mergeItem = (freshItem: LibraryItem): LibraryItem => {
    const prev =
      findIn(freshItem.id, prevItems) ??
      prevBySignature.get(variantSignature(freshItem.variants));
    if (!prev) {
      usedIds.add(freshItem.id);
      return freshItem;
    }
    const prevTags = Array.isArray(prev.tags) ? (prev.tags as unknown[]) : [];
    const tags = [...freshItem.tags];
    for (const t of prevTags) {
      if (typeof t === 'string' && !tags.includes(t)) tags.push(t);
    }
    const extra: Record<string, unknown> = {};
    for (const k of Object.keys(prev)) if (!STANDARD_ITEM_KEYS.has(k)) extra[k] = prev[k];
    // ручные правки id/name сохраняются; если id занят — откатываемся к сгенерированному
    let id = typeof prev.id === 'string' && prev.id.trim() ? prev.id.trim() : freshItem.id;
    if (usedIds.has(id)) id = freshItem.id;
    usedIds.add(id);
    const name = typeof prev.name === 'string' && prev.name.trim() ? prev.name.trim() : freshItem.name;
    return { ...extra, id, name, tags, variants: freshItem.variants };
  };

  const mergeBackdrop = (fresh: Backdrop): Backdrop => {
    const prev = findIn(fresh.id, Array.isArray(prevObj.backdrops) ? (prevObj.backdrops as Record<string, unknown>[]) : []);
    if (!prev) return fresh;
    const extra: Record<string, unknown> = {};
    for (const k of Object.keys(prev)) if (!STANDARD_BD_KEYS.has(k)) extra[k] = prev[k];
    return { ...extra, id: fresh.id, scheme: fresh.scheme, size: fresh.size, file: fresh.file, viewBox: fresh.viewBox };
  };

  return {
    items: fresh.items.map(mergeItem),
    backdrops: fresh.backdrops.map(mergeBackdrop),
  };
}

// ---------------------------------------------------------------------------
// Отчёт (шаг 11)
// ---------------------------------------------------------------------------

export interface ReportData {
  rawFiles: string[];
  refs: FileRef[];
  coverageErrors: string[];
  pairRows: PairRow[];
  palettes: Palette[];
  schemesLvsSDiffs: Record<string, string[]>;
  backdropRows: BackdropRow[];
  objectFills: Map<string, number>;
  objectStrokes: Map<string, number>;
  objectColorFiles: Map<string, string[]>;
  outsidePaletteColors: Map<string, { fills: number; strokes: number; files: string[] }>;
  referenceCounts: Record<string, number>;
  reference: string;
  mapReference: string | undefined;
  warnings: string[];
  fileCounts: { objects: number; excluded: number; palettes: number; backdrops: number };
  /** После успешной сборки всегда 0: при дублях normalizerAll падает. */
  rootDuplicateAttributes: number;
}

export interface BackdropRow {
  file: string;
  size: Size;
  scheme: string;
  mainRectFill: string;
  bgRole: string;
  colors: string;
  status: string;
}

export interface PairRow {
  id: string;
  name: string;
  mainL: string;
  backgroundL: string;
  mainS: string;
  backgroundS: string;
  pairingL: string;
  pairingS: string;
}

export function buildReport(d: ReportData): string {
  const L: string[] = [];
  const p = (s = '') => L.push(s);

  p('# Отчёт сборки каталога (этап 2)');
  p();
  p(`Сборка из data/object-map.json и assets/raw/. Файлов в raw: ${d.rawFiles.length}, ссылок в карте: ${d.refs.length}.`);

  // 1. Проверка карты
  p();
  p('## 1. Проверка карты (object-map.json ↔ assets/raw/)');
  p();
  if (d.coverageErrors.length === 0) {
    p(`Файлы карты и assets/raw/ совпадают 1-в-1: **${d.rawFiles.length}/${d.refs.length}** (без неучтённых, без дублей).`);
  } else {
    p('**Ошибки сверки (сборка остановлена):**');
    for (const e of d.coverageErrors) p(`- ${e}`);
  }
  p();
  p('| Категория | Файлов | Источник в карте |');
  p('| --- | ---: | --- |');
  p(`| objects (10 объектов × 4 варианта main/background × L/S) | ${d.fileCounts.objects} | objects.*.{main-L,background-L,main-S,background-S} |`);
  p(`| excluded (Vector) | ${d.fileCounts.excluded} | excluded[].files |`);
  p(`| palettes (3 схемы × L/S) | ${d.fileCounts.palettes} | palettes[] |`);
  p(`| backdrops (3 схемы × L/S) | ${d.fileCounts.backdrops} | backdrops[] |`);
  p(`| **Итого** | **${d.fileCounts.objects + d.fileCounts.excluded + d.fileCounts.palettes + d.fileCounts.backdrops}** | |`);
  p();
  p(`В каталоге: **${d.pairRows.length} объектов × 4 варианта** (main/background × L/S); \`Vector\` исключён.`);
  p();
  p(`Дубли атрибутов корня <svg>: ${d.rootDuplicateAttributes}.`);

  // 2. Пары main/background
  p();
  p('## 2. Пары main/background');
  p();
  p('Сопоставление по нормализованному имени; Group-файлы без имени — по `data/object-map.json`.');
  p();
  p('### Размер L');
  p();
  p('| Объект | main | background | Как сопоставлено |');
  p('| --- | --- | --- | --- |');
  for (const row of d.pairRows) {
    p(`| \`${row.id}\` — ${row.name} | ${row.mainL} | ${row.backgroundL} | ${row.pairingL} |`);
  }
  p();
  p('### Размер S');
  p();
  p('| Объект | main | background | Как сопоставлено |');
  p('| --- | --- | --- | --- |');
  for (const row of d.pairRows) {
    p(`| \`${row.id}\` — ${row.name} | ${row.mainS} | ${row.backgroundS} | ${row.pairingS} |`);
  }
  p();
  p('Файлов без пары: **0**. По карте сопоставлены S-варианты `book`, `pen`, `folder` и L/S-варианты `tulips`.');

  // 3. Палитры
  p();
  p('## 3. Палитры (из 6 файлов Group …, роли по позиции 2×4)');
  p();
  const palByScheme = new Map<string, Palette>();
  for (const pal of d.palettes) palByScheme.set(pal.scheme, pal);

  const schemeNames = [...palByScheme.keys()];
  const header = ['Роль', ...schemeNames.map((s) => `${s} (L)`)];
  p(`| ${header.join(' | ')} |`);
  p(`| ${header.map(() => '---').join(' | ')} |`);
  for (const role of ALL_ROLES) {
    const cells = schemeNames.map((s) => palByScheme.get(s)?.colors[role] ?? '—');
    p(`| \`${role}\` | ${cells.join(' | ')} |`);
  }
  p();
  p('Файлы палитр: `Group 2136136332/333/334.svg` (L), `Group 2136136338/339/340.svg` (S) из папок «…Фоны Размер L/S».');

  // 4. Совпадение схем и референс
  p();
  p('## 4. Совпадение схем (референсная схема)');
  p();
  p('Сколько уникальных цветов объектов совпало с каждой схемой:');
  p();
  p('| Схема | Совпало цветов из 8 |');
  p('| --- | ---: |');
  const sortedCounts = Object.entries(d.referenceCounts).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [scheme, n] of sortedCounts) p(`| ${scheme} | ${n} |`);
  p();
  const refMark = d.reference === d.mapReference ? '✅ совпадает с картой' : `⚠️ карта говорит «${d.mapReference}»`;
  p(`**Референсная схема: ${d.reference}** (${refMark}).`);
  p();
  p('Таблица HEX → роль по референсной схеме (только для отчёта; перекраска — этап 5):');
  p();
  const refPal = palByScheme.get(d.reference);
  const hex2role = new Map<string, string>();
  if (refPal) for (const role of ALL_ROLES) hex2role.set(refPal.colors[role], role);
  p('| HEX | Роль | fill (все объекты) | stroke (все объекты) |');
  p('| --- | --- | ---: | ---: |');
  const totalFills = [...d.objectFills.values()].reduce((a, b) => a + b, 0);
  const totalStrokes = [...d.objectStrokes.values()].reduce((a, b) => a + b, 0);
  for (const [hex, role] of [...hex2role.entries()].sort()) {
    p(`| ${hex} | \`${role}\` | ${d.objectFills.get(hex) ?? 0} | ${d.objectStrokes.get(hex) ?? 0} |`);
  }
  p();
  p(`Итого по 42 объектным SVG (40 в каталоге + 2 файла Vector): fill-атрибутов **${totalFills}**, stroke-атрибутов **${totalStrokes}**.` +
    (totalFills === 3026 && totalStrokes === 0 ? ' — сходится с data/diagnostic.md (§4).' : ''));

  // 5. Сверка S с L
  p();
  p('## 5. Сверка палитр S с L');
  p();
  for (const scheme of ['lilac', 'peach', 'mint']) {
    const diffs = d.schemesLvsSDiffs[scheme] ?? [];
    if (diffs.length === 0) {
      p(`- ${scheme}: S-палитра совпадает с L по 8 цветам (роль в роль).`);
    } else {
      p(`- ${scheme}: **расхождения** S vs L:`);
      for (const df of diffs) p(`  - ${df}`);
    }
  }

  // 6. Подложки
  p();
  p('## 6. Подложки и их схемы');
  p();
  p('Цвет основного прямоугольника подложки сверен с bg-1 (допустимо bg-2/bg-3) палитры L схемы.');
  p('`#FFFFFF` считается нейтральным белым, а не цветом объекта; использование `obj-1`/`obj-2`/`obj-3` (и любого obj-white, отличного от белого) в подложке даёт предупреждение в разделе 8.');
  p();
  p('| Файл | Размер | Схема | Основной rect | Роль в L | Видимые цвета (fill/stroke) | Статус |');
  p('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of d.backdropRows) {
    p(`| ${r.file} | ${r.size} | ${r.scheme} | ${r.mainRectFill} | \`${r.bgRole}\` | ${r.colors} | ${r.status} |`);
  }

  // 7. Цвета вне палитр
  p();
  p('## 7. Цвета вне палитр');
  p();
  if (d.outsidePaletteColors.size === 0) {
    p('Цветов вне палитр: **0**. Все цвета объектов входят хотя бы в одну из трёх схем.');
  } else {
    p('**Найдены цвета, которых нет ни в одной палитре.** Нужна разметка (назначить роль или оставить фиксированным белым/чёрным):');
    p();
    p('| HEX | fill | stroke | Файлы |');
    p('| --- | ---: | ---: | --- |');
    for (const [hex, s] of [...d.outsidePaletteColors.entries()].sort()) {
      p(`| ${hex} | ${s.fills} | ${s.strokes} | ${s.files.join(', ')} |`);
    }
  }

  // 8. Предупреждения и ошибки
  p();
  p('## 8. Предупреждения и ошибки');
  p();
  if (d.warnings.length === 0) {
    p('Предупреждений нет.');
  } else {
    p(`Предупреждений: **${d.warnings.length}**.`);
    for (const w of d.warnings) p(`- ${w}`);
  }
  p();
  if (d.coverageErrors.length === 0) {
    p('Ошибок, остановивших сборку: **нет**.');
  } else {
    p(`Ошибок, остановивших сборку: **${d.coverageErrors.length}** (см. раздел 1).`);
  }
  const refNote = d.reference === d.mapReference ? '' : `\n\n**Расхождение с картой:** референсная схема скрипта «${d.reference}», в карте указана «${d.mapReference}». Нужно решение человека.`;
  if (refNote) p(refNote);

  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Запуск
// ---------------------------------------------------------------------------

function main(): void {
  const rootDir = process.cwd();
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const projectDir = fs.existsSync(path.join(rootDir, RAW_DIR)) ? rootDir : scriptDir;

  const rawFiles = listRawFiles(projectDir);
  const map = readJson(path.join(projectDir, 'data', 'object-map.json')) as ObjectMap;

  // ---- шаг 1: проверка карты ---------------------------------------------
  const refs = collectReferences(map);
  const coverageErrors = verifyCoverage(rawFiles, refs);
  if (coverageErrors.length > 0) {
    throw new CatalogError(
      `Шаг 1 (карта ↔ assets/raw/) не сошёлся:\n- ${coverageErrors.join('\n- ')}`,
    );
  }

  // ---- чтение файлов -------------------------------------------------------
  const content = new Map<string, string>();
  for (const rel of rawFiles) {
    content.set(rel, fs.readFileSync(path.join(projectDir, RAW_DIR, rel), 'utf8'));
  }

  // ---- шаг 2: палитры ------------------------------------------------------
  const palettes: Palette[] = [];
  const schemeL = new Map<string, Palette>();
  const schemeS = new Map<string, Palette>();
  for (const p of map.palettes) {
    const rel = `${map.folders[`palette-${p.size}`]}/${p.file}`;
    const label = `${p.file} (${p.size}, схема ${p.scheme})`;
    const ex = extractPalette(content.get(rel) ?? '', label);
    const palette: Palette = { scheme: p.scheme, colors: ex.roles };
    palettes.push(palette);
    (p.size === 'L' ? schemeL : schemeS).set(p.scheme, palette);
  }
  if (schemeL.size !== 3 || schemeS.size !== 3) {
    throw new CatalogError(`Ожидалось 3 палитры L и 3 палитры S, а не ${schemeL.size}/${schemeS.size}.`);
  }

  // ---- шаг 3: подложки -----------------------------------------------------
  const backdropRows: BackdropRow[] = [];
  const warnings: string[] = [];
  const objRoleColors = new Set<string>();
  for (const pal of palettes) for (const role of OBJ_COL_ROLES) objRoleColors.add(pal.colors[role]);

  for (const b of map.backdrops) {
    const rel = `${map.folders[`backdrop-${b.size}`]}/${b.file}`;
    const label = `${b.file} (${b.size}, схема ${b.scheme})`;
    const analysis = analyzeBackdrop(content.get(rel) ?? '', label);
    const paletteL = schemeL.get(b.scheme);
    if (!paletteL) throw new CatalogError(`Нет палитры L для схемы ${b.scheme}.`);
    if (!analysis.mainRectFill) {
      throw new CatalogError(`${label}: основной прямоугольник без заливки.`);
    }
    validateBackdropScheme(label, analysis.mainRectFill, paletteL);

    const rowRoles = new Map<string, string[]>();
    const colorParts: string[] = [];
    for (const [hex, stats] of analysis.colors) {
      const role = classifyBackdropColor(hex, paletteL, objRoleColors);
      if (!rowRoles.has(role)) rowRoles.set(role, []);
      rowRoles.get(role)!.push(hex);
      colorParts.push(`${hex}=${stats.fillCount > 0 ? `${stats.fillCount}f` : ''}${stats.strokeCount > 0 ? `${stats.strokeCount}s` : ''}`);
      // Цвета объектов (obj-1/2/3, obj-white) в подложке — нарушение §3.4.
      // Исключение — нейтральный #FFFFFF: он не считается цветом объекта.
      if (role === 'obj-*') {
        warnings.push(
          `подложка ${label}: используется цвет объекта ${hex} (${stats.fillCount}f/${stats.strokeCount}s).`,
        );
      } else if (role === 'вне палитр') {
        warnings.push(`подложка ${label}: цвет вне палитр ${hex} (${stats.fillCount}f/${stats.strokeCount}s).`);
      }
    }

    const bgRole: RoleId =
      analysis.mainRectFill === paletteL.colors['bg-1'] ? 'bg-1'
      : analysis.mainRectFill === paletteL.colors['bg-2'] ? 'bg-2'
      : analysis.mainRectFill === paletteL.colors['bg-3'] ? 'bg-3'
      : 'bg-black';

    backdropRows.push({
      file: b.file,
      size: b.size,
      scheme: b.scheme,
      mainRectFill: analysis.mainRectFill,
      bgRole,
      colors: colorParts.join(', '),
      status:
        rowRoles.has('obj-*') || rowRoles.has('вне палитр')
          ? '⚠️ см. раздел 8'
          : 'ok',
    });
  }

  // ---- шаги 4–6: объекты, референс, цвета вне палитр -------------------------
  const objectFills = new Map<string, number>();
  const objectStrokes = new Map<string, number>();
  const objectColorFiles = new Map<string, Set<string>>();
  // 42 объектных SVG: 40 в каталоге + 2 файла Vector (исключён, но нужен для сверки с diagnostic.md)
  const colorRefs = refs.filter(
    (r) => r.source.startsWith('objects.') || r.source.startsWith('excluded.'),
  );
  for (const ref of colorRefs) {
    const rel = ref.relPath;
    const { fills, strokes } = collectColors(content.get(rel) ?? '');
    for (const [hex, n] of fills) {
      objectFills.set(hex, (objectFills.get(hex) ?? 0) + n);
      if (!objectColorFiles.has(hex)) objectColorFiles.set(hex, new Set());
      objectColorFiles.get(hex)!.add(rel.split('/').pop() ?? rel);
    }
    for (const [hex, n] of strokes) {
      objectStrokes.set(hex, (objectStrokes.get(hex) ?? 0) + n);
      if (!objectColorFiles.has(hex)) objectColorFiles.set(hex, new Set());
      objectColorFiles.get(hex)!.add(rel.split('/').pop() ?? rel);
    }
  }

  const allSchemeColors = new Set<string>();
  for (const pal of palettes) for (const c of Object.values(pal.colors)) allSchemeColors.add(c);

  const outsidePaletteColors = new Map<string, { fills: number; strokes: number; files: string[] }>();
  const allObjectColors = new Set<string>([...objectFills.keys(), ...objectStrokes.keys()]);
  for (const hex of allObjectColors) {
    if (!allSchemeColors.has(hex)) {
      outsidePaletteColors.set(hex, {
        fills: objectFills.get(hex) ?? 0,
        strokes: objectStrokes.get(hex) ?? 0,
        files: [...(objectColorFiles.get(hex) ?? [])].sort(),
      });
    }
  }

  const palettesByScheme = new Map<string, Palette>();
  for (const pal of palettes) if (!palettesByScheme.has(pal.scheme)) palettesByScheme.set(pal.scheme, pal);
  const { reference, counts } = pickReferenceScheme(allObjectColors, Object.fromEntries(palettesByScheme));

  // шаг 4: сверка S с L
  const schemesLvsSDiffs: Record<string, string[]> = {};
  for (const scheme of Object.keys(palettesByScheme)) {
    const Lp = schemeL.get(scheme);
    const Sp = schemeS.get(scheme);
    schemesLvsSDiffs[scheme] = Lp && Sp ? comparePalettes(Lp.colors, Sp.colors) : [`нет L (${!!Lp}) или S (${!!Sp}) палитры`];
    if (schemesLvsSDiffs[scheme].length > 0) {
      warnings.push(`палитра S ≠ L для схемы ${scheme}: ${schemesLvsSDiffs[scheme].join('; ')}.`);
    }
  }

  if (map.referenceScheme && reference !== map.referenceScheme) {
    warnings.push(
      `референсная схема скрипта «${reference}» не совпадает с картой («${map.referenceScheme}»).`,
    );
  }

  // ---- шаг 8: нормализация в assets/library/ --------------------------------
  const viewBoxOf = (rel: string): [number, number, number, number] => parseRootSvg(content.get(rel) ?? '').viewBox;
  /** категория и размер файла — по ссылке карты (source), не по имени файла */
  const kindAndSizeOf = (source: string): { kind: Variant | 'backdrop' | 'skip'; size: Size } => {
    if (source.startsWith('objects.')) {
      const variantKey = source.split('.').pop() ?? '';
      return {
        kind: variantKey.startsWith('main') ? 'main' : 'background',
        size: variantKey.endsWith('-S') ? 'S' : 'L',
      };
    }
    if (source.startsWith('backdrops.')) {
      return { kind: 'backdrop', size: source.endsWith('-S') ? 'S' : 'L' };
    }
    return { kind: 'skip', size: 'L' }; // excluded и palettes в library не пишем
  };
  const normalizeAll = () => {
    const jobs: { rel: string; out: string; normalized: string }[] = [];
    const duplicateFiles: string[] = [];
    for (const ref of refs) {
      const ks = kindAndSizeOf(ref.source);
      if (ks.kind === 'skip') continue;
      const rel = ref.relPath;
      const file = rel.split('/').slice(1).join('/');
      const normalized = normalizeSvgXml(content.get(rel) ?? '');
      const duplicates = duplicateRootAttributes(normalized);
      if (duplicates.length > 0) duplicateFiles.push(`${rel} [${duplicates.join(', ')}]`);
      const out = libraryPath(ks.kind, ks.size, file);
      jobs.push({ rel, out, normalized });
    }

    // Валидация до записи: при дубле не оставляем на диске частично исправленную библиотеку.
    if (duplicateFiles.length > 0) {
      throw new CatalogError(
        `После нормализации найдены повторяющиеся атрибуты корневого <svg> (${duplicateFiles.length}):\n` +
          duplicateFiles.map((f) => `  - ${f}`).join('\n'),
      );
    }

    for (const job of jobs) {
      const outPath = path.join(projectDir, job.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, job.normalized, 'utf8');
    }
    return jobs;
  };
  const libraryWrites = normalizeAll();

  // ---- шаги 9–10: catalog.json, palettes.json -------------------------------
  const objectRefsForBuild = new Map<string, FileRef>();
  for (const r of refs) if (r.source.startsWith('objects.')) objectRefsForBuild.set(r.source, r);
  const freshCatalog = buildCatalogData({
    map,
    viewBoxOf,
    refToFile: (ref: FileRef) => {
      const src = ref.source;
      const variantKey = src.split('.').pop() ?? '';
      const kind = variantKey.startsWith('main') ? 'main' : variantKey.startsWith('background') ? 'background' : 'backdrop';
      const size = variantKey.endsWith('-S') ? 'S' : 'L';
      const file = ref.relPath.split('/').slice(1).join('/');
      return libraryPath(kind as 'main' | 'background' | 'backdrop', size, file);
    },
    objectRefs: objectRefsForBuild,
  });
  const prevCatalogFile = path.join(projectDir, 'data', 'catalog.json');
  const prevCatalog = fs.existsSync(prevCatalogFile) ? JSON.parse(fs.readFileSync(prevCatalogFile, 'utf8')) : null;
  const merged = mergeCatalog(prevCatalog, freshCatalog);
  fs.writeFileSync(prevCatalogFile, JSON.stringify(merged, null, 2) + '\n', 'utf8');

  // palettes.json — по схемам в порядке карты (L-палитры; S сверены в отчёте)
  const paletteOrder: string[] = [];
  for (const pal of palettes) if (!paletteOrder.includes(pal.scheme)) paletteOrder.push(pal.scheme);
  const palettesOut = paletteOrder.map((scheme) => {
    const lp = schemeL.get(scheme)!;
    const colors = {} as Record<RoleId, string>;
    for (const role of ALL_ROLES) colors[role] = lp.colors[role];
    return { scheme, colors };
  });
  fs.writeFileSync(
    path.join(projectDir, 'data', 'palettes.json'),
    JSON.stringify(palettesOut, null, 2) + '\n',
    'utf8',
  );

  // ---- шаг 11: отчёт ----------------------------------------------------------
  const fileCounts = {
    objects: map.objects.length * 4,
    excluded: map.excluded.reduce((a, e) => a + e.files.length, 0),
    palettes: map.palettes.length,
    backdrops: map.backdrops.length,
  };
  const pairRows: PairRow[] = map.objects.map((obj) => {
    const mainL = obj['main-L'] ?? '—';
    const backgroundL = obj['background-L'] ?? '—';
    const mainS = obj['main-S'] ?? '—';
    const backgroundS = obj['background-S'] ?? '—';
    const isGroup = (f: string) => f.toLowerCase().startsWith('group ');
    return {
      id: obj.id,
      name: obj.name,
      mainL,
      backgroundL,
      mainS,
      backgroundS,
      pairingL: isGroup(mainL) || isGroup(backgroundL) ? 'по карте' : 'по имени',
      pairingS: isGroup(mainS) || isGroup(backgroundS) ? 'по карте' : 'по имени',
    };
  });
  const report = buildReport({
    rawFiles,
    refs,
    coverageErrors,
    pairRows,
    palettes: palettesOut.map((p) => ({ scheme: p.scheme, colors: p.colors })),
    schemesLvsSDiffs,
    backdropRows,
    objectFills,
    objectStrokes,
    objectColorFiles: new Map([...objectColorFiles].map(([k, v]) => [k, [...v].sort()])),
    outsidePaletteColors,
    referenceCounts: counts,
    reference,
    mapReference: map.referenceScheme,
    warnings,
    fileCounts,
    rootDuplicateAttributes: 0,
  });
  fs.writeFileSync(path.join(projectDir, 'data', 'catalog-report.md'), report, 'utf8');

  // ---- краткий итог -----------------------------------------------------------
  console.log('Каталог собран.');
  console.log(`  Карта: ${rawFiles.length}/${refs.length} файлов 1-в-1 (objects ${fileCounts.objects}, excluded ${fileCounts.excluded}, palettes ${fileCounts.palettes}, backdrops ${fileCounts.backdrops}).`);
  console.log(`  Палитры: ${palettesOut.length} схем (${palettesOut.map((p) => p.scheme).join(', ')}), по 8 ролей 2×4; L и S совпадают: ${Object.values(schemesLvsSDiffs).every((d) => d.length === 0) ? 'да' : 'НЕТ (см. отчёт §5)'}.`);
  console.log(`  Референсная схема: ${reference}${map.referenceScheme && reference !== map.referenceScheme ? ` (в карте ${map.referenceScheme} — расхождение!)` : ' (по карте)'}.`);
  console.log(`  Цветов вне палитр: ${outsidePaletteColors.size}.`);
  console.log(`  Подложки: ${backdropRows.length}, схемы сверены с bg-1..3 палитр L — ok.`);
  console.log(`  Предупреждения: ${warnings.length}. Ошибки: 0.`);
  console.log(`  Записано: data/catalog.json (${merged.items.length} объектов, ${merged.backdrops.length} подложек), data/palettes.json, data/catalog-report.md, ${libraryWrites.length} SVG в assets/library/.`);
  if (warnings.length > 0) {
    console.log('  Предупреждения:');
    for (const w of warnings) console.log(`    - ${w}`);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  }
}
