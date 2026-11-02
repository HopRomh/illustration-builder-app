// TODO: дополнять типы на следующих этапах
export type Size = 'L' | 'S';
export type Variant = 'main' | 'background';
export type SchemeId = string;
export type Format = '1:1' | '4:3' | '3:4';
export type RoleId =
  | 'bg-1'
  | 'bg-2'
  | 'bg-3'
  | 'bg-black'
  | 'obj-1'
  | 'obj-2'
  | 'obj-3'
  | 'obj-white';

export interface LibraryItem {
  id: string;
  name: string;
  tags: string[];
  variants: Partial<
    Record<
      `${Variant}-${Size}`,
      {
        file: string;
        viewBox: [number, number, number, number];
      }
    >
  >;
}

export interface Backdrop {
  id: string;
  scheme: SchemeId;
  size: Size;
  file: string;
  viewBox: [number, number, number, number];
}

export interface Palette {
  scheme: SchemeId;
  colors: Record<RoleId, string>;
}

export interface Scene {
  format: Format;
  size: Size;
  scheme: SchemeId;
  /** Единый масштаб всех объектов сцены (см. getSceneScale). */
  scale: number;
}

export interface CatalogData {
  items: LibraryItem[];
  backdrops: Backdrop[];
}
