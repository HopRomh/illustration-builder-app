import { describe, expect, it } from 'vitest';
import type { Palette } from './build-catalog';
import { classifyBackdropColor } from './build-catalog';

const palette: Palette = {
  scheme: 'lilac',
  colors: {
    'bg-1': '#D7CDF5',
    'bg-2': '#AA9BF0',
    'bg-3': '#7864D7',
    'bg-black': '#181817',
    'obj-1': '#F9ECB0',
    'obj-2': '#F9A3AA',
    'obj-3': '#FFE3E1',
    'obj-white': '#FFFFFF',
  },
};

const objectColors = new Set(Object.values(palette.colors).slice(4));

describe('build-catalog: classifyBackdropColor', () => {
  it('распознаёт bg-роли схемы', () => {
    expect(classifyBackdropColor('#D7CDF5', palette, objectColors)).toBe('bg-1');
    expect(classifyBackdropColor('#AA9BF0', palette, objectColors)).toBe('bg-2');
    expect(classifyBackdropColor('#7864D7', palette, objectColors)).toBe('bg-3');
    expect(classifyBackdropColor('#181817', palette, objectColors)).toBe('bg-black');
  });

  it('считает #FFFFFF нейтральным, а не цветом объекта', () => {
    expect(classifyBackdropColor('#FFFFFF', palette, objectColors)).toBe('neutral-white');
  });

  it('находит цвета объектов, которые нужно предупредить', () => {
    expect(classifyBackdropColor('#F9ECB0', palette, objectColors)).toBe('obj-*');
    expect(classifyBackdropColor('#F9A3AA', palette, objectColors)).toBe('obj-*');
    expect(classifyBackdropColor('#FFE3E1', palette, objectColors)).toBe('obj-*');
  });

  it('возвращает «вне палитр» для незнакомого цвета', () => {
    expect(classifyBackdropColor('#123456', palette, objectColors)).toBe('вне палитр');
  });
});
