export type MangaStatus = 'ongoing' | 'completed' | 'hiatus' | 'cancelled' | 'unknown';

export type ChapterQuality = 'data' | 'data-saver';

export interface SourceOptions {
  lang?: string;
}

export interface SearchOptions extends SourceOptions {
  limit?: number;
}

export interface ChapterOptions extends SourceOptions {
  limit?: number;
  offset?: number;
}

export interface ChapterPageOptions extends SourceOptions {
  quality?: ChapterQuality;
}

export interface MangaLibraryOptions extends SourceOptions {
  page?: number;
  limit?: number;
  tagIds?: string[];
  tagMode?: 'AND' | 'OR';
  sort?: 'popular' | 'recentlyUpdated';
  source?: 'all' | 'mangadex' | 'comick';
}

export interface AggregatedMangaLibraryPage {
  source: 'all';
  lang: string;
  mangas: NormalizedManga[];
  results: {
    source: string;
    mangas: NormalizedManga[];
    total: number;
  }[];
  errors: {
    source: string;
    message: string;
  }[];
  total: number;
  limit: number;
  offset: number;
}

export interface NormalizedManga {
  id: string;
  source: string;
  title: string;
  alternativeTitles: string[];
  description: string;
  cover: string | null;
  status: MangaStatus;
  year: number | null;
  genres: string[];
  language: string;
  raw?: unknown;
}

export interface NormalizedMangaDetails extends NormalizedManga {
  authors: string[];
  artists: string[];
  chaptersCount: number;
}

export interface NormalizedMangaLibraryPage {
  source: string;
  lang: string;
  mangas: NormalizedManga[];
  total: number;
  limit: number;
  offset: number;
}

export interface NormalizedMangaTag {
  id: string;
  name: string;
  group: string;
}

export interface NormalizedChapter {
  id: string;
  source: string;
  mangaId: string;
  chapter: string;
  title: string | null;
  volume: string | null;
  language: string;
  pages: number;
  publishedAt: string | null;
  raw?: unknown;
}

export interface NormalizedPage {
  page: number;
  url: string;
  width: number | null;
  height: number | null;
}

export interface ChapterPagesResponse {
  source: string;
  chapterId: string;
  pages: NormalizedPage[];
}
