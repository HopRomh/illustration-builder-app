import { describe, expect, it } from 'vitest';
import { catalog } from '../library/catalog';
import { matchObject, matchQuery, normalize, tokenize } from './matcher';

const items = catalog.items;

describe('matcher: normalize и tokenize', () => {
  it('приводит регистр, ё и пунктуацию', () => {
    expect(normalize('  УЧЁБА,  ')).toBe('учеба');
    expect(normalize('Кошелёк!')).toBe('кошелек');
    expect(normalize('книга... телефон')).toBe('книга телефон');
  });

  it('разбирает запятую, точку с запятой и перевод строки', () => {
    expect(tokenize('книга, телефон; лампа\n')).toEqual(['книга', 'телефон', 'лампа']);
    expect(tokenize(' , , ')).toEqual([]);
  });
});

describe('matcher: matchObject', () => {
  it('находит точное название', () => {
    const result = matchObject('книга', items);

    expect(result[0].item.id).toBe('book');
    expect(result[0].kind).toBe('name');
    expect(result[0].score).toBe(1000);
  });

  it('находит точный тег', () => {
    const result = matchObject('чтение', items);

    expect(result[0].item.id).toBe('book');
    expect(result[0].kind).toBe('tag');
    expect(result[0].matchedTag).toBe('чтение');
  });

  it('нормализует ё/е и регистр', () => {
    expect(matchObject('УЧЕБА', items)[0].item.id).toBe('book');
    expect(matchObject('кошелёк', items)[0].item.id).toBe('wallet');
  });

  it('возвращает несколько кандидатов на неоднозначный тег', () => {
    const result = matchObject('деньги', items);
    const ids = result.map((entry) => entry.item.id);

    expect(ids).toContain('wallet');
    expect(ids).toContain('coin');
    expect(result[0].score).toBe(result[1].score);
  });

  it('находит опечатку через fuzzy', () => {
    const result = matchObject('телефн', items);

    expect(result[0].item.id).toBe('phone');
    expect(result[0].kind).toBe('fuzzy');
  });

  it('находит близкое слово через fuzzy', () => {
    expect(matchObject('цветок', items)[0].item.id).toBe('tulips');
  });

  it('возвращает пустой массив для полной абракадабры', () => {
    expect(matchObject('абракадабра', items)).toEqual([]);
  });

  it('поддерживает опциональные синонимы (задел на этап 8)', () => {
    const result = matchObject('бабки', items, { бабки: ['деньги'] });
    const ids = result.map((entry) => entry.item.id);

    expect(ids).toContain('wallet');
    expect(ids).toContain('coin');
  });
});

describe('matcher: matchQuery', () => {
  it('разбирает три токена в три resolved-объекта', () => {
    const result = matchQuery(tokenize('книга, телефон, лампа'), items);

    expect(result.resolved.map((entry) => entry.item.id)).toEqual([
      'book',
      'phone',
      'lamp',
    ]);
    expect(result.ambiguous).toEqual([]);
    expect(result.notFound).toEqual([]);
  });

  it('возвращает ambiguous для «деньги»', () => {
    const result = matchQuery(['деньги'], items);

    expect(result.resolved).toEqual([]);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].candidates.map((entry) => entry.item.id)).toEqual([
      'wallet',
      'coin',
    ]);
  });

  it('возвращает notFound для неизвестного слова', () => {
    const result = matchQuery(['абракадабра'], items);

    expect(result.resolved).toEqual([]);
    expect(result.notFound).toEqual(['абракадабра']);
  });

  it('дедуплицирует «книга, книга» по itemId', () => {
    const result = matchQuery(tokenize('книга, книга'), items);

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].item.id).toBe('book');
  });

  it('не дублирует объект, если он встретился под разными токенами', () => {
    const result = matchQuery(tokenize('книга, чтение'), items);

    expect(result.resolved.map((entry) => entry.item.id)).toEqual(['book']);
  });

  it('fuzzy-опечатка попадает в resolved с kind=fuzzy', () => {
    const result = matchQuery(['телефн'], items);

    expect(result.resolved[0].item.id).toBe('phone');
    expect(result.resolved[0].kind).toBe('fuzzy');
  });
});
