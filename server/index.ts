import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestMetaphor } from './metaphor';

// .env не обязателен: в проде переменные может задать окружение.
try {
  process.loadEnvFile();
} catch {
  // Файла нет или Node не умеет loadEnvFile — работаем с текущим process.env.
}

const app = express();
const port = Number(process.env.PORT ?? 3000);
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    llm: Boolean(process.env.LLM_API_KEY && process.env.LLM_MODEL),
  });
});

app.post('/api/metaphor', async (req, res) => {
  const rawText = req.body?.text;
  const text = typeof rawText === 'string' ? rawText.trim() : '';

  if (!text || text.length > 500) {
    res.status(400).json({ error: 'bad_request' });
    return;
  }

  try {
    const result = await requestMetaphor(text);
    res.json(result);
  } catch {
    // requestMetaphor уже ловит свои ошибки; это страховка от неожиданного.
    res.json({ source: 'fallback', error: 'server' });
  }
});

app.use(express.static(distDir));

app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    next();
    return;
  }

  // Статика библиотеки и данных не должна «маскироваться» index.html:
  // отсутствующий файл — это 404, а не HTML со статусом 200.
  if (req.path.startsWith('/assets/library/') || req.path.startsWith('/data/')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  res.sendFile(path.join(distDir, 'index.html'));
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(port, () => {
  console.log(`Server: http://localhost:${port}`);
});
