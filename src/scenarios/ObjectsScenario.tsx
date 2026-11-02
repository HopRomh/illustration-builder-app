import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { catalog } from '../library/catalog';
import { useAppStore } from '../state/store';
import type { LibraryItem } from '../types';
import { composeScenario } from './compose';
import { matchObject, matchQuery, tokenize } from './matcher';
import type { MatchQueryResult, MatchResult } from './matcher';

interface PendingChoice {
  token: string;
  candidates: MatchResult[];
}

function mergeItems(base: LibraryItem[], extra: LibraryItem[]): LibraryItem[] {
  const result = [...base];
  const seen = new Set(result.map((item) => item.id));

  for (const item of extra) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }

  return result;
}

function describeMatch(match: MatchResult): string {
  switch (match.kind) {
    case 'name':
      return 'название';
    case 'tag':
      return `тег: ${match.matchedTag}`;
    case 'prefix':
      return `начинается с «${match.matchedTag}»`;
    case 'substring':
      return `содержит «${match.matchedTag}»`;
    case 'fuzzy':
      return `похоже на «${match.item.name}»`;
  }
}

export function ObjectsScenario() {
  const scene = useAppStore((state) => state.scene);
  const addMany = useAppStore((state) => state.addMany);

  const [input, setInput] = useState('');
  const [chips, setChips] = useState<LibraryItem[]>([]);
  const [pending, setPending] = useState<PendingChoice[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [navigated, setNavigated] = useState(false);
  const autoAssembleRef = useRef(false);
  const fieldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!suggestionsOpen) return;

    // Закрываем список после клика вне поля. Именно click, а не pointerdown:
    // иначе список схлопнется до mouseup и кнопка «Собрать» уедет из-под курсора.
    const handleDocumentClick = (event: MouseEvent) => {
      if (!fieldRef.current?.contains(event.target as Node)) {
        setSuggestionsOpen(false);
      }
    };

    document.addEventListener('click', handleDocumentClick);
    return () => document.removeEventListener('click', handleDocumentClick);
  }, [suggestionsOpen]);

  const suggestions = useMemo(() => {
    const query = input.trim();
    if (!query) return [];
    return matchObject(query, catalog.items).slice(0, 6);
  }, [input]);

  const showSuggestions =
    suggestionsOpen && input.trim().length > 0 && suggestions.length > 0;
  const safeActiveIndex = Math.min(activeIndex, Math.max(suggestions.length - 1, 0));
  const activeChoice = pending[0] ?? null;

  const addChips = (items: LibraryItem[]) => {
    if (items.length === 0) return;

    setChips((previous) => {
      const seen = new Set(previous.map((item) => item.id));
      const next = [...previous];

      for (const item of items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        next.push(item);
      }

      return next;
    });
  };

  const removeChip = (itemId: string) => {
    setChips((previous) => previous.filter((item) => item.id !== itemId));
    setMessage(null);
  };

  const commitTokens = (tokens: string[]) => {
    const clean = tokens.map((token) => token.trim()).filter(Boolean);
    if (clean.length === 0) return;

    const result: MatchQueryResult = matchQuery(clean, catalog.items);
    const ready = result.resolved.filter((match) => match.kind !== 'fuzzy');

    addChips(ready.map((match) => match.item));

    const choices: PendingChoice[] = [
      ...result.resolved
        .filter((match) => match.kind === 'fuzzy')
        .map((match) => ({ token: match.token, candidates: [match] })),
      ...result.ambiguous.map((entry) => ({
        token: entry.token,
        candidates: entry.candidates,
      })),
    ];

    if (choices.length > 0) {
      setPending((previous) => {
        const known = new Set(previous.map((choice) => choice.token));
        return [...previous, ...choices.filter((choice) => !known.has(choice.token))];
      });
    }

    if (result.notFound.length > 0) {
      setMessage(`Не найдено: ${result.notFound.join(', ')}`);
    } else if (choices.length === 0) {
      setMessage(null);
    }
  };

  const selectSuggestion = (item: LibraryItem) => {
    addChips([item]);
    setInput('');
    setSuggestionsOpen(false);
    setNavigated(false);
    setMessage(null);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;

    if (value.includes(',')) {
      const parts = value.split(',');
      const remainder = parts.pop() ?? '';
      const tokens = parts.flatMap((part) => tokenize(part));
      if (tokens.length > 0) commitTokens(tokens);
      setInput(remainder.replace(/^\s+/, ''));
    } else {
      setInput(value);
    }

    setActiveIndex(0);
    setSuggestionsOpen(true);
    setNavigated(false);
    setMessage(null);
    autoAssembleRef.current = false;
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setSuggestionsOpen(true);
      setNavigated(true);
      setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setSuggestionsOpen(true);
      setNavigated(true);
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }

    if (event.key === 'Escape') {
      setSuggestionsOpen(false);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();

      if (showSuggestions && navigated && suggestions[safeActiveIndex]) {
        selectSuggestion(suggestions[safeActiveIndex].item);
        return;
      }

      if (input.trim()) {
        commitTokens(tokenize(input));
        setInput('');
        setSuggestionsOpen(false);
        setNavigated(false);
      }
      return;
    }

    if (event.key === ',') {
      event.preventDefault();
      if (input.trim()) {
        commitTokens(tokenize(input));
        setInput('');
        setSuggestionsOpen(false);
        setNavigated(false);
      }
      return;
    }

    if (event.key === 'Backspace' && input.length === 0 && chips.length > 0) {
      event.preventDefault();
      removeChip(chips[chips.length - 1].id);
    }
  };

  const assembleItems = (items: LibraryItem[], note?: string) => {
    autoAssembleRef.current = false;
    const selected = mergeItems([], items);

    if (selected.length === 0) {
      setMessage(note ? `${note}. Добавьте хотя бы один объект` : 'Добавьте хотя бы один объект');
      return;
    }

    const composition = composeScenario(selected, scene);
    const skippedText = composition.skipped
      .map((entry) => `«${entry.name}» — нет варианта ${entry.variant}-${entry.size}`)
      .join(', ');
    const parts = [
      note,
      composition.inputs.length > 0 ? `Добавлено объектов: ${composition.inputs.length}` : '',
      skippedText ? `Пропущено: ${skippedText}` : '',
    ].filter(Boolean);

    setMessage(parts.join('. '));

    if (composition.inputs.length > 0) {
      addMany(composition.inputs, composition.focusIndex);
    }
  };

  const handleAssemble = () => {
    const inputTokens = tokenize(input);
    const result = matchQuery(inputTokens, catalog.items);
    const ready = result.resolved.filter((match) => match.kind !== 'fuzzy');
    const choices: PendingChoice[] = [
      ...result.resolved
        .filter((match) => match.kind === 'fuzzy')
        .map((match) => ({ token: match.token, candidates: [match] })),
      ...result.ambiguous.map((entry) => ({
        token: entry.token,
        candidates: entry.candidates,
      })),
    ];
    const note =
      result.notFound.length > 0 ? `Не найдено: ${result.notFound.join(', ')}` : undefined;

    if (inputTokens.length > 0) {
      addChips(ready.map((match) => match.item));
      setInput('');
      setSuggestionsOpen(false);
    }

    if (choices.length > 0) {
      setPending((previous) => {
        const known = new Set(previous.map((choice) => choice.token));
        return [...previous, ...choices.filter((choice) => !known.has(choice.token))];
      });
      autoAssembleRef.current = true;
      if (note) setMessage(note);
      return;
    }

    const selected = mergeItems(
      chips,
      ready.map((match) => match.item),
    );
    assembleItems(selected, note);
  };

  const resolvePending = (item: LibraryItem) => {
    const rest = pending.slice(1);
    addChips([item]);
    setPending(rest);
    setMessage(null);

    if (autoAssembleRef.current && rest.length === 0) {
      assembleItems(mergeItems(chips, [item]));
    }
  };

  const skipPending = () => {
    const rest = pending.slice(1);
    setPending(rest);

    if (autoAssembleRef.current && rest.length === 0) {
      assembleItems(chips);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">
          Сценарий 2: названия объектов
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Введите названия через запятую: «книга, телефон, лампа».
        </p>
      </div>

      <div className="relative" ref={fieldRef}>
        <input
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            setSuggestionsOpen(true);
            setNavigated(false);
          }}
          placeholder="книга, телефон, лампа"
          aria-label="Названия объектов"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
          aria-controls="scenario-suggestions"
          aria-activedescendant={
            showSuggestions ? `scenario-suggestion-${suggestions[safeActiveIndex]?.item.id}` : undefined
          }
          autoComplete="off"
          className="w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400"
        />

        {showSuggestions ? (
          <ul
            id="scenario-suggestions"
            role="listbox"
            className="mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg"
          >
            {suggestions.map((match, index) => (
              <li key={match.item.id}>
                <button
                  id={`scenario-suggestion-${match.item.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === safeActiveIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSuggestion(match.item)}
                  className={`flex w-full flex-col items-start px-2 py-1.5 text-left text-xs transition-colors ${
                    index === safeActiveIndex
                      ? 'bg-neutral-100 text-neutral-900'
                      : 'text-neutral-700 hover:bg-neutral-50'
                  }`}
                >
                  <span className="font-medium">{match.item.name}</span>
                  <span className="text-[10px] text-neutral-400">{describeMatch(match)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {chips.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700"
            >
              {item.name}
              <button
                type="button"
                aria-label={`Удалить «${item.name}»`}
                onClick={() => removeChip(item.id)}
                className="text-neutral-400 transition-colors hover:text-neutral-900"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {activeChoice ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          <p className="font-medium">
            {activeChoice.candidates.every((candidate) => candidate.kind === 'fuzzy')
              ? `Возможно, вы имели в виду «${activeChoice.token}»?`
              : `Уточните «${activeChoice.token}»:`}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {activeChoice.candidates.map((candidate) => (
              <button
                key={candidate.item.id}
                type="button"
                onClick={() => resolvePending(candidate.item)}
                className="rounded border border-amber-300 bg-white px-2 py-0.5 font-medium text-amber-900 transition-colors hover:bg-amber-100"
              >
                {candidate.item.name}
                {candidate.matchedTag !== candidate.item.name ? (
                  <span className="font-normal text-amber-700"> · {candidate.matchedTag}</span>
                ) : null}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={skipPending}
            className="mt-1 text-[10px] text-amber-700 underline transition-colors hover:text-amber-900"
          >
            Пропустить
          </button>
        </div>
      ) : null}

      {message ? (
        <p role="status" aria-live="polite" className="text-xs text-neutral-500">
          {message}
        </p>
      ) : null}

      <button
        type="button"
        onClick={handleAssemble}
        disabled={chips.length === 0 && input.trim().length === 0}
        className="w-full rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Собрать
      </button>
    </div>
  );
}
