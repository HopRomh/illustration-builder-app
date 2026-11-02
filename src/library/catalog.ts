import catalogJson from '../../data/catalog.json';
import type { CatalogData } from '../types';

/**
 * Каталог импортируется как JSON: данные небольшие (10 объектов + 6 подложек)
 * и не должны зависеть от сетевого запроса при старте приложения.
 * Копия для прод-проверки лежит в public/data/ (см. scripts/sync-library.ts).
 */
export const catalog = catalogJson as unknown as CatalogData;
