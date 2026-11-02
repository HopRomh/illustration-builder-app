import { describe, expect, it } from 'vitest';
import { getSceneScale } from '../canvas/sizing';
import { catalog } from '../library/catalog';
import type { LibraryItem, Scene } from '../types';
import {
  SYNONYMS,
  buildFallbackPlans,
  composeFallbackPlan,
  scoreItems,
  tokenizeText,
} from './metaphorFallback';
import type { FallbackPlan, ScoredItem } from './metaphorFallback';

const scene: Scene = {
  format: '1:1',
  size: 'L',
  scheme: 'lilac',
  scale: 0.4,
};

function itemById(id: string): LibraryItem {
  const item = catalog.items.find((entry) => entry.id === id);
  if (!item) throw new Error(`Нет объекта ${id}`);
  return item;
}

describe('metaphorFallback: tokenizeText', () => {
  it('делит свободный текст по пробелам и пунктуации', () => {
    expect(
      tokenizeText('  Сложности в работе, которые решаются по шагам! '),
    ).toEqual(['сложности', 'работе', 'решаются', 'шагам']);
  });

  it('нормализует ё/е и регистр', () => {
    expect(tokenizeText('Ёлка, ёжик; учеба.')).toEqual([
      'елка',
      'ежик',
      'учеба',
    ]);
  });

  it('убирает стоп-слова, короткие токены и дубликаты', () => {
    expect(tokenizeText('для как что которые')).toEqual([]);
    expect(tokenizeText('я и он')).toEqual([]);
    expect(tokenizeText('книга книга КНИГА')).toEqual(['книга']);
  });

  it('возвращает пустой массив для пустого ввода', () => {
    expect(tokenizeText('')).toEqual([]);
    expect(tokenizeText('   ')).toEqual([]);
  });
});

describe('metaphorFallback: scoreItems', () => {
  it('находит объекты по синонимам и сортирует по score', () => {
    const scored = scoreItems(
      tokenizeText('сложности в работе, которые решаются по шагам'),
      catalog.items,
      SYNONYMS,
    );

    expect(scored.map((entry) => entry.item.id).slice(0, 3)).toEqual([
      'puzzle',
      'folder',
      'pen',
    ]);
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
  });

  it('находит опечатку через fuzzy', () => {
    const scored = scoreItems(['телефн'], catalog.items, SYNONYMS);

    expect(scored[0].item.id).toBe('phone');
    expect(scored[0].score).toBeGreaterThan(0);
  });

  it('делает tie-break по порядку объектов в каталоге', () => {
    const first: LibraryItem = {
      id: 'first',
      name: 'Первый',
      tags: ['общий'],
      variants: {},
    };
    const second: LibraryItem = {
      id: 'second',
      name: 'Второй',
      tags: ['общий'],
      variants: {},
    };

    const scored = scoreItems(['общий'], [first, second], {});

    expect(scored.map((entry) => entry.item.id)).toEqual(['first', 'second']);
  });

  it('отбрасывает объекты со score = 0', () => {
    expect(scoreItems(['абракадабра'], catalog.items, SYNONYMS)).toEqual([]);
  });

  it('возвращает уникальные matchedTags', () => {
    const scored = scoreItems(
      ['задача', 'пазлы', 'сборка'],
      catalog.items,
      SYNONYMS,
    );
    const puzzle = scored.find((entry) => entry.item.id === 'puzzle');

    expect(puzzle).toBeDefined();
    expect(new Set(puzzle?.matchedTags).size).toBe(puzzle?.matchedTags.length);
  });

  it('поднимает focal из LLM в начало, но не теряет остальные токены', () => {
    const scored = scoreItems(['книга'], catalog.items, SYNONYMS, 'лампа');

    expect(scored[0].item.id).toBe('lamp');
    expect(scored.some((entry) => entry.item.id === 'book')).toBe(true);
  });

  it('не мутирует входной массив объектов', () => {
    const items = [itemById('book'), itemById('phone')];
    const snapshot = [...items];

    scoreItems(['книга'], items, SYNONYMS);

    expect(items).toEqual(snapshot);
  });
});

describe('metaphorFallback: buildFallbackPlans', () => {
  const scored = scoreItems(
    tokenizeText('сложности в работе, которые решаются по шагам'),
    catalog.items,
    SYNONYMS,
  );

  it('строит три детерминированных плана на фразе приёмки', () => {
    const plans = buildFallbackPlans(scored, scene);

    expect(plans).toHaveLength(3);
    expect(plans.map((plan) => plan.label)).toEqual(['V1', 'V2', 'V3']);
    expect(plans.map((plan) => plan.items.map((item) => item.id))).toEqual([
      ['puzzle', 'folder', 'pen'],
      ['puzzle', 'pen', 'folder'],
      ['folder', 'pen', 'puzzle'],
    ]);
    expect(plans.every((plan) => plan.focusIndex === 0)).toBe(true);
  });

  it('детерминирован: повторный вызов даёт те же планы', () => {
    expect(buildFallbackPlans(scored, scene)).toEqual(
      buildFallbackPlans(scored, scene),
    );
  });

  it('возвращает меньше планов, если объектов мало', () => {
    expect(buildFallbackPlans(scored.slice(0, 2), scene)).toHaveLength(2);
    expect(buildFallbackPlans(scored.slice(0, 1), scene)).toHaveLength(1);
    expect(buildFallbackPlans([], scene)).toEqual([]);
  });
});

describe('metaphorFallback: composeFallbackPlan', () => {
  it('ставит фокус main последним, а support’ы — перед ним', () => {
    const plan: FallbackPlan = {
      items: [itemById('phone'), itemById('book')],
      focusIndex: 0,
      label: 'V1',
    };

    const composition = composeFallbackPlan(plan, scene);

    expect(composition.inputs.map((input) => input.itemId)).toEqual([
      'book',
      'phone',
    ]);
    expect(composition.inputs[composition.focusIndex]).toMatchObject({
      itemId: 'phone',
      variant: 'main',
    });
    expect(composition.previewScale).toBe(getSceneScale(scene));
  });

  it('фильтрует объекты с missingVariant', () => {
    const mainOnly: LibraryItem = {
      id: 'partial-main',
      name: 'Частичный',
      tags: ['частичный'],
      variants: {
        'main-L': { file: 'partial-main.svg', viewBox: [0, 0, 200, 200] },
      },
    };
    const plan: FallbackPlan = {
      items: [itemById('phone'), mainOnly],
      focusIndex: 0,
      label: 'V1',
    };

    const composition = composeFallbackPlan(plan, scene);

    expect(composition.inputs.map((input) => input.itemId)).toEqual(['phone']);
    expect(composition.focusIndex).toBe(0);
    expect(composition.inputs[0].variant).toBe('main');
  });

  it('возвращает пустую композицию для пустого плана', () => {
    const plan: FallbackPlan = {
      items: [],
      focusIndex: 0,
      label: 'V1',
    };

    expect(composeFallbackPlan(plan, scene)).toEqual({
      inputs: [],
      focusIndex: -1,
      previewScale: getSceneScale(scene),
    });
  });

  it('не мутирует план', () => {
    const items = [itemById('phone'), itemById('book')];
    const plan: FallbackPlan = { items, focusIndex: 0, label: 'V1' };
    const snapshot = [...items];

    composeFallbackPlan(plan, scene);

    expect(items).toEqual(snapshot);
    expect(plan.items).toBe(items);
  });
});

describe('metaphorFallback: типы', () => {
  it('ScoredItem содержит item, score и matchedTags', () => {
    const scored: ScoredItem[] = scoreItems(
      ['книга'],
      catalog.items,
      SYNONYMS,
    );

    expect(scored[0]).toMatchObject({
      item: expect.objectContaining({ id: 'book' }),
      score: expect.any(Number),
      matchedTags: expect.any(Array),
    });
  });
});
