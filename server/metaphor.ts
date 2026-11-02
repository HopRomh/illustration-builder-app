/**
 * Серверная семантика Сценария 1.
 *
 * Сервер только просит LLM вернуть смысловые теги/фокус. Каталог, раскладка
 * и fallback остаются на клиенте. Ключ и сырой ответ LLM не логируются.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface MetaphorResult {
  source: 'llm' | 'fallback';
  concepts?: string[];
  tags?: string[];
  mood?: string;
  focal?: string;
  error?: string;
}

interface CatalogItem {
  id: string;
  name: string;
  tags: string[];
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const MAX_INPUT_LENGTH = 500;
const MAX_OUTPUT_TOKENS = 300;
const REQUEST_TIMEOUT_MS = 8_000;

function readCatalogItems(): CatalogItem[] {
  try {
    const raw = readFileSync(resolve(process.cwd(), 'data/catalog.json'), 'utf8');
    const parsed = JSON.parse(raw) as { items?: unknown };
    if (!Array.isArray(parsed.items)) return [];

    return parsed.items
      .filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : '',
        name: typeof item.name === 'string' ? item.name : '',
        tags: Array.isArray(item.tags)
          ? item.tags.filter((tag): tag is string => typeof tag === 'string')
          : [],
      }))
      .filter((item) => item.id.length > 0 && item.name.length > 0);
  } catch {
    return [];
  }
}

function buildPrompt(): string {
  const items = readCatalogItems();
  const catalogText =
    items.length > 0
      ? items.map((item) => `- ${item.name}: ${item.tags.join(', ')}`).join('\n')
      : '- Каталог недоступен';

  return [
    'Ты помогаешь подобрать объекты для векторной иллюстрации по метафоре пользователя.',
    'Верни строго один JSON-объект без markdown и пояснений:',
    '{"concepts":["..."],"tags":["..."],"mood":"...","focal":"..."}',
    'concepts — 0–5 коротких смысловых концептов; tags — 1–8 тегов из каталога или близких по смыслу; mood — настроение; focal — один объект каталога, который должен быть главным.',
    'Каталог объектов:',
    catalogText,
  ].join('\n');
}

/** Срезает markdown-фенсы и вытаскивает первый JSON-объект. */
function extractJson(content: string): unknown {
  const withoutFences = content
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no_json');

  return JSON.parse(withoutFences.slice(start, end + 1));
}

function readStringArray(
  value: unknown,
  min: number,
  max: number,
): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length < min || value.length > max) return null;

  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
    const trimmed = entry.trim();
    if (!trimmed) return null;
    result.push(trimmed);
  }

  return result;
}

function readOptionalString(
  value: unknown,
  maxLength = 120,
): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

interface ValidatedPayload {
  concepts?: string[];
  tags: string[];
  mood?: string;
  focal?: string;
}

function validatePayload(payload: unknown): ValidatedPayload | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const tags = readStringArray(record.tags, 1, 8);
  if (!tags) return null;

  let concepts: string[] | undefined;
  if (record.concepts !== undefined) {
    const parsedConcepts = readStringArray(record.concepts, 0, 5);
    if (!parsedConcepts) return null;
    concepts = parsedConcepts;
  }

  const mood = readOptionalString(record.mood);
  if (mood === null) return null;

  const focal = readOptionalString(record.focal);
  if (focal === null) return null;

  return { concepts, tags, mood, focal };
}

export async function requestMetaphor(text: string): Promise<MetaphorResult> {
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!apiKey || !model) {
    return { source: 'fallback', error: 'no_key' };
  }

  const input = text.slice(0, MAX_INPUT_LENGTH);
  const baseURL = (process.env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/+$/,
    '',
  );

  try {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildPrompt() },
          { role: 'user', content: input },
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { source: 'fallback', error: `http_${response.status}` };
    }

    let payload: ChatCompletionResponse;
    try {
      payload = (await response.json()) as ChatCompletionResponse;
    } catch {
      return { source: 'fallback', error: 'parse' };
    }

    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return { source: 'fallback', error: 'parse' };
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = extractJson(content);
    } catch {
      return { source: 'fallback', error: 'parse' };
    }

    const parsed = validatePayload(parsedPayload);
    if (!parsed) {
      return { source: 'fallback', error: 'parse' };
    }

    return {
      source: 'llm',
      ...(parsed.concepts !== undefined ? { concepts: parsed.concepts } : {}),
      tags: parsed.tags,
      ...(parsed.mood !== undefined ? { mood: parsed.mood } : {}),
      ...(parsed.focal !== undefined ? { focal: parsed.focal } : {}),
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { source: 'fallback', error: 'timeout' };
    }
    return { source: 'fallback', error: 'network' };
  }
}
