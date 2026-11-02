import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestMetaphor } from './metaphor';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function chatResponse(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

beforeEach(() => {
  vi.stubEnv('LLM_API_KEY', 'test-key');
  vi.stubEnv('LLM_MODEL', 'test-model');
  vi.stubEnv('LLM_BASE_URL', 'https://llm.test/v1');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('server/metaphor: no key/model', () => {
  it('возвращает fallback no_key без ключа', async () => {
    vi.stubEnv('LLM_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await requestMetaphor('сложности')).toEqual({
      source: 'fallback',
      error: 'no_key',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('возвращает fallback no_key без модели', async () => {
    vi.stubEnv('LLM_MODEL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await requestMetaphor('сложности')).toEqual({
      source: 'fallback',
      error: 'no_key',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('server/metaphor: LLM-ответ', () => {
  it('возвращает source llm и семантические поля', async () => {
    const content = JSON.stringify({
      concepts: ['работа', 'шаги'],
      tags: ['задача', 'сборка'],
      mood: 'деловой',
      focal: 'пазлы',
    });
    const fetchMock = vi.fn().mockResolvedValue(chatResponse(content));
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestMetaphor('сложности в работе');

    expect(result).toEqual({
      source: 'llm',
      concepts: ['работа', 'шаги'],
      tags: ['задача', 'сборка'],
      mood: 'деловой',
      focal: 'пазлы',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://llm.test/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-key',
    );

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('test-model');
    expect(body.max_tokens).toBe(300);
    expect(body.messages[1]).toEqual({
      role: 'user',
      content: 'сложности в работе',
    });
    expect(body.messages[0].content).toContain('Пазлы');
  });

  it('срезает markdown-фенсы', async () => {
    const content =
      '```json\n{"concepts":["идея"],"tags":["лампа"],"mood":"яркий","focal":"лампа"}\n```';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(chatResponse(content)),
    );

    expect(await requestMetaphor('идея')).toEqual({
      source: 'llm',
      concepts: ['идея'],
      tags: ['лампа'],
      mood: 'яркий',
      focal: 'лампа',
    });
  });

  it('ограничивает вход 500 символами', async () => {
    const content = JSON.stringify({ tags: ['книга'] });
    const fetchMock = vi.fn().mockResolvedValue(chatResponse(content));
    vi.stubGlobal('fetch', fetchMock);

    await requestMetaphor('а'.repeat(700));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.messages[1].content).toHaveLength(500);
  });
});

describe('server/metaphor: ошибки', () => {
  it('возвращает fallback на HTTP-ошибку', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 401)),
    );

    expect(await requestMetaphor('сложности')).toEqual({
      source: 'fallback',
      error: 'http_401',
    });
  });

  it('возвращает fallback timeout на TimeoutError и AbortError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValue(
          new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
        ),
    );
    expect(await requestMetaphor('сложности')).toEqual({
      source: 'fallback',
      error: 'timeout',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')),
    );
    expect(await requestMetaphor('сложности')).toEqual({
      source: 'fallback',
      error: 'timeout',
    });
  });

  it('возвращает fallback parse на битый JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(chatResponse('это не JSON')),
    );

    expect(await requestMetaphor('сложности')).toEqual({
      source: 'fallback',
      error: 'parse',
    });
  });

  it('возвращает fallback parse на неверные типы', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        chatResponse(JSON.stringify({ tags: 'задача' })),
      ),
    );

    expect(await requestMetaphor('сложности')).toEqual({
      source: 'fallback',
      error: 'parse',
    });
  });

  it('возвращает fallback parse на пустой tags', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(chatResponse(JSON.stringify({ tags: [] }))),
    );

    expect(await requestMetaphor('сложности')).toEqual({
      source: 'fallback',
      error: 'parse',
    });
  });

  it('возвращает fallback parse, если content не строка', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ choices: [{ message: { content: 42 } }] }),
      ),
    );

    expect(await requestMetaphor('сложности')).toEqual({
      source: 'fallback',
      error: 'parse',
    });
  });

  it('возвращает fallback network на сетевую ошибку', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    );

    expect(await requestMetaphor('сложности')).toEqual({
      source: 'fallback',
      error: 'network',
    });
  });
});
