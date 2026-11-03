import { describe, expect, it } from 'vitest';
import { getPalette } from './recolor';
import { recolorSvgDataUrl, recolorSvgMarkup } from './recolorSvg';

const source = [
  '<svg xmlns="http://www.w3.org/2000/svg">',
  '<path fill="#F9A3AA" stroke="#7864D7" d="M0 0"/>',
  '<path fill="#123456" d="M1 1"/>',
  '</svg>',
].join('');

describe('recolorSvg: recolorSvgMarkup', () => {
  it('заменяет цвета референсной схемы на целевую', () => {
    const peach = recolorSvgMarkup(source, 'peach');

    expect(peach).toContain('fill="#80DADA"'); // peach:obj-2
    expect(peach).toContain('stroke="#D27532"'); // peach:bg-3
    expect(peach).not.toContain('#F9A3AA');
    expect(peach).not.toContain('#7864D7');
  });

  it('не трогает цвета вне палитры', () => {
    expect(recolorSvgMarkup(source, 'mint')).toContain('fill="#123456"');
  });

  it('возвращает исходный SVG для референсной схемы', () => {
    expect(recolorSvgMarkup(source, 'lilac')).toBe(source);
  });

  it('строит корректный data-URL', () => {
    const url = recolorSvgDataUrl(source, 'mint');

    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(url.split(',')[1])).toContain(
      getPalette('mint').colors['obj-2'],
    );
  });
});
