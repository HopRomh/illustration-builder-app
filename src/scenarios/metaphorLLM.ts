/**
 * Клиентская обёртка над POST /api/metaphor.
 *
 * Ключ и вызов LLM живут только на сервере. Клиент не знает, есть ли ключ:
 * health-check говорит об этом отдельно, а любая ошибка/таймаут означают
 * «остаёмся на локальном fallback».
 */

export interface LLMResponse {
  source: 'llm' | 'fallback';
  concepts?: string[];
  tags?: string[];
  mood?: string;
  focal?: string;
  error?: string;
}

const REQUEST_TIMEOUT_MS = 10_000;
const HEALTH_TIMEOUT_MS = 3_000;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isLLMResponse(value: unknown): value is LLMResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const record = value as Record<string, unknown>;
  if (record.source !== 'llm' && record.source !== 'fallback') return false;
  if (record.concepts !== undefined && !isStringArray(record.concepts)) return false;
  if (record.tags !== undefined && !isStringArray(record.tags)) return false;
  if (record.mood !== undefined && typeof record.mood !== 'string') return false;
  if (record.focal !== undefined && typeof record.focal !== 'string') return false;
  if (record.error !== undefined && typeof record.error !== 'string') return false;

  return true;
}

/** Семантическое улучшение через сервер. null — используем fallback. */
export async function requestLLM(text: string): Promise<LLMResponse | null> {
  try {
    const response = await fetch('/api/metaphor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const data: unknown = await response.json();
    return isLLMResponse(data) ? data : null;
  } catch {
    return null;
  }
}

/** Есть ли на сервере ключ и модель. Любая ошибка — false. */
export async function isLLMAvailable(): Promise<boolean> {
  try {
    const response = await fetch('/api/health', {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return false;

    const data: unknown = await response.json();
    return Boolean(
      data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        (data as { llm?: unknown }).llm === true,
    );
  } catch {
    return false;
  }
}
