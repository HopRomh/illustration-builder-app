import { describe, expect, it } from 'vitest';
import { catalog } from '../src/library/catalog';
import { normalize } from '../src/scenarios/matcher';
import synonymsJson from './synonyms.json';

const synonyms = synonymsJson as Record<string, string[]>;
const entries = Object.entries(synonyms);
const knownTerms = new Set(
  catalog.items
    .flatMap((item) => [item.name, ...item.tags])
    .map((term) => normalize(term)),
);

describe('data/synonyms.json', () => {
  it('ключи нормализованы: lowercase, ё → е, без пунктуации', () => {
    for (const [key] of entries) {
      expect(key.length, key).toBeGreaterThan(0);
      expect(key.trim(), key).toBe(key);
      expect(normalize(key), `ключ «${key}» должен быть нормализован`).toBe(key);
    }
  });

  it('значения — непустые существующие теги или названия каталога', () => {
    for (const [key, values] of entries) {
      expect(Array.isArray(values), key).toBe(true);
      expect(values.length, key).toBeGreaterThan(0);

      for (const value of values) {
        expect(value.trim(), `${key} → «${value}»`).toBe(value);
        expect(
          knownTerms.has(normalize(value)),
          `${key} → «${value}» нет в тегах/названиях каталога`,
        ).toBe(true);
      }
    }
  });

  it('покрывает фразу приёмки «сложности в работе, которые решаются по шагам»', () => {
    for (const token of ['сложности', 'работе', 'решаются', 'шагам']) {
      expect(synonyms[token], token).toBeDefined();
      expect(synonyms[token]?.length ?? 0, token).toBeGreaterThan(0);
    }
  });

  it('содержит 60–100 записей и покрывает каждый объект каталога', () => {
    expect(entries.length).toBeGreaterThanOrEqual(60);
    expect(entries.length).toBeLessThanOrEqual(100);

    const coveredTerms = new Set(
      Object.values(synonyms)
        .flat()
        .map((term) => normalize(term)),
    );

    for (const item of catalog.items) {
      const itemTerms = [item.name, ...item.tags].map((term) => normalize(term));
      expect(
        itemTerms.some((term) => coveredTerms.has(term)),
        `объект «${item.name}» не покрыт синонимами`,
      ).toBe(true);
    }
  });
});
