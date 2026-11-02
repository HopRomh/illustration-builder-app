/**
 * Доставка библиотеки в прод.
 *
 * Vite копирует содержимое public/ в dist/ как есть, поэтому:
 *   public/assets/library/... -> dist/assets/library/...  (fetch по catalog.json)
 *   public/data/*.json        -> dist/data/*.json         (проверка доставки данных)
 *
 * Запускается после сборки каталога (`npm run catalog`), перед `npm run build`
 * (prebuild) и перед `npm run dev` (predev), чтобы dev и prod отдавали один и
 * тот же путь /assets/library/...
 */
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const librarySrc = path.join(rootDir, 'assets', 'library');
const libraryDest = path.join(rootDir, 'public', 'assets', 'library');
const dataSrc = path.join(rootDir, 'data');
const dataDest = path.join(rootDir, 'public', 'data');

function fail(message: string): never {
  console.error(`sync-library: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(librarySrc)) {
  fail('нет assets/library/. Сначала выполни `npm run catalog`.');
}

fs.rmSync(libraryDest, { recursive: true, force: true });
fs.mkdirSync(path.dirname(libraryDest), { recursive: true });
fs.cpSync(librarySrc, libraryDest, { recursive: true });

const dataFiles = ['catalog.json', 'palettes.json'];
for (const file of dataFiles) {
  const src = path.join(dataSrc, file);
  if (!fs.existsSync(src)) {
    fail(`нет data/${file}. Сначала выполни \`npm run catalog\`.`);
  }
}

fs.rmSync(dataDest, { recursive: true, force: true });
fs.mkdirSync(dataDest, { recursive: true });
for (const file of dataFiles) {
  fs.copyFileSync(path.join(dataSrc, file), path.join(dataDest, file));
}

const svgCount = (function count(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += count(path.join(dir, entry.name));
    else if (entry.name.toLowerCase().endsWith('.svg')) total += 1;
  }
  return total;
})(libraryDest);

console.log(`sync-library: ${svgCount} SVG -> public/assets/library/, ${dataFiles.length} JSON -> public/data/.`);
