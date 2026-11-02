import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { remapSvgIds } from './remapIds';

const backdropWithClip = path.resolve(
  process.cwd(),
  'assets/library/backdrop/L/Фон-2.svg',
);
const backdropWithoutIds = path.resolve(process.cwd(), 'assets/library/backdrop/L/Фон.svg');

const source = readFileSync(backdropWithClip, 'utf8');
const sourceWithoutIds = readFileSync(backdropWithoutIds, 'utf8');

function collectIds(svg: string): string[] {
  return [...svg.matchAll(/(?<![-:\w])id\s*=\s*(["'])(.*?)\1/g)].map((match) => match[2]);
}

function collectUrlRefs(svg: string): string[] {
  return [...svg.matchAll(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g)].map((match) => match[2]);
}

describe('remapSvgIds', () => {
  it('даёт разные префиксы двум экземплярам и не мутирует вход', () => {
    const original = source;
    const first = remapSvgIds(source, 'u1-');
    const second = remapSvgIds(source, 'u2-');

    expect(source).toBe(original);
    expect(first.idMap.clip0_21_25399).toBe('u1-clip0_21_25399');
    expect(second.idMap.clip0_21_25399).toBe('u2-clip0_21_25399');

    const firstIds = collectIds(first.svg);
    const secondIds = collectIds(second.svg);
    expect(firstIds.length).toBeGreaterThan(0);
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
  });

  it('переписывает clip-path и все url(#...) резолвятся внутри результата', () => {
    const result = remapSvgIds(source, 'u3-');
    const ids = new Set(collectIds(result.svg));
    const refs = collectUrlRefs(result.svg);

    expect(result.svg).toContain('clip-path="url(#u3-clip0_21_25399)"');
    expect(result.svg).not.toContain('url(#clip0_21_25399)');
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ids.has(ref)).toBe(true);
    }
  });

  it('не падает на SVG без id и не меняет его', () => {
    const result = remapSvgIds(sourceWithoutIds, 'u4-');
    expect(result.idMap).toEqual({});
    expect(result.svg).toBe(sourceWithoutIds);
  });

  it('переписывает href/xlink:href на локальные id', () => {
    const svg = '<svg><defs><path id="shape" d="M0 0"/></defs><use href="#shape"/><use xlink:href="#shape"/></svg>';
    const result = remapSvgIds(svg, 'u5-');

    expect(result.svg).toContain('id="u5-shape"');
    expect(result.svg).toContain('href="#u5-shape"');
    expect(result.svg).toContain('xlink:href="#u5-shape"');
  });
});
