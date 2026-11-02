import type { LibraryItem } from '../types';

export type MatchKind = 'name' | 'tag' | 'prefix' | 'substring' | 'fuzzy';

export interface MatchResult {
  item: LibraryItem;
  score: number;
  /** Название или тег, по которому сработало совпадение. */
  matchedTag: string;
  kind: MatchKind;
  /** Нормализованный токен запроса, по которому найден кандидат. */
  token: string;
}

export interface AmbiguousMatch {
  token: string;
  candidates: MatchResult[];
}

export interface MatchQueryResult {
  resolved: MatchResult[];
  ambiguous: AmbiguousMatch[];
  notFound: string[];
}

/** Задел на этап 8: fallback Сценария 1. */
export type Synonyms = Record<string, string[]>;

const SCORE = {
  nameExact: 1000,
  tagExact: 900,
  namePrefix: 800,
  tagPrefix: 700,
  nameSubstring: 600,
  tagSubstring: 500,
  fuzzyBase: 350,
  synonymPenalty: 50,
} as const;

/** lowercase, ё → е, пунктуация → пробел, схлопывание пробелов. */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** «книга, телефон, лампа» → ['книга', 'телефон', 'лампа']. */
export function tokenize(query: string): string[] {
  return query
    .split(/[,;\n]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function startsWord(text: string, term: string): boolean {
  return text.split(' ').some((word) => word.length > 0 && word.startsWith(term));
}

function synonymAliases(token: string, synonyms?: Synonyms): string[] {
  if (!synonyms) return [];

  const direct = synonyms[token];
  if (!direct) return [];

  return direct.map(normalize).filter(Boolean);
}

function evaluate(
  item: LibraryItem,
  term: string,
  token: string,
  synonym: boolean,
): MatchResult | null {
  let best: MatchResult | null = null;

  const consider = (score: number, matchedTag: string, kind: MatchKind) => {
    const adjusted = score - (synonym ? SCORE.synonymPenalty : 0);
    if (!best || adjusted > best.score) {
      best = { item, score: adjusted, matchedTag, kind, token };
    }
  };

  const name = normalize(item.name);

  if (name === term) consider(SCORE.nameExact, item.name, 'name');
  else if (name.startsWith(term)) consider(SCORE.namePrefix, item.name, 'prefix');
  else if (startsWord(name, term)) consider(SCORE.nameSubstring, item.name, 'substring');

  for (const tag of item.tags) {
    const normalizedTag = normalize(tag);
    if (!normalizedTag) continue;

    if (normalizedTag === term) consider(SCORE.tagExact, tag, 'tag');
    else if (normalizedTag.startsWith(term)) consider(SCORE.tagPrefix, tag, 'prefix');
    else if (startsWord(normalizedTag, term)) consider(SCORE.tagSubstring, tag, 'substring');
  }

  return best;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  return previous[b.length];
}

function fuzzyCandidates(token: string, items: LibraryItem[]): MatchResult[] {
  const term = normalize(token);
  if (!term) return [];

  const maxDistance = term.length <= 4 ? 1 : 2;
  const results: MatchResult[] = [];

  for (const item of items) {
    const candidates = [
      { value: normalize(item.name), original: item.name, kind: 'name' as const },
      ...item.tags.map((tag) => ({
        value: normalize(tag),
        original: tag,
        kind: 'tag' as const,
      })),
    ];

    let best: { distance: number; matchedTag: string; kind: 'name' | 'tag' } | null = null;

    for (const candidate of candidates) {
      if (!candidate.value) continue;
      if (Math.abs(candidate.value.length - term.length) > maxDistance) continue;

      const distance = levenshtein(term, candidate.value);
      if (distance === 0 || distance > maxDistance) continue;
      if (!best || distance < best.distance) {
        best = { distance, matchedTag: candidate.original, kind: candidate.kind };
      }
    }

    if (best) {
      results.push({
        item,
        score: Math.max(100, SCORE.fuzzyBase - best.distance * 100),
        matchedTag: best.matchedTag,
        kind: 'fuzzy',
        token,
      });
    }
  }

  return results.sort(compareMatches);
}

function compareMatches(a: MatchResult, b: MatchResult): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.item.name.localeCompare(b.item.name, 'ru');
}

/**
 * Возвращает всех кандидатов по одному токену, а не одного победителя:
 * решение об однозначности принимает matchQuery/UI.
 */
export function matchObject(
  token: string,
  items: LibraryItem[],
  synonyms?: Synonyms,
): MatchResult[] {
  const normalized = normalize(token);
  if (!normalized) return [];

  const aliases = synonymAliases(normalized, synonyms).filter((alias) => alias !== normalized);
  const terms = [normalized, ...aliases];
  const byItem = new Map<string, MatchResult>();

  for (const item of items) {
    let best: MatchResult | null = null;

    for (const term of terms) {
      const result = evaluate(item, term, normalized, term !== normalized);
      if (result && (!best || result.score > best.score)) best = result;
    }

    if (best) byItem.set(item.id, best);
  }

  const results = [...byItem.values()];
  if (results.length > 0) return results.sort(compareMatches);

  return fuzzyCandidates(normalized, items);
}

/**
 * Разбирает запрос на resolved/ambiguous/notFound.
 * Дедупликация — по itemId, порядок resolved — порядок токенов.
 */
export function matchQuery(
  tokens: string[],
  items: LibraryItem[],
  synonyms?: Synonyms,
): MatchQueryResult {
  const resolved: MatchResult[] = [];
  const ambiguous: AmbiguousMatch[] = [];
  const notFound: string[] = [];
  const seenTokens = new Set<string>();
  const seenItems = new Set<string>();

  for (const raw of tokens) {
    const token = normalize(raw);
    if (!token || seenTokens.has(token)) continue;
    seenTokens.add(token);

    const results = matchObject(raw, items, synonyms);

    if (results.length === 0) {
      notFound.push(raw.trim());
      continue;
    }

    const topScore = results[0].score;
    const top = results.filter((result) => result.score === topScore);

    if (top.length > 1) {
      ambiguous.push({ token: raw.trim(), candidates: top.slice(0, 5) });
      continue;
    }

    const winner = top[0];
    if (!seenItems.has(winner.item.id)) {
      resolved.push(winner);
      seenItems.add(winner.item.id);
    }
  }

  return { resolved, ambiguous, notFound };
}
