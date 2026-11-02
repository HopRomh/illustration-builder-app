import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLLMAvailable, requestLLM } from './metaphorLLM';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('metaphorLLM: requestLLM', () => {
  it('отправляет JSON с Content-Type application/json', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ source: 'llm', tags: ['задача'] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestLLM('сложности');

    expect(result).toEqual({ source: 'llm', tags: ['задача'] });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/metaphor');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    expect(JSON.parse(String(init.body))).toEqual({ text: 'сложности' });
  });

  it('возвращает null на HTTP-ошибку', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 500)),
    );

    expect(await requestLLM('сложности')).toBeNull();
  });

  it('возвращает null на таймаут', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValue(
          new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
        ),
    );

    expect(await requestLLM('сложности')).toBeNull();
  });

  it('возвращает null на битый JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('bad json');
        },
      } as unknown as Response),
    );

    expect(await requestLLM('сложности')).toBeNull();
  });

  it('возвращает null на неверную форму ответа', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ source: 'unknown' })),
    );

    expect(await requestLLM('сложности')).toBeNull();
  });

  it('принимает валидный ответ fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ source: 'fallback', error: 'no_key' }),
        ),
    );

    expect(await requestLLM('сложности')).toEqual({
      source: 'fallback',
      error: 'no_key',
    });
  });
});

describe('metaphorLLM: isLLMAvailable', () => {
  it('возвращает true, только если сервер сообщил llm: true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ ok: true, llm: true })),
    );

    expect(await isLLMAvailable()).toBe(true);
  });

  it('возвращает false для llm: false и ошибок', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ ok: true, llm: false })),
    );
    expect(await isLLMAvailable()).toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await isLLMAvailable()).toBe(false);
  });
});
