import { describe, expect, it } from 'vitest';
import type { FabricObject } from 'fabric';
import { applyScheme, classifyRole, getPalette, normalizeColor, tagRoles } from './recolor';

interface MockObject {
  fill: string | null;
  stroke: string | null;
  dirty: boolean;
  children: MockObject[];
  getObjects(): MockObject[];
  set(key: string | Record<string, unknown>, value?: unknown): MockObject;
}

function mockObject(fill: string | null, children: MockObject[] = []): MockObject {
  const object: MockObject = {
    fill,
    stroke: null,
    dirty: false,
    children,
    getObjects: () => object.children,
    set: (key, value) => {
      if (typeof key === 'string') {
        (object as unknown as Record<string, unknown>)[key] = value;
      } else {
        Object.assign(object, key);
      }
      return object;
    },
  };
  return object;
}

function asFabric(object: MockObject): FabricObject {
  return object as unknown as FabricObject;
}

const lilac = getPalette('lilac');

describe('recolor: classifyRole', () => {
  it('определяет роли референсной lilac-палитры', () => {
    expect(classifyRole('#F9A3AA', lilac)).toBe('obj-2');
    expect(classifyRole('#F9ECB0', lilac)).toBe('obj-1');
    expect(classifyRole('#FFE3E1', lilac)).toBe('obj-3');
    expect(classifyRole('#D7CDF5', lilac)).toBe('bg-1');
    expect(classifyRole('#7864D7', lilac)).toBe('bg-3');
  });

  it('понимает fill="white" и #FFFFFF как obj-white', () => {
    expect(classifyRole('white', lilac)).toBe('obj-white');
    expect(classifyRole('WHITE', lilac)).toBe('obj-white');
    expect(classifyRole('#FFFFFF', lilac)).toBe('obj-white');
    expect(classifyRole('#fff', lilac)).toBe('obj-white');
  });

  it('понимает bg-black #181817', () => {
    expect(classifyRole('#181817', lilac)).toBe('bg-black');
    expect(classifyRole('#181817'.toLowerCase(), lilac)).toBe('bg-black');
  });

  it('нормализует регистр HEX', () => {
    expect(normalizeColor('#f9a3aa')).toBe('#F9A3AA');
    expect(classifyRole('#f9a3aa', lilac)).toBe('obj-2');
  });

  it('нормализует rgb()/rgba() из style Fabric', () => {
    expect(normalizeColor('rgb(249, 163, 170)')).toBe('#F9A3AA');
    expect(normalizeColor('rgba(24, 24, 23, 0.5)')).toBe('#181817');
    expect(normalizeColor('rgb(249 163 170 / 50%)')).toBe('#F9A3AA');
  });

  it('возвращает null для цветов вне палитры и не-цветов', () => {
    expect(classifyRole('#000000', lilac)).toBeNull();
    expect(classifyRole('none', lilac)).toBeNull();
    expect(classifyRole('url(#gradient)', lilac)).toBeNull();
    expect(classifyRole(null, lilac)).toBeNull();
    expect(classifyRole('', lilac)).toBeNull();
  });

  it('роль зависит от палитры: #80DADA — peach:obj-2 и mint:bg-2', () => {
    expect(classifyRole('#80DADA', getPalette('peach'))).toBe('obj-2');
    expect(classifyRole('#80DADA', getPalette('mint'))).toBe('bg-2');
  });
});

describe('recolor: tagRoles и applyScheme', () => {
  it('перекрашивает вложенные объекты по сохранённым ролям', () => {
    const obj1 = mockObject('#F9ECB0');
    const obj2 = mockObject('#F9A3AA');
    const white = mockObject('white');
    const black = mockObject('#181817');
    const nested = mockObject(null, [obj2, white]);
    const group = mockObject(null, [obj1, nested, black]);

    tagRoles(asFabric(group));
    applyScheme(asFabric(group), 'mint');

    expect(obj1.fill).toBe('#FFD4F2');
    expect(obj2.fill).toBe('#6D7BFC');
    expect(white.fill).toBe('#FFFFFF');
    expect(black.fill).toBe('#181817');
  });

  it('возвращает цвета при обратной смене схемы', () => {
    const obj = mockObject('#F9A3AA');
    const group = mockObject(null, [obj]);

    tagRoles(asFabric(group));
    applyScheme(asFabric(group), 'peach');
    expect(obj.fill).toBe('#80DADA');

    applyScheme(asFabric(group), 'lilac');
    expect(obj.fill).toBe('#F9A3AA');
  });

  it('не трогает объекты без роли и url-заливки', () => {
    const unknown = mockObject('#123456');
    const gradient = mockObject('url(#paint0)');
    const group = mockObject(null, [unknown, gradient]);

    tagRoles(asFabric(group));
    applyScheme(asFabric(group), 'peach');

    expect(unknown.fill).toBe('#123456');
    expect(gradient.fill).toBe('url(#paint0)');
  });

  it('помечает объекты dirty для перерисовки Fabric', () => {
    const obj = mockObject('#F9A3AA');
    const group = mockObject(null, [obj]);

    tagRoles(asFabric(group));
    applyScheme(asFabric(group), 'peach');

    expect(obj.dirty).toBe(true);
    expect(group.dirty).toBe(true);
  });
});
