import { describe, expect, it } from 'vitest';
import { matchesShortcut } from './useHotkeys';

describe('matchesShortcut', () => {
  it('распознаёт латинскую клавишу', () => {
    expect(matchesShortcut({ key: 'z', code: 'KeyZ' }, 'z', 'KeyZ', 'я')).toBe(true);
    expect(matchesShortcut({ key: 'Z', code: 'KeyZ' }, 'z', 'KeyZ', 'я')).toBe(true);
  });

  it('распознаёт русскую раскладку по key и по code', () => {
    expect(matchesShortcut({ key: 'я', code: 'KeyZ' }, 'z', 'KeyZ', 'я')).toBe(true);
    expect(matchesShortcut({ key: 'Я', code: 'KeyZ' }, 'z', 'KeyZ', 'я')).toBe(true);
    expect(matchesShortcut({ key: 'в', code: 'KeyD' }, 'd', 'KeyD', 'в')).toBe(true);
  });

  it('распознаёт клавишу по code, даже если key не совпал', () => {
    expect(matchesShortcut({ key: 'unknown', code: 'KeyZ' }, 'z', 'KeyZ', 'я')).toBe(true);
    expect(matchesShortcut({ key: 'unknown', code: 'KeyD' }, 'd', 'KeyD', 'в')).toBe(true);
  });

  it('не срабатывает на чужие клавиши', () => {
    expect(matchesShortcut({ key: 'x', code: 'KeyX' }, 'z', 'KeyZ', 'я')).toBe(false);
    expect(matchesShortcut({ key: 'ч', code: 'KeyX' }, 'd', 'KeyD', 'в')).toBe(false);
  });
});
