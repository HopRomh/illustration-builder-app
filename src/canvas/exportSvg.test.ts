import { describe, expect, it } from 'vitest';
import type { TSVGExportOptions } from 'fabric';
import type { Scene } from '../types';
import { exportSvg, findForeignColors } from './exportSvg';
import type { ExportCanvas } from './exportSvg';
import { getPalette } from './recolor';

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    format: '1:1',
    size: 'L',
    scheme: 'mint',
    scale: 0.4,
    ...overrides,
  };
}

function canvasWith(svg: string, onOptions?: (options?: TSVGExportOptions) => void): ExportCanvas {
  return {
    toSVG(options) {
      onOptions?.(options);
      return svg;
    },
  };
}

const baseSvg =
  '<svg width="10" height="10" viewBox="0 0 10 10">' +
  '<defs><clipPath id="u1-clip0"><rect width="10" height="10"></rect></clipPath></defs>' +
  '<rect x="0" y="0" width="100%" height="100%" fill="#D7CDF5"></rect>' +
  '<g id="backdrop"><path fill="#BEEBEB" d="M0 0h10v10H0z"></path></g>' +
  '<g id="instance-1" transform="matrix(1 0 0 1 100 200)">' +
  '<path fill="#6D7BFC" clip-path="url(#u1-clip0)" d="M0 0h10v10H0z"></path>' +
  '</g>' +
  '</svg>';

describe('exportSvg: корневой документ', () => {
  it('ставит viewBox и width/height по формату сцены', () => {
    let received: TSVGExportOptions | undefined;
    const svg = exportSvg(
      canvasWith(baseSvg, (options) => {
        received = options;
      }),
      scene({ format: '3:4' }),
    );

    expect(received?.viewBox).toEqual({ x: 0, y: 0, width: 1080, height: 1440 });
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="1080"');
    expect(svg).toContain('height="1440"');
    expect(svg).toContain('viewBox="0 0 1080 1440"');
  });

  it('не зависит от зума: viewBox всегда оригинального размера', () => {
    const svg = exportSvg(canvasWith(baseSvg), scene({ format: '4:3' }));

    expect(svg).toContain('viewBox="0 0 1440 1080"');
  });
});

describe('exportSvg: чистота и структура', () => {
  it('удаляет <image>, <foreignObject> и растровые фильтры', () => {
    const dirty =
      '<svg width="10" height="10" viewBox="0 0 10 10"><defs>' +
      '<filter id="blur"><feGaussianBlur stdDeviation="2"/></filter>' +
      '</defs><rect x="0" y="0" width="100%" height="100%" fill="#BEEBEB"></rect>' +
      '<image href="data:image/png;base64,AAAA" width="10" height="10"></image>' +
      '<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>' +
      '<g id="instance-1"><path fill="#6D7BFC" filter="url(#blur)" d="M0 0h10v10H0z"></path></g>' +
      '</svg>';

    const svg = exportSvg(canvasWith(dirty), scene());

    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('<foreignObject');
    expect(svg).not.toContain('<filter');
    expect(svg).not.toContain('filter="url(#blur)"');
    expect(svg).toContain('<g id="instance-1">');
  });

  it('сохраняет группы объектов и ремапленные id клипов', () => {
    const svg = exportSvg(canvasWith(baseSvg), scene());

    expect(svg).toContain('<g id="backdrop">');
    expect(svg).toContain('<g id="instance-1"');
    expect(svg).toContain('id="u1-clip0"');
    expect(svg).toContain('clip-path="url(#u1-clip0)"');
  });

  it('ставит подложку bg-1 целевой схемы вместо цвета Fabric', () => {
    const svg = exportSvg(canvasWith(baseSvg), scene({ scheme: 'mint' }));

    expect(svg).toContain('fill="#BEEBEB"');
    expect(svg).not.toContain('fill="#D7CDF5"');
    expect(svg.indexOf('fill="#BEEBEB"')).toBeLessThan(svg.indexOf('<g id="instance-1"'));
  });

  it('заменяет фон Fabric 7 с явными width/height', () => {
    const explicit =
      '<svg width="1080" height="1080" viewBox="0 0 1080 1080"><defs></defs>' +
      '<rect x="0" y="0" width="1080" height="1080" fill="#D7CDF5"></rect>' +
      '<g id="instance-1"><path fill="#6D7BFC" d="M0 0h10v10H0z"></path></g></svg>';

    const svg = exportSvg(canvasWith(explicit), scene({ scheme: 'mint' }));

    expect(svg).toContain(
      '<rect x="0" y="0" width="1080" height="1080" fill="#BEEBEB"></rect>',
    );
    expect(svg).not.toContain('fill="#D7CDF5"');
  });

  it('удаляет filter из style, а не только из атрибута', () => {
    const dirty =
      '<svg width="10" height="10" viewBox="0 0 10 10"><defs></defs>' +
      '<rect x="0" y="0" width="100%" height="100%" fill="#BEEBEB"></rect>' +
      '<g id="instance-1"><path style="fill: #6D7BFC; filter: url(#blur);" d="M0 0h10v10H0z"></path></g>' +
      '</svg>';

    const svg = exportSvg(canvasWith(dirty), scene());

    expect(svg).not.toContain('filter:');
    expect(svg).toContain('style="fill: #6D7BFC"');
  });

  it('добавляет фон, если canvas.toSVG не вернул background rect', () => {
    const withoutRect =
      '<svg width="10" height="10" viewBox="0 0 10 10"><defs></defs>' +
      '<g id="instance-1"><path fill="#6D7BFC" d="M0 0h10v10H0z"></path></g></svg>';

    const svg = exportSvg(canvasWith(withoutRect), scene({ format: '3:4', scheme: 'peach' }));

    expect(svg).toContain(
      '<rect x="0" y="0" width="1080" height="1440" fill="#FDD7B9"></rect>',
    );
    expect(svg.indexOf('fill="#FDD7B9"')).toBeLessThan(svg.indexOf('<g id="instance-1"'));
  });
});

describe('exportSvg: проверка схемы', () => {
  it('находит цвета другой схемы и игнорирует url/none', () => {
    const foreign = findForeignColors(
      '<svg><path fill="#6D7BFC"/><path fill="#D7CDF5"/><path fill="url(#p)"/><path fill="none"/></svg>',
      getPalette('mint'),
    );

    expect(foreign).toEqual(['#D7CDF5']);
  });

  it('находит цвета в style, включая rgb()', () => {
    const foreign = findForeignColors(
      '<svg><path style="fill: rgb(1, 2, 3); stroke: #6D7BFC"/></svg>',
      getPalette('mint'),
    );

    expect(foreign).toEqual(['#010203']);
  });
});
