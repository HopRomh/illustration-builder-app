import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
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
