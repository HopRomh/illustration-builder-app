import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { REFERENCE_SCHEME } from '../canvas/recolor';
import { loadRecoloredSvg } from '../canvas/recolorSvg';
import { FORMATS } from '../canvas/sizing';
import { catalog } from '../library/catalog';
import { useAppStore } from '../state/store';
import type { Scene, SchemeId, Size, Variant } from '../types';
import {
  SYNONYMS,
  buildFallbackPlans,
  composeFallbackPlan,
  scoreItems,
  tokenizeText,
} from './metaphorFallback';
import type { FallbackComposition, FallbackPlan } from './metaphorFallback';
import { isLLMAvailable, requestLLM } from './metaphorLLM';
import type { LLMResponse } from './metaphorLLM';

interface PreviewVariant {
  plan: FallbackPlan;
  composition: FallbackComposition;
}

function variantKey(variant: Variant, size: Size): `${Variant}-${Size}` {
  return `${variant}-${size}`;
}

/**
 * Fallback считается сразу. LLM-теги добавляются к исходным токенам,
 * focal становится подсказкой фокуса; если LLM-теги ничего не дали,
 * остаются исходные токены.
 */
function buildPreviews(
  text: string,
  scene: Scene,
  llm?: LLMResponse,
): PreviewVariant[] {
  const baseTokens = tokenizeText(text);
  const llmTokens = llm?.tags?.length ? tokenizeText(llm.tags.join(' ')) : [];
  const tokens = [...new Set([...baseTokens, ...llmTokens])];

  let scored = scoreItems(tokens, catalog.items, SYNONYMS, llm?.focal);
  if (scored.length === 0 && llmTokens.length > 0) {
    scored = scoreItems(baseTokens, catalog.items, SYNONYMS, llm?.focal);
  }

  return buildFallbackPlans(scored, scene)
    .map((plan) => ({
      plan,
      composition: composeFallbackPlan(plan, scene),
    }))
    .filter((entry) => entry.composition.inputs.length > 0);
}

/**
 * Превью-объект всегда в lilac, поэтому для peach/mint перекрашиваем SVG
 * и отдаём его как data-URL. Пока идёт загрузка, объект не рисуем —
 * иначе на долю секунды вспыхнул бы неверный цвет.
 */
function useVariantHref(file: string, scheme: SchemeId): string | null {
  const [href, setHref] = useState<string | null>(() =>
    scheme === REFERENCE_SCHEME ? encodeURI(file) : null,
  );

  useEffect(() => {
    let cancelled = false;

    if (scheme === REFERENCE_SCHEME) {
      setHref(encodeURI(file));
      return () => {
        cancelled = true;
      };
    }

    setHref(null);
    void loadRecoloredSvg(file, scheme)
      .then((dataUrl) => {
        if (!cancelled) setHref(dataUrl);
      })
      .catch((error: unknown) => {
        console.error('MetaphorScenario: не удалось перекрасить превью', error);
        if (!cancelled) setHref(encodeURI(file));
      });

    return () => {
      cancelled = true;
    };
  }, [file, scheme]);

  return href;
}

interface PreviewObjectProps {
  file: string;
  scheme: SchemeId;
  x: number;
  y: number;
  angle: number;
  width: number;
  height: number;
}

function PreviewObject({
  file,
  scheme,
  x,
  y,
  angle,
  width,
  height,
}: PreviewObjectProps) {
  const href = useVariantHref(file, scheme);
  if (!href) return null;

  return (
    <image
      href={href}
      x={-width / 2}
      y={-height / 2}
      width={width}
      height={height}
      transform={`translate(${x} ${y}) rotate(${angle})`}
    />
  );
}

interface PreviewCardProps {
  preview: PreviewVariant;
  scene: Scene;
  onOpen: () => void;
}

function PreviewCard({ preview, scene, onOpen }: PreviewCardProps) {
  const { width, height } = FORMATS[scene.format];
  const backdrop = catalog.backdrops.find(
    (item) => item.scheme === scene.scheme && item.size === scene.size,
  );
  const names = preview.plan.items.map((item) => item.name).join(' + ');

  return (
    <div className="rounded-md border border-neutral-200 bg-white p-2">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-neutral-900">
          Вариант {preview.plan.label}
        </span>
        <span className="truncate text-[10px] text-neutral-500">{names}</span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full rounded border border-neutral-100 bg-neutral-100"
        role="img"
        aria-label={`Вариант ${preview.plan.label}: ${names}`}
      >
        {backdrop ? (
          <image
            href={encodeURI(backdrop.file)}
            x={0}
            y={0}
            width={width}
            height={height}
            preserveAspectRatio="xMidYMid slice"
          />
        ) : (
          <rect width={width} height={height} fill="#f4f4f5" />
        )}

        {preview.composition.inputs.map((input, index) => {
          const item = catalog.items.find((entry) => entry.id === input.itemId);
          const variant = item?.variants[variantKey(input.variant, input.size)];
          if (!variant) return null;

          const objectWidth =
            variant.viewBox[2] * preview.composition.previewScale;
          const objectHeight =
            variant.viewBox[3] * preview.composition.previewScale;

          return (
            <PreviewObject
              key={`${input.itemId}-${index}`}
              file={variant.file}
              scheme={scene.scheme}
              x={input.x}
              y={input.y}
              angle={input.angle}
              width={objectWidth}
              height={objectHeight}
            />
          );
        })}
      </svg>

      <button
        type="button"
        onClick={onOpen}
        className="mt-2 w-full rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-700"
      >
        Открыть на холсте
      </button>
    </div>
  );
}

export function MetaphorScenario() {
  const scene = useAppStore((state) => state.scene);
  const setComposition = useAppStore((state) => state.setComposition);

  const [input, setInput] = useState('');
  const [previews, setPreviews] = useState<PreviewVariant[]>([]);
  const [source, setSource] = useState<'llm' | 'fallback' | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const runIdRef = useRef(0);
  const openedRef = useRef(false);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    setMessage(null);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const text = input.trim();
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    openedRef.current = false;

    if (!text) {
      setLoading(false);
      setPreviews([]);
      setSource(null);
      setNote(null);
      setMessage('Введите метафору или описание.');
      return;
    }

    setLoading(true);
    setMessage(null);
    setNote(null);

    // Fallback — основной путь: показываем сразу, LLM не ждём.
    const fallback = buildPreviews(text, scene);
    setPreviews(fallback);
    setSource(fallback.length > 0 ? 'fallback' : null);
    if (fallback.length === 0) {
      setMessage(
        'Не удалось подобрать объекты. Попробуйте: работа, шаги, книга, телефон.',
      );
    }

    void (async () => {
      const available = await isLLMAvailable();
      if (runId !== runIdRef.current) return;

      if (!available) {
        setLoading(false);
        return;
      }

      const response = await requestLLM(text);
      if (runId !== runIdRef.current) return;

      if (!response || response.source !== 'llm' || !response.tags?.length) {
        setLoading(false);
        if (response?.error && response.error !== 'no_key') {
          setNote('LLM недоступен — показан fallback.');
        }
        return;
      }

      // Поздний ответ не заменяет вариант, который пользователь уже открыл.
      if (openedRef.current) {
        setLoading(false);
        return;
      }

      const refined = buildPreviews(text, scene, response);
      if (refined.length > 0) {
        setPreviews(refined);
        setSource('llm');
        setMessage(null);
      } else {
        setNote('LLM не дал результатов — показан fallback.');
      }
      setLoading(false);
    })();
  };

  const openVariant = (preview: PreviewVariant) => {
    if (preview.composition.inputs.length === 0) return;

    openedRef.current = true;
    setComposition(preview.composition.inputs, preview.composition.focusIndex);
    setNote('Композиция открыта на холсте. Один Ctrl+Z вернёт предыдущую.');
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">
          Сценарий 1: метафора
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Опишите идею словами — сервис предложит три композиции.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <textarea
          value={input}
          onChange={handleChange}
          rows={3}
          maxLength={500}
          placeholder="сложности в работе, которые решаются по шагам"
          aria-label="Метафора"
          className="w-full resize-none rounded-md border border-neutral-200 px-2 py-1.5 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400"
        />

        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-neutral-400">
            {input.trim().length}/500
          </span>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Собираю…
              </>
            ) : (
              'Собрать'
            )}
          </button>
        </div>
      </form>

      {message ? (
        <p role="status" aria-live="polite" className="text-xs text-neutral-500">
          {message}
        </p>
      ) : null}

      {previews.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                source === 'llm'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-neutral-200 text-neutral-700'
              }`}
            >
              {source === 'llm' ? 'LLM' : 'fallback'}
            </span>
            <span className="text-[10px] text-neutral-500">
              Вариантов: {previews.length}
            </span>
            {loading ? (
              <span className="text-[10px] text-neutral-500">
                Уточняю через LLM…
              </span>
            ) : null}
          </div>

          {previews.map((preview) => (
            <PreviewCard
              key={preview.plan.label}
              preview={preview}
              scene={scene}
              onOpen={() => openVariant(preview)}
            />
          ))}
        </div>
      ) : null}

      {note ? (
        <p role="status" aria-live="polite" className="text-xs text-neutral-500">
          {note}
        </p>
      ) : null}
    </div>
  );
}
