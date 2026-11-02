# Конструктор векторных иллюстраций

## Запуск

Требуется Node.js 22.12+ и npm.

```bash
npm install
```

Режим разработки (Vite):

```bash
npm run dev
```

Приложение откроется на `http://localhost:5173`.

Сборка и запуск Express-сервера, который раздаёт `dist/`:

```bash
npm run build
npm start
```

Сервер запустится на `http://localhost:3000` (порт можно переопределить переменной `PORT`). Проверка API:

```bash
curl http://localhost:3000/api/health
```

Остальные команды:

- `npm run catalog` — собирает `data/catalog.json`, `data/palettes.json`, `data/catalog-report.md` и нормализованные SVG в `assets/library/` из `assets/raw/` по `data/object-map.json`, затем копирует библиотеку и JSON в `public/` для dev/prod.
- `npm run sync-library` — копирует `assets/library/` в `public/assets/library/` и `data/*.json` в `public/data/`.
- `npm test` — запускает Vitest (тест ремапа SVG id).

## Структура проекта

```
.
├── .env.example
├── index.html
├── package.json
├── README.md
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── vite.config.ts
├── assets/
│   ├── raw/                     # исходные выгрузки из Figma (не изменяются)
│   └── library/                 # нормализованные SVG из assets/raw/
├── data/
│   ├── catalog.json             # каталог объектов и подложек
│   ├── palettes.json            # палитры схем
│   ├── catalog-report.md        # отчёт сборки каталога
│   └── synonyms.json            # синонимы для поиска по тегам
├── examples/                    # готовые композиции (примеры использования)
├── scripts/
│   └── build-catalog.ts         # сборка каталога и палитр
├── server/
│   ├── index.ts                 # Express: статика dist/ и GET /api/health
│   └── metaphor.ts              # LLM или fallback
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── types.ts
    ├── index.css
    ├── state/
    │   └── store.ts             # Zustand: сцена, выбор, история
    ├── canvas/
    │   ├── CanvasStage.tsx      # Fabric canvas 1080×1080
    │   ├── loadSvg.ts           # импорт SVG, ремап id, кеш
    │   ├── recolor.ts           # перекраска по ролям
    │   ├── layout.ts            # автолейаут и смена формата
    │   ├── history.ts           # undo/redo
    │   └── exportSvg.ts         # экспорт SVG
    ├── library/
    │   ├── LibraryPanel.tsx     # вкладки «Библиотека» и «Сценарии»
    │   └── ObjectCard.tsx
    ├── scenarios/
    │   ├── MetaphorScenario.tsx
    │   ├── ObjectsScenario.tsx
    │   └── matcher.ts           # подбор объектов по тегам или LLM
    └── panels/
        ├── Toolbar.tsx
        ├── PropertiesPanel.tsx
        └── LayersPanel.tsx
```
