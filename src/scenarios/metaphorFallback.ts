import synonymsJson from '../../data/synonyms.json';
import { getSceneScale } from '../canvas/sizing';
import type { Instance } from '../state/store';
import type { LibraryItem, Scene } from '../types';
import { composeScenario } from './compose';
import { matchObject, normalize } from './matcher';
import type { Synonyms } from './matcher';

export const SYNONYMS = synonymsJson as Synonyms;

export interface ScoredItem {
  item: LibraryItem;
  score: number;
  matchedTags: string[];
}

export interface FallbackPlan {
  items: LibraryItem[];
  focusIndex: 0;
  label: 'V1' | 'V2' | 'V3';
}

export interface FallbackComposition {
  inputs: Array<Omit<Instance, 'uid' | 'scale'>>;
  focusIndex: number;
  previewScale: number;
}

const MIN_TOKEN_LENGTH = 3;
const FOCAL_BONUS = 250;

/** Служебные слова, которые не должны участвовать в скоринге. */
const STOP_WORDS = new Set([
  'а',
  'без',
  'бы',
  'был',
  'была',
  'были',
  'было',
  'быть',
  'в',
  'вам',
  'вас',
  'весь',
  'все',
  'вся',
  'вы',
  'где',
  'да',
  'для',
  'до',
  'его',
  'ее',
  'если',
  'есть',
  'же',
  'за',
  'зачем',
  'и',
  'из',
  'или',
  'им',
  'их',
  'к',
  'как',
  'кая',
  'когда',
  'которые',
  'который',
  'которая',
  'которое',
  'которых',
  'которым',
  'которыми',
  'кто',
  'ли',
  'между',
  'меня',
  'мы',
  'на',
  'над',
  'нам',
  'нас',
  'не',
  'ни',
  'но',
  'о',
  'об',
  'она',
  'они',
  'оно',
  'от',
  'по',
  'под',
  'при',
  'про',
  'с',
  'себя',
  'свой',
  'свои',
  'со',
  'так',
  'там',
  'те',
  'то',
  'тот',
  'тут',
  'ты',
  'у',
  'через',
  'чем',
  'что',
  'чтобы',
  'эта',
  'эти',
  'это',
  'этот',
  'я',
  'the',
  'and',
  'or',
  'for',
  'with',
  'that',
  'this',
  'from',
  'to',
  'of',
  'in',
  'on',
  'at',
  'by',
  'as',
  'is',
  'are',
  'be',
  'a',
  'an',
  'it',
  'its',
  'we',
  'you',
  'they',
  'he',
  'she',
  'i',
  'my',
  'our',
  'your',
  'their',
  'not',
  'no',
  'do',
  'does',
  'did',
  'can',
  'could',
  'should',
  'would',
  'will',
  'just',
  'very',
  'more',
  'most',
  'about',
]);

/**
 * Токенизатор свободного текста для Сценария 1.
 * Не путать с matcher.tokenize: тот делит только по запятым/;/переводу строки.
 */
export function tokenizeText(text: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const token of normalize(text).split(' ')) {
    if (!token || token.length < MIN_TOKEN_LENGTH) continue;
    if (STOP_WORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }

  return tokens;
}

/**
 * Считает релевантность каждого объекта.
 * Для каждого токена берётся лучший матч по этому объекту (matchObject с одним item),
 * поэтому один токен не может накрутить score несколькими тегами одного объекта.
 */
export function scoreItems(
  tokens: string[],
  items: LibraryItem[],
  synonyms: Synonyms = SYNONYMS,
  focal?: string,
): ScoredItem[] {
  const order = new Map(items.map((item, index) => [item.id, index]));
  const focalMatch = focal ? matchObject(focal, items, synonyms)[0] : undefined;
  // Случайный fuzzy-фокус не должен перетягивать композицию: принимаем
  // только прямое совпадение (название/тег/синоним).
  const focalItem =
    focalMatch && focalMatch.kind !== 'fuzzy' ? focalMatch.item : undefined;
  const scored: ScoredItem[] = [];

  for (const item of items) {
    let score = 0;
    const matchedTags = new Set<string>();

    for (const token of tokens) {
      const match = matchObject(token, [item], synonyms)[0];
      if (!match) continue;
      score += match.score;
      matchedTags.add(match.matchedTag);
    }

    if (focalItem?.id === item.id) {
      score += FOCAL_BONUS;
      matchedTags.add('focal');
    }

    if (score > 0) {
      scored.push({ item, score, matchedTags: [...matchedTags] });
    }
  }

  return scored.sort((a, b) => {
    // focal из LLM — подсказка фокуса V1; остальные объекты не отбрасываем.
    const aFocal = a.matchedTags.includes('focal') ? 1 : 0;
    const bFocal = b.matchedTags.includes('focal') ? 1 : 0;
    if (aFocal !== bFocal) return bFocal - aFocal;
    if (b.score !== a.score) return b.score - a.score;
    return (order.get(a.item.id) ?? 0) - (order.get(b.item.id) ?? 0);
  });
}

/**
 * Три детерминированных варианта. Различие — состав, порядок support'ов и фокус.
 * layoutComposition не получает пресетов: разный порядок сам меняет слоты и углы.
 */
export function buildFallbackPlans(scored: ScoredItem[], _scene: Scene): FallbackPlan[] {
  if (scored.length === 0) return [];

  const plans: FallbackPlan[] = [];
  const seen = new Set<string>();

  const addPlan = (
    label: FallbackPlan['label'],
    focusIndex: number,
    supportIndexes: number[],
  ) => {
    if (focusIndex < 0 || focusIndex >= scored.length) return;

    const indexes = [
      focusIndex,
      ...supportIndexes.filter(
        (index) => index >= 0 && index < scored.length && index !== focusIndex,
      ),
    ];
    const uniqueIndexes = [...new Set(indexes)];
    const items = uniqueIndexes.map((index) => scored[index].item);
    const key = items.map((item) => item.id).join(',');

    if (seen.has(key)) return;
    seen.add(key);
    plans.push({ items, focusIndex: 0, label });
  };

  // V1: top-1 + 2 support'а.
  addPlan('V1', 0, [1, 2]);
  // V2: top-1 + 3 support'а в другом порядке.
  addPlan('V2', 0, [2, 1, 3]);
  // V3: top-2 как фокус + другой порядок support'ов.
  addPlan('V3', 1, [2, 0, 3]);

  return plans;
}

/**
 * Превращает план в вход для setComposition.
 * composeScenario сам фильтрует missingVariant и переставляет фокус последним.
 */
export function composeFallbackPlan(plan: FallbackPlan, scene: Scene): FallbackComposition {
  const focus = plan.items[plan.focusIndex] ?? plan.items[0];

  if (!focus) {
    return { inputs: [], focusIndex: -1, previewScale: getSceneScale(scene) };
  }

  const ordered = [
    focus,
    ...plan.items.filter((_, index) => index !== plan.focusIndex),
  ];
  const composition = composeScenario(ordered, scene);

  return {
    inputs: composition.inputs,
    focusIndex: composition.focusIndex,
    previewScale: getSceneScale(scene),
  };
}
